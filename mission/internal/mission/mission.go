// Package mission holds the authoritative mission state: where the base is,
// which science targets the traverse visits, the planned route, whether the
// plan is feasible on the mover's consumables, and the running simulation.
//
// Nothing outside this package changes a mission. The web interface sends
// commands and draws what comes back.
package mission

import (
	"errors"
	"fmt"
	"math"
	"time"

	"beyondearthlabs/mission/internal/lifesupport"
	"beyondearthlabs/mission/internal/mobility"
	"beyondearthlabs/mission/internal/planner"
	"beyondearthlabs/mission/internal/terrain"
)

// Reserve fractions are mission rules, shown to the user as assumptions.
const (
	OxygenReserve  = 0.25 // astronaut: oxygen kept beyond the planned need
	BatteryReserve = 0.20 // rover: battery kept beyond the planned need
)

// Site is a named place in the mission area.
type Site struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	Kind       string  `json:"kind"` // base | science | habitat_candidate
	X          float64 `json:"x"`
	Y          float64 `json:"y"`
	Lon        float64 `json:"lon"`
	Lat        float64 `json:"lat"`
	ElevationM float64 `json:"elevation_m"`
	SlopeDeg   float64 `json:"slope_deg"`
	Objective  string  `json:"objective,omitempty"`
	DwellMin   float64 `json:"dwell_min"`
	Visited    bool    `json:"visited"`
}

// Event is one entry in the mission log.
type Event struct {
	T       float64 `json:"t_seconds"` // mission elapsed time
	Kind    string  `json:"kind"`      // plan | sim | arrival | emergency | decision | warning
	Message string  `json:"message"`
}

// Feasibility is the consumables check for the whole planned traverse.
type Feasibility struct {
	OK           bool    `json:"ok"`
	Resource     string  `json:"resource"` // oxygen_kg or battery_wh
	Needed       float64 `json:"needed"`
	WithReserve  float64 `json:"needed_with_reserve"`
	Available    float64 `json:"available"`
	Margin       float64 `json:"margin"`
	ReserveShare float64 `json:"reserve_fraction"`
	Reason       string  `json:"reason"`
}

// Plan is the planned traverse: one route leg per hop, base to each target and back to base.
type Plan struct {
	Legs        []*planner.Route `json:"legs"`
	DistanceM   float64          `json:"distance_m"`
	Seconds     float64          `json:"seconds"` // driving or walking time plus dwell at targets
	MoveSeconds float64          `json:"move_seconds"`
	Joules      float64          `json:"joules"`
	MaxSlopeDeg float64          `json:"max_slope_deg"`
	Feasibility Feasibility      `json:"feasibility"`
	Revision    int              `json:"revision"`
	Reason      string           `json:"reason"` // why this plan was made
}

// Mission is the full authoritative state.
type Mission struct {
	ID         string             `json:"id"`
	Name       string             `json:"name"`
	Body       string             `json:"body"`
	CreatedUTC string             `json:"created_utc"`
	Mover      string             `json:"mover"`
	Objective  planner.Objective  `json:"objective"`
	RiskWeight float64            `json:"risk_weight"`
	Base       Site               `json:"base"`
	Targets    []Site             `json:"targets"`
	Hazards    []planner.Hazard   `json:"hazards"`
	Plan       *Plan              `json:"plan"`
	Sim        Sim                `json:"sim"`
	Crew       int                `json:"crew"`
	Sols       float64            `json:"sols"`
	CropAreaM2 map[string]float64 `json:"crop_area_m2"`
	Overrides  map[string]float64 `json:"overrides"`
	Habitat    lifesupport.Budget `json:"habitat"`
	Events     []Event            `json:"events"`
	Score      *Score             `json:"score"`      // nil until the traverse has ended
	FineCheck  *FineCheck         `json:"fine_check"` // the current plan measured on the 1 m elevation model, or nil
	Disclaimer string             `json:"disclaimer"`

	profile mobility.Profile // the mover as currently degraded by emergencies
}

const disclaimer = "Simulation and planning aid built for a hackathon. Routes, times and consumables are estimates " +
	"from stated assumptions and are not certified for spacecraft operations or crew safety."

// Engine creates and changes missions on one terrain grid.
type Engine struct {
	Grid *terrain.Grid
	Now  func() time.Time
	Fine FineChecker // measures a route on the 1 m elevation model; nil when the science service is not connected
	// FineCells measures whole cells on the 1 m model, to find a way round steep ground; nil leaves only
	// the cell under each steep stretch kept out.
	FineCells FineSurveyor
}

func (e *Engine) site(id, name, kind string, x, y float64) (Site, error) {
	s, ok := e.Grid.SampleAt(x, y)
	if !ok {
		return Site{}, fmt.Errorf("%s is outside the mapped area", name)
	}
	return Site{ID: id, Name: name, Kind: kind, X: s.X, Y: s.Y, Lon: s.Lon, Lat: s.Lat,
		ElevationM: s.ElevationM, SlopeDeg: s.SlopeDeg}, nil
}

