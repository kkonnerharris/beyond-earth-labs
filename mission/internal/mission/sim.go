package mission

import (
	"errors"
	"fmt"
	"math"

	"beyondearthlabs/mission/internal/mobility"
	"beyondearthlabs/mission/internal/planner"
)

// Phase is the state of the simulated traverse.
type Phase string

const (
	PhaseIdle     Phase = "idle"
	PhaseMoving   Phase = "moving"
	PhaseDwelling Phase = "at_target"
	PhaseHolding  Phase = "holding"  // stopped with no safe route; waiting for a decision
	PhaseComplete Phase = "complete" // back at base
	PhaseAborted  Phase = "aborted"  // a consumable ran out in the simulation
)

// Emergency is a simulated off-nominal event injected by the user.
type Emergency struct {
	ID     string  `json:"id"`
	Kind   string  `json:"kind"`
	T      float64 `json:"t_seconds"`
	Detail string  `json:"detail"`
}

// Sim is the running simulation. Every value in it is simulated.
type Sim struct {
	Phase      Phase   `json:"phase"`
	Seconds    float64 `json:"seconds"`
	X          float64 `json:"x"`
	Y          float64 `json:"y"`
	Lon        float64 `json:"lon"`
	Lat        float64 `json:"lat"`
	ElevationM float64 `json:"elevation_m"`
	SlopeDeg   float64 `json:"slope_deg"`
	HeadingDeg float64 `json:"heading_deg"` // clockwise from north
	SpeedMS    float64 `json:"speed_ms"`
	DistanceM  float64 `json:"distance_m"`

	Resource  string  `json:"resource"`
	Capacity  float64 `json:"capacity"`
	Remaining float64 `json:"remaining"`

	// The latest "can we still get home" check.
	ReturnNeed   float64 `json:"return_need_with_reserve"`
	ReturnMargin float64 `json:"return_margin"`
	ReturnM      float64 `json:"return_distance_m"`

	LeakPerHour float64 `json:"leak_per_hour"`
	PaceFactor  float64 `json:"pace_factor"` // 1 is nominal
	DustTau     float64 `json:"dust_tau"`    // 0 means the habitat assumption applies
	TurnedBack  bool    `json:"turned_back"`
	Replans     int     `json:"replans"`

	Health Health `json:"health"` // simulated crew health monitor

	ActiveLegs  []*planner.Route `json:"active_legs"` // the route being followed, after any replanning
	Emergencies []Emergency      `json:"emergencies"`
	Track       [][2]float64     `json:"track"` // [lon, lat] breadcrumbs of where the mover has been

	leg, pt    int
	segT       float64 // seconds into the current segment
	legEnds    []int   // target index each active leg ends at, or -1 for the base
	nextTarget int
	dwellLeft  float64
	sinceCheck float64
}

func newSim(m *Mission) Sim {
	res, avail, _ := m.capacity()
	s := Sim{Phase: PhaseIdle, X: m.Base.X, Y: m.Base.Y, Lon: m.Base.Lon, Lat: m.Base.Lat,
		ElevationM: m.Base.ElevationM, SlopeDeg: m.Base.SlopeDeg, Resource: res, Capacity: avail, Remaining: avail,
		PaceFactor: 1, ActiveLegs: []*planner.Route{}, Emergencies: []Emergency{}, Track: [][2]float64{},
		Health: newHealth(m.Profile())}
	return s
}

func legEndsFor(nLegs, nextTarget, nTargets int) []int {
	ends := make([]int, 0, nLegs)
	for t := nextTarget; t < nTargets && len(ends) < nLegs-1; t++ {
		ends = append(ends, t)
	}
	for len(ends) < nLegs {
		ends = append(ends, -1)
	}
	return ends
}