// New creates a mission based at a local point.
func (e *Engine) New(id, name, mover string, baseX, baseY float64) (*Mission, error) {
	p, ok := mobility.Profiles[mover]
	if !ok {
		return nil, fmt.Errorf("unknown mover %q", mover)
	}
	base, err := e.site("base", "Base", "base", baseX, baseY)
	if err != nil {
		return nil, err
	}
	if !p.Enterable(base.SlopeDeg, 0) {
		return nil, fmt.Errorf("the base is on a %.1f degree slope, beyond the %s's %.0f degree limit",
			base.SlopeDeg, p.Name, p.MaxSlopeDeg)
	}
	now := time.Now
	if e.Now != nil {
		now = e.Now
	}
	m := &Mission{ID: id, Name: name, Body: e.Grid.Meta.Body, CreatedUTC: now().UTC().Format(time.RFC3339),
		Mover: mover, Objective: planner.Fastest, RiskWeight: 1, Base: base, Crew: 4, Sols: 500,
		Targets: []Site{}, Hazards: []planner.Hazard{}, Events: []Event{},
		CropAreaM2: map[string]float64{}, Overrides: map[string]float64{},
		Disclaimer: disclaimer, profile: p}
	m.Sim = newSim(m)
	e.refreshHabitat(m)
	m.log("plan", fmt.Sprintf("Mission created with the %s based at %.4f N, %.4f E.", p.Name, base.Lat, base.Lon))
	return m, nil
}

func (m *Mission) log(kind, msg string) {
	m.Events = append(m.Events, Event{T: m.Sim.Seconds, Kind: kind, Message: msg})
}

// Profile returns the mover as currently degraded by emergencies.
func (m *Mission) Profile() mobility.Profile {
	if m.profile.Key == "" {
		m.profile = mobility.Profiles[m.Mover]
	}
	return m.profile
}

// SetMover changes the mover and replans.
func (e *Engine) SetMover(m *Mission, mover string, obj planner.Objective, risk float64) error {
	p, ok := mobility.Profiles[mover]
	if !ok {
		return fmt.Errorf("unknown mover %q", mover)
	}
	if m.Sim.Phase != PhaseIdle {
		return errors.New("the mover cannot be changed while the simulation is running; reset it first")
	}
	if mover != m.Mover {
		m.dropFineHazards() // keep-outs from the 1 m check were for the other mover's slope limit
	}
	m.Mover, m.profile = mover, p
	if obj == planner.Fastest || obj == planner.LeastEnergy {
		m.Objective = obj
	}
	if risk >= 0 {
		m.RiskWeight = risk
	}
	m.Sim = newSim(m)
	return e.Replan(m, "Mover or planning preference changed.")
}

// AddTarget appends a science target and replans.
func (e *Engine) AddTarget(m *Mission, name, objective string, x, y, dwellMin float64) error {
	if m.Sim.Phase != PhaseIdle {
		return errors.New("targets cannot be added while the simulation is running; reset it first")
	}
	id := fmt.Sprintf("t%d", len(m.Targets)+1)
	if name == "" {
		name = fmt.Sprintf("Target %d", len(m.Targets)+1)
	}
	s, err := e.site(id, name, "science", x, y)
	if err != nil {
		return err
	}
	if !m.Profile().Enterable(s.SlopeDeg, 0) {
		return fmt.Errorf("%s is on a %.1f degree slope; the %s's limit is %.0f degrees", name, s.SlopeDeg,
			m.Profile().Name, m.Profile().MaxSlopeDeg)
	}
	s.Objective, s.DwellMin = objective, dwellMin
	m.Targets = append(m.Targets, s)
	return e.Replan(m, fmt.Sprintf("Target added: %s.", name))
}

// ClearTargets removes every target.
func (e *Engine) ClearTargets(m *Mission) error {
	if m.Sim.Phase != PhaseIdle {
		return errors.New("targets cannot be removed while the simulation is running; reset it first")
	}
	m.Targets = []Site{}
	m.Plan = nil
	m.FineCheck = nil
	m.dropFineHazards()
	m.Sim = newSim(m)
	m.log("plan", "All targets removed.")
	e.refreshHabitat(m)
	return nil
}

// planLegs plans base -> targets... -> base starting from an arbitrary point and target index.
func (e *Engine) planLegs(m *Mission, fromX, fromY float64, nextTarget int) ([]*planner.Route, error) {
	stops := [][2]float64{{fromX, fromY}}
	for i := nextTarget; i < len(m.Targets); i++ {
		stops = append(stops, [2]float64{m.Targets[i].X, m.Targets[i].Y})
	}
	stops = append(stops, [2]float64{m.Base.X, m.Base.Y})
	var legs []*planner.Route
	for i := 0; i+1 < len(stops); i++ {
		if math.Hypot(stops[i][0]-stops[i+1][0], stops[i][1]-stops[i+1][1]) < e.Grid.CellM/2 {
			continue // already there
		}
		rt, err := planner.Plan(e.Grid, planner.Request{Profile: m.Profile(), Objective: m.Objective,
			StartX: stops[i][0], StartY: stops[i][1], GoalX: stops[i+1][0], GoalY: stops[i+1][1],
			RiskWeight: m.RiskWeight, Hazards: m.Hazards})
		if err != nil {
			return nil, fmt.Errorf("leg %d: %w", i+1, err)
		}
		legs = append(legs, rt)
	}
	return legs, nil
}