// Start begins the traverse. It refuses a plan that fails the consumables check.
func (e *Engine) Start(m *Mission) error {
	if m.Plan == nil || len(m.Plan.Legs) == 0 {
		return errors.New("there is no plan to run; add a target first")
	}
	if !m.Plan.Feasibility.OK {
		return errors.New("the plan is refused: " + m.Plan.Feasibility.Reason)
	}
	if m.Sim.Phase != PhaseIdle {
		return errors.New("the simulation is already running; reset it to start again")
	}
	s := &m.Sim
	s.ActiveLegs = m.Plan.Legs
	s.legEnds = legEndsFor(len(s.ActiveLegs), 0, len(m.Targets))
	s.leg, s.pt, s.segT, s.nextTarget = 0, 0, 0, 0
	s.Phase = PhaseMoving
	s.Track = append(s.Track, [2]float64{s.Lon, s.Lat})
	m.log("sim", "Traverse started.")
	e.checkReturn(m)
	return nil
}

// Reset returns the simulation to the base with full consumables and clears emergencies.
func (e *Engine) Reset(m *Mission) {
	m.profile = mobility.Profiles[m.Mover]
	// Simulated obstacles go; keep-outs found on the 1 m elevation model are real terrain and stay.
	fine := []planner.Hazard{}
	for _, h := range m.Hazards {
		if h.Source == FineSource {
			fine = append(fine, h)
		}
	}
	m.Hazards = fine
	for i := range m.Targets {
		m.Targets[i].Visited = false
	}
	m.Sim = newSim(m)
	m.Score = nil
	m.Events = append(m.Events, Event{T: 0, Kind: "sim", Message: "Simulation reset."})
	_ = e.Replan(m, "Simulation reset.")
}

func (m *Mission) setPosition(x, y float64, e *Engine) {
	s := &m.Sim
	s.X, s.Y = x, y
	s.Lon, s.Lat = e.Grid.ToLonLat(x, y)
	if smp, ok := e.Grid.SampleAt(x, y); ok {
		s.ElevationM, s.SlopeDeg = smp.ElevationM, smp.SlopeDeg
	}
}

// Step advances the simulation by dt seconds of mission time.
func (e *Engine) Step(m *Mission, dt float64) {
	s := &m.Sim
	if dt <= 0 {
		return
	}
	for dt > 1e-9 && (s.Phase == PhaseMoving || s.Phase == PhaseDwelling) {
		if s.Phase == PhaseDwelling {
			t := math.Min(dt, s.dwellLeft)
			e.spend(m, 0, t)
			s.dwellLeft -= t
			dt -= t
			if s.dwellLeft <= 1e-9 && s.Phase == PhaseDwelling {
				s.Phase = PhaseMoving
				s.leg++
				s.pt, s.segT = 0, 0
				e.checkReturn(m)
			}
			continue
		}
		if s.leg >= len(s.ActiveLegs) {
			s.Phase = PhaseComplete
			break
		}
		pts := s.ActiveLegs[s.leg].Points
		if s.pt >= len(pts)-1 {
			e.arrive(m)
			continue
		}
		a, b := pts[s.pt], pts[s.pt+1]
		segSeconds := b.Seconds - a.Seconds
		segJoules := b.Joules - a.Joules
		if segSeconds <= 0 {
			s.pt++
			continue
		}
		t := math.Min(dt, segSeconds-s.segT)
		frac0 := s.segT / segSeconds
		s.segT += t
		frac1 := s.segT / segSeconds
		e.spend(m, segJoules*(frac1-frac0), t)
		segDist := b.DistM - a.DistM
		s.DistanceM += segDist * (frac1 - frac0)
		s.SpeedMS = segDist / segSeconds
		s.HeadingDeg = math.Mod(math.Atan2(b.X-a.X, b.Y-a.Y)*180/math.Pi+360, 360)
		m.setPosition(a.X+(b.X-a.X)*frac1, a.Y+(b.Y-a.Y)*frac1, e)
		dt -= t
		if s.segT >= segSeconds-1e-9 {
			s.pt++
			s.segT = 0
			s.Track = append(s.Track, [2]float64{s.Lon, s.Lat})
		}
		s.sinceCheck += t
		if s.sinceCheck >= 120 && s.Phase == PhaseMoving {
			e.checkReturn(m)
		}
	}
	if s.Phase != PhaseMoving {
		s.SpeedMS = 0
	}
	m.Score = e.score(m)
}

// spend advances the clock and draws down the limiting consumable.
func (e *Engine) spend(m *Mission, joules, seconds float64) {
	s := &m.Sim
	s.Seconds += seconds
	e.updateHealth(m, joules, seconds)
	use := m.consumption(joules, 0)
	if joules == 0 { // stationary: hotel load or light work
		use = m.consumption(0, seconds)
	}
	use += s.LeakPerHour * seconds / 3600
	s.Remaining -= use
	if s.Remaining <= 0 {
		s.Remaining = 0
		s.Phase = PhaseAborted
		m.log("warning", fmt.Sprintf("Simulated failure: %s ran out %.0f m from base.", resourceName(s.Resource),
			math.Hypot(s.X-m.Base.X, s.Y-m.Base.Y)))
	}
}

func resourceName(r string) string {
	if r == "oxygen_kg" {
		return "oxygen"
	}
	return "battery"
}

// arrive handles the end of a leg.
func (e *Engine) arrive(m *Mission) {
	s := &m.Sim
	end := -1
	if s.leg < len(s.legEnds) {
		end = s.legEnds[s.leg]
	}
	if end >= 0 && end < len(m.Targets) {
		t := &m.Targets[end]
		t.Visited = true
		s.nextTarget = end + 1
		m.log("arrival", fmt.Sprintf("Arrived at %s after %.0f m. %s", t.Name, s.DistanceM, t.Objective))
		if t.DwellMin > 0 {
			s.Phase, s.dwellLeft = PhaseDwelling, t.DwellMin*60
			return
		}
		s.leg++
		s.pt, s.segT = 0, 0
		e.checkReturn(m)
		return
	}
	s.Phase = PhaseComplete
	visited := 0
	for _, t := range m.Targets {
		if t.Visited {
			visited++
		}
	}
	m.log("arrival", fmt.Sprintf("Back at base: %.0f m travelled in %.1f h, %d of %d target(s) visited, %.0f%% of %s left.",
		s.DistanceM, s.Seconds/3600, visited, len(m.Targets), 100*s.Remaining/s.Capacity, resourceName(s.Resource)))
}

// returnRoute plans the way home from the current position.
func (e *Engine) returnRoute(m *Mission) (*planner.Route, error) {
	s := &m.Sim
	if math.Hypot(s.X-m.Base.X, s.Y-m.Base.Y) < e.Grid.CellM {
		return &planner.Route{}, nil
	}
	return planner.Plan(e.Grid, planner.Request{Profile: m.Profile(), Objective: m.Objective,
		StartX: s.X, StartY: s.Y, GoalX: m.Base.X, GoalY: m.Base.Y, RiskWeight: m.RiskWeight, Hazards: m.Hazards})
}