func (m *Mission) capacity() (resource string, available, reserve float64) {
	p := m.Profile()
	if p.Kind == mobility.Astronaut {
		return "oxygen_kg", p.OxygenKg, OxygenReserve
	}
	return "battery_wh", p.BatteryWh, BatteryReserve
}

// consumption converts energy and time into the mover's limiting consumable.
func (m *Mission) consumption(joules, dwellSeconds float64) float64 {
	p := m.Profile()
	if p.Kind == mobility.Astronaut {
		// Working at a target is taken as light work at 200 W metabolic (assumption).
		return (joules + 200*dwellSeconds) * mobility.OxygenKgPerJoule
	}
	return (joules + math.Max(0, p.HotelPowerW-p.GenerationW)*dwellSeconds) / 3600.0
}

func (m *Mission) summarise(legs []*planner.Route, dwellSeconds float64, reason string, rev int) *Plan {
	pl := &Plan{Legs: legs, Revision: rev, Reason: reason}
	for _, l := range legs {
		pl.DistanceM += l.DistanceM
		pl.MoveSeconds += l.Seconds
		pl.Joules += l.Joules
		pl.MaxSlopeDeg = math.Max(pl.MaxSlopeDeg, l.MaxSlopeDeg)
	}
	pl.Seconds = pl.MoveSeconds + dwellSeconds
	res, avail, reserve := m.capacity()
	need := m.consumption(pl.Joules, dwellSeconds)
	f := Feasibility{Resource: res, Needed: need, WithReserve: need * (1 + reserve), Available: avail, ReserveShare: reserve}
	f.Margin = f.Available - f.WithReserve
	f.OK = f.Margin >= 0
	unit := map[string]string{"oxygen_kg": "kg of oxygen", "battery_wh": "Wh of battery"}[res]
	if f.OK {
		f.Reason = fmt.Sprintf("The traverse needs %.2f %s; with the %.0f%% reserve that is %.2f of the %.2f available.",
			need, unit, reserve*100, f.WithReserve, avail)
	} else {
		f.Reason = fmt.Sprintf("Not feasible: the traverse needs %.2f %s, %.2f with the %.0f%% reserve, but only %.2f is available.",
			need, unit, f.WithReserve, reserve*100, avail)
	}
	pl.Feasibility = f
	return pl
}

// Replan plans the whole traverse from the base. It is used before the simulation starts.
func (e *Engine) Replan(m *Mission, reason string) error {
	m.FineCheck = nil // a new plan has not been measured on the 1 m model yet
	if len(m.Targets) == 0 {
		m.Plan = nil
		e.refreshHabitat(m)
		return nil
	}
	legs, err := e.planLegs(m, m.Base.X, m.Base.Y, 0)
	if err != nil {
		m.Plan = nil
		m.log("warning", "No plan: "+err.Error())
		return err
	}
	var dwell float64
	for _, t := range m.Targets {
		dwell += t.DwellMin * 60
	}
	rev := 1
	if m.Plan != nil {
		rev = m.Plan.Revision + 1
	}
	m.Plan = m.summarise(legs, dwell, reason, rev)
	m.Sim = newSim(m)
	m.Score = nil
	m.log("plan", fmt.Sprintf("Plan %d: %.0f m in %d leg(s), %.1f h. %s", rev, m.Plan.DistanceM, len(legs),
		m.Plan.Seconds/3600, m.Plan.Feasibility.Reason))
	e.refreshHabitat(m)
	return nil
}

// SetHabitat changes crew size, mission length, greenhouse areas and assumption overrides.
func (e *Engine) SetHabitat(m *Mission, crew int, sols float64, crops, overrides map[string]float64) {
	if crew > 0 {
		m.Crew = crew
	}
	if sols > 0 {
		m.Sols = sols
	}
	if crops != nil {
		m.CropAreaM2 = crops
	}
	if overrides != nil {
		m.Overrides = overrides
	}
	e.refreshHabitat(m)
}

// refreshHabitat recomputes the habitat budget. Rover charging for one traverse per sol is added to the load.
func (e *Engine) refreshHabitat(m *Mission) {
	in := lifesupport.Input{Crew: m.Crew, Sols: m.Sols, LatitudeDeg: m.Base.Lat, Body: m.Body,
		Overrides: map[string]float64{}, CropAreaM2: m.CropAreaM2}
	for k, v := range m.Overrides {
		in.Overrides[k] = v
	}
	if m.Sim.DustTau > 0 {
		in.Overrides["dust_opacity_tau"] = m.Sim.DustTau
	}
	if m.Plan != nil && m.Profile().Kind == mobility.Rover {
		kwh := m.Plan.Joules / 3.6e6
		in.ExtraLoadKW = kwh / lifesupport.SolHours(m.Body)
	}
	m.Habitat = lifesupport.Compute(in)
}