// checkReturn is the standing safety rule: at any moment the mover must be
// able to reach base on what it carries, with the reserve intact. If going on
// to the next target would break that, the traverse turns back now.
func (e *Engine) checkReturn(m *Mission) {
	s := &m.Sim
	s.sinceCheck = 0
	if s.Phase != PhaseMoving && s.Phase != PhaseDwelling {
		return
	}
	home, err := e.returnRoute(m)
	if err != nil {
		m.log("warning", "No route home from here within limits: "+err.Error())
		return
	}
	_, _, reserve := m.capacity()
	leak := s.LeakPerHour * home.Seconds / 3600
	need := (m.consumption(home.Joules, 0) + leak) * (1 + reserve)
	s.ReturnNeed, s.ReturnMargin, s.ReturnM = need, s.Remaining-need, home.DistanceM
	if s.TurnedBack || s.nextTarget >= len(m.Targets) {
		return // already heading home
	}
	// What the rest of the plan costs from here, including the leak over that time.
	var restJ, restT float64
	first := s.leg
	if first < 0 { // stopped at a target after a replan: the new legs have not been started
		first = 0
	}
	for i := first; i < len(s.ActiveLegs); i++ {
		l := s.ActiveLegs[i]
		restJ += l.Joules
		restT += l.Seconds
	}
	if s.leg >= 0 && s.leg < len(s.ActiveLegs) && s.pt < len(s.ActiveLegs[s.leg].Points) {
		done := s.ActiveLegs[s.leg].Points[s.pt]
		restJ -= done.Joules
		restT -= done.Seconds
	}
	var dwell float64
	for i := s.nextTarget; i < len(m.Targets); i++ {
		dwell += m.Targets[i].DwellMin * 60
	}
	restNeed := (m.consumption(restJ, dwell) + s.LeakPerHour*(restT+dwell)/3600) * (1 + reserve)
	if restNeed > s.Remaining {
		e.turnBack(m, home, fmt.Sprintf("Finishing the plan needs %.2f %s with reserve; %.2f remains. Returning to base needs %.2f.",
			restNeed, unitOf(s.Resource), s.Remaining, need))
	}
}

func unitOf(r string) string {
	if r == "oxygen_kg" {
		return "kg of oxygen"
	}
	return "Wh"
}

func (e *Engine) turnBack(m *Mission, home *planner.Route, why string) {
	s := &m.Sim
	s.TurnedBack = true
	s.Replans++
	if len(home.Points) < 2 {
		s.Phase = PhaseComplete
		m.log("decision", "Turned back at base. "+why)
		return
	}
	s.ActiveLegs = []*planner.Route{home}
	s.legEnds = []int{-1}
	s.leg, s.pt, s.segT = 0, 0, 0
	s.Phase = PhaseMoving
	m.log("decision", fmt.Sprintf("Turning back: %.0f m to base. %s", home.DistanceM, why))
}

// replanFromHere rebuilds the remaining legs from the current position.
func (e *Engine) replanFromHere(m *Mission, why string) {
	s := &m.Sim
	if s.Phase != PhaseMoving && s.Phase != PhaseDwelling && s.Phase != PhaseHolding {
		return
	}
	next := s.nextTarget
	if s.TurnedBack {
		next = len(m.Targets)
	}
	legs, err := e.planLegs(m, s.X, s.Y, next)
	if err != nil && next < len(m.Targets) {
		// The remaining targets cannot be reached any more: try to go straight home.
		m.log("warning", "Remaining targets are unreachable ("+err.Error()+"). Planning a direct return.")
		next = len(m.Targets)
		s.TurnedBack = true
		legs, err = e.planLegs(m, s.X, s.Y, next)
	}
	if err != nil {
		s.Phase = PhaseHolding
		m.log("warning", "Holding position: no route within limits. "+err.Error())
		return
	}
	s.Replans++
	wasDwelling := s.Phase == PhaseDwelling
	s.ActiveLegs = legs
	s.legEnds = legEndsFor(len(legs), next, len(m.Targets))
	s.leg, s.pt, s.segT = 0, 0, 0
	if wasDwelling {
		s.leg = -1 // the dwell handler advances to leg 0 when the stop ends
	} else {
		s.Phase = PhaseMoving
	}
	var dist float64
	for _, l := range legs {
		dist += l.DistanceM
	}
	m.log("decision", fmt.Sprintf("Replanned from the current position: %.0f m remaining in %d leg(s). %s", dist, len(legs), why))
	e.checkReturn(m)
}

// Inject applies a simulated emergency and lets the mission respond.
func (e *Engine) Inject(m *Mission, kind string) error {
	s := &m.Sim
	if s.Phase != PhaseMoving && s.Phase != PhaseDwelling {
		return errors.New("emergencies can only be injected while the traverse is under way")
	}
	p := m.Profile()
	id := fmt.Sprintf("e%d", len(s.Emergencies)+1)
	var detail string
	switch kind {
	case "obstacle":
		// A blockage on the route about 150 m ahead (or at the end of the leg if closer).
		hx, hy := s.X, s.Y
		legIdx, from := s.leg, s.pt
		if s.Phase == PhaseDwelling { // stopped at a target: the route ahead is the next leg
			legIdx, from = s.leg+1, 0
		}
		if legIdx >= 0 && legIdx < len(s.ActiveLegs) {
			pts := s.ActiveLegs[legIdx].Points
			from = minInt(from, len(pts)-1)
			here := pts[from].DistM
			for i := from; i < len(pts); i++ {
				hx, hy = pts[i].X, pts[i].Y
				if pts[i].DistM-here >= 150 {
					break
				}
			}
		}
		radius := math.Max(50, 2.5*e.Grid.CellM)
		// Never place the keep-out area on top of the mover itself.
		if d := math.Hypot(hx-s.X, hy-s.Y); d < radius+e.Grid.CellM {
			radius = math.Max(e.Grid.CellM, d-e.Grid.CellM)
		}
		hz := planner.Hazard{ID: id, X: hx, Y: hy, RadiusM: radius, Reason: "Obstacle reported on the route (simulated)"}
		m.Hazards = append(m.Hazards, hz)
		detail = fmt.Sprintf("Obstacle reported %.0f m ahead; keep-out radius %.0f m.", math.Hypot(hx-s.X, hy-s.Y), radius)
		s.Emergencies = append(s.Emergencies, Emergency{id, kind, s.Seconds, detail})
		m.log("emergency", detail)
		e.replanFromHere(m, "Route changed to keep clear of the obstacle.")
	case "dust_storm":
		s.DustTau = 4
		e.refreshHabitat(m)
		detail = fmt.Sprintf("Dust storm: optical depth rises to 4. Habitat solar energy falls to %.0f kWh per sol against a load of %.0f kWh.",
			m.Habitat.SolarKWh, m.Habitat.LoadKWh)
		s.Emergencies = append(s.Emergencies, Emergency{id, kind, s.Seconds, detail})
		m.log("emergency", detail)
		if !s.TurnedBack {
			if home, err := e.returnRoute(m); err == nil {
				e.turnBack(m, home, "Mission rule: surface traverses return to base when dust optical depth exceeds 2.")
			}
		}
		e.checkReturn(m)
	case "leak":
		s.LeakPerHour = 0.15 * s.Capacity
		what := "Suit oxygen leak"
		if p.Kind == mobility.Rover {
			what = "Battery fault"
		}
		detail = fmt.Sprintf("%s: losing %.3f %s per hour on top of normal use (simulated).", what, s.LeakPerHour, unitOf(s.Resource))
		s.Emergencies = append(s.Emergencies, Emergency{id, kind, s.Seconds, detail})
		m.log("emergency", detail)
		e.checkReturn(m)
	case "crew_health":
		s.PaceFactor *= 0.6
		s.Health.offset = 28 // the simulated fault also raises heart rate beyond what the workload explains
		if p.Kind == mobility.Astronaut {
			p.PaceFactor *= 0.6
			detail = "Simulated crew health anomaly: walking pace reduced to 60%."
		} else {
			p.SpeedFlatMS *= 0.6
			detail = "Simulated mobility fault: rover speed reduced to 60%."
		}
		m.profile = p
		s.Emergencies = append(s.Emergencies, Emergency{id, kind, s.Seconds, detail})
		m.log("emergency", detail)
		e.replanFromHere(m, "Times and consumables recalculated at the reduced pace.")
	default:
		return fmt.Errorf("unknown emergency %q (use obstacle, dust_storm, leak or crew_health)", kind)
	}
	m.Score = e.score(m)
	return nil
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
