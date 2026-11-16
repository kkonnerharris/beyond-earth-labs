package mission

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"

	"beyondearthlabs/mission/internal/planner"
)

// The route is planned on 20 m cells. The fine check measures the same route on
// NASA's 1 m HiRISE elevation model (read by the science service). When asked,
// it also moves the route: the ground around every steep stretch is surveyed on
// the 1 m model, each cell with steep ground in it becomes a keep-out, and the
// route is planned and measured again.

// FineSource marks a keep-out that came from the 1 m elevation model, not from a simulated emergency.
const FineSource = "hirise_1m"

const (
	// maxFineRounds bounds how many times a route is replanned and measured again.
	maxFineRounds = 6
	// fineMinSteepPosts is how many 1 m points in a cell must be steeper than the mover's limit before the
	// cell is kept out. Eight points is 2% of a 20 m cell: enough to ignore a single bad elevation post,
	// small enough to catch a bank 2 m wide that crosses a corner of the cell.
	fineMinSteepPosts = 8
	// fineSurveyStartM and fineSurveyMaxM set how far around a steep stretch the ground is surveyed.
	// The reach grows each round, so a long bank is followed until a way past it is found.
	fineSurveyStartM = 100.0
	fineSurveyMaxM   = 260.0
)

// FineStretch is one stretch of the route steeper than the mover's limit on the 1 m model.
type FineStretch struct {
	StartM      float64 `json:"start_m"` // distance along the route
	EndM        float64 `json:"end_m"`
	LengthM     float64 `json:"length_m"`
	MaxSlopeDeg float64 `json:"max_slope_deg"`
	X           float64 `json:"x"`
	Y           float64 `json:"y"`
	Lon         float64 `json:"lon"`
	Lat         float64 `json:"lat"`
}

// FineCheck is the result of measuring one plan on the 1 m elevation model.
type FineCheck struct {
	Revision     int                `json:"revision"` // the plan revision that was measured
	Kind         string             `json:"kind"`
	LimitDeg     float64            `json:"limit_deg"`
	LengthM      float64            `json:"length_m"`
	CheckedM     float64            `json:"checked_m"`
	NoDataM      float64            `json:"no_data_m"`
	OverLimitM   float64            `json:"over_limit_m"`
	SlopeDeg     map[string]float64 `json:"slope_deg"`
	RoughnessM   map[string]float64 `json:"roughness_m"`
	Stretches    []FineStretch      `json:"stretches"`
	Profile      json.RawMessage    `json:"profile,omitempty"`
	Perseverance json.RawMessage    `json:"perseverance,omitempty"`
	Source       json.RawMessage    `json:"source,omitempty"`
	Method       string             `json:"method"`
	Limits       string             `json:"limits"`

	// Filled in by the mission service.
	Clear         bool          `json:"clear"`          // nothing on the route is steeper than the limit
	Rounds        int           `json:"rounds"`         // replans made to move the route off steep ground
	KeepOuts      int           `json:"keep_outs"`      // cells kept out because of the 1 m data, this check
	CellsSurveyed int           `json:"cells_surveyed"` // cells measured on the 1 m model around steep stretches
	Unavoidable   []FineStretch `json:"unavoidable"`    // steep stretches at the base or a target, which a replan cannot move
	FirstFound    *FineFirst    `json:"first_found"`    // what the first measurement found, when the route was then changed
	AddedM        float64       `json:"added_m"`        // how much longer the changed route is
	Summary       string        `json:"summary"`
}

// FineFirst records what the 1 m model showed on the route as first planned.
type FineFirst struct {
	Stretches   int     `json:"stretches"`
	OverLimitM  float64 `json:"over_limit_m"`
	MaxSlopeDeg float64 `json:"max_slope_deg"`
	DistanceM   float64 `json:"distance_m"`
}

// FineCell is one planner cell measured on the 1 m model.
type FineCell struct {
	X           float64  `json:"x"`
	Y           float64  `json:"y"`
	Posts       int      `json:"posts"`       // 1 m points measured inside the cell
	SteepPosts  int      `json:"steep_posts"` // of those, how many are steeper than the limit
	MaxSlopeDeg *float64 `json:"max_slope_deg"`
}

// FineChecker measures a route (local metres) on the fine elevation model.
type FineChecker func(points [][2]float64, limitDeg float64) (*FineCheck, error)

// FineSurveyor measures whole cells (centres in local metres) on the fine elevation model.
type FineSurveyor func(cells [][2]float64, cellM, limitDeg float64) ([]FineCell, error)

func planPoints(p *Plan) [][2]float64 {
	var pts [][2]float64
	for _, leg := range p.Legs {
		for _, q := range leg.Points {
			if n := len(pts); n > 0 && pts[n-1][0] == q.X && pts[n-1][1] == q.Y {
				continue
			}
			pts = append(pts, [2]float64{q.X, q.Y})
		}
	}
	return pts
}

func (m *Mission) dropFineHazards() {
	kept := []planner.Hazard{}
	for _, h := range m.Hazards {
		if h.Source != FineSource {
			kept = append(kept, h)
		}
	}
	m.Hazards = kept
}

// fixedCells are the cells holding the base and the targets: the route has to enter them.
func (e *Engine) fixedCells(m *Mission) map[int]bool {
	out := map[int]bool{}
	add := func(x, y float64) {
		if r, c, ok := e.Grid.CellAt(x, y); ok {
			out[e.Grid.Index(r, c)] = true
		}
	}
	add(m.Base.X, m.Base.Y)
	for _, t := range m.Targets {
		add(t.X, t.Y)
	}
	return out
}

// CheckFine measures the current plan on the 1 m elevation model. With avoid set, it surveys the ground
// around every steep stretch, keeps the route out of the steep cells, and measures again until the route
// is clear or no better route is found.
//
// Keeping out of all the steep ground at once can leave no route at all: a target on top of a scarp can
// only be reached across it. Then the steep stretches are taken one at a time, worst first, and the
// ground around a stretch is kept out only if a route to every target still exists. The stretches that
// cannot be avoided stay on the route and are reported.
func (e *Engine) CheckFine(m *Mission, avoid bool) error {
	if e.Fine == nil {
		return errors.New("the 1 m elevation check is not available: the science service is not connected")
	}
	if m.Plan == nil || len(m.Plan.Legs) == 0 {
		return errors.New("there is no route to check; add a target first")
	}
	if m.Sim.Phase != PhaseIdle {
		return errors.New("the route cannot be checked while the simulation is running; reset it first")
	}
	g := e.Grid
	limit := m.Profile().MaxSlopeDeg
	res, err := e.Fine(planPoints(m.Plan), limit)
	if err != nil {
		return fmt.Errorf("the 1 m elevation check did not finish: %w", err)
	}

	fixed := e.fixedCells(m)
	keptOut := map[int]bool{} // cells already kept out because of the 1 m data
	for _, h := range m.Hazards {
		if r, c, ok := g.CellAt(h.X, h.Y); ok && h.Source == FineSource {
			keptOut[g.Index(r, c)] = true
		}
	}
	surveyed := map[int]bool{}
	var first *FineFirst
	rounds, added := 0, 0
	note := ""

	for avoid && len(res.Stretches) > 0 && rounds < maxFineRounds {
		if first == nil {
			first = &FineFirst{Stretches: len(res.Stretches), OverLimitM: res.OverLimitM,
				MaxSlopeDeg: res.SlopeDeg["max"], DistanceM: m.Plan.DistanceM}
		}
		note = ""
		before := len(m.Hazards)
		// Cells to keep out this round, each filed under the steep stretch it belongs to.
		type cand struct {
			idx, stretch int
			why          string
		}
		var cands []cand
		listed := map[int]bool{}
		keep := func(idx, stretch int, why string) {
			if fixed[idx] || keptOut[idx] || listed[idx] {
				return
			}
			listed[idx] = true
			cands = append(cands, cand{idx, stretch, why})
		}
		apply := func(cs []cand) {
			for _, k := range cs {
				keptOut[k.idx] = true
				r, c := g.RowCol(k.idx)
				x, y := g.Centre(r, c)
				m.Hazards = append(m.Hazards, planner.Hazard{ID: fmt.Sprintf("fine-%d-%d", r, c), X: x, Y: y,
					RadiusM: g.CellM / 2, Source: FineSource, Reason: k.why})
			}
		}
		undo := func(n int) {
			for _, h := range m.Hazards[n:] {
				if r, c, ok := g.CellAt(h.X, h.Y); ok {
					delete(keptOut, g.Index(r, c))
				}
			}
			m.Hazards = m.Hazards[:n]
		}
		nearestStretch := func(x, y float64) int {
			best, bestD := 0, math.Inf(1)
			for i, s := range res.Stretches {
				if d := math.Hypot(s.X-x, s.Y-y); d < bestD {
					best, bestD = i, d
				}
			}
			return best
		}

		// The cell under each steep stretch is kept out whatever the survey says.
		reach := int(math.Min(fineSurveyStartM*float64(rounds+1), fineSurveyMaxM) / g.CellM)
		var want [][2]float64
		for si, s := range res.Stretches {
			r0, c0, ok := g.CellAt(s.X, s.Y)
			if !ok {
				continue
			}
			keep(g.Index(r0, c0), si, fmt.Sprintf("%.0f degrees on the route here on the 1 m elevation model; the %s's limit is %.0f",
				s.MaxSlopeDeg, m.Profile().Name, limit))
			if e.FineCells == nil {
				continue
			}
			for r := r0 - reach; r <= r0+reach; r++ {
				for c := c0 - reach; c <= c0+reach; c++ {
					if idx := g.Index(r, c); g.InBounds(r, c) && !surveyed[idx] {
						surveyed[idx] = true
						x, y := g.Centre(r, c)
						want = append(want, [2]float64{x, y})
					}
				}
			}
		}
		if len(want) > 0 {
			cells, serr := e.FineCells(want, g.CellM, limit)
			if serr != nil {
				return fmt.Errorf("the 1 m survey around the steep ground did not finish: %w", serr)
			}
			for _, cell := range cells {
				if cell.SteepPosts < fineMinSteepPosts {
					continue
				}
				if r, c, ok := g.CellAt(cell.X, cell.Y); ok {
					peak := limit
					if cell.MaxSlopeDeg != nil {
						peak = *cell.MaxSlopeDeg
					}
					keep(g.Index(r, c), nearestStretch(cell.X, cell.Y), fmt.Sprintf("%d of %d points in this cell are steeper than %.0f degrees on the 1 m elevation model (up to %.0f)",
						cell.SteepPosts, cell.Posts, limit, peak))
				}
			}
		}
		if len(cands) == 0 {
			note = " What remains is at the base or a target, where the route has to go."
			break
		}
		apply(cands)
		legs, perr := e.planLegs(m, m.Base.X, m.Base.Y, 0)
		if perr != nil {
			// Keeping out of all of it leaves no way through. Take the stretches one at a time, worst first,
			// and keep out of the ground around a stretch only if every target can still be reached.
			undo(before)
			order := make([]int, len(res.Stretches))
			for i := range order {
				order[i] = i
			}
			sort.SliceStable(order, func(a, b int) bool {
				return res.Stretches[order[a]].MaxSlopeDeg > res.Stretches[order[b]].MaxSlopeDeg
			})
			stuck := 0
			for _, si := range order {
				var group []cand
				for _, k := range cands {
					if k.stretch == si {
						group = append(group, k)
					}
				}
				if len(group) == 0 {
					continue
				}
				n := len(m.Hazards)
				apply(group)
				if _, gerr := e.planLegs(m, m.Base.X, m.Base.Y, 0); gerr != nil {
					undo(n)
					stuck++
				}
			}
			if len(m.Hazards) > before {
				legs, perr = e.planLegs(m, m.Base.X, m.Base.Y, 0)
			}
			if len(m.Hazards) == before || perr != nil {
				undo(before)
				note = " Every way to a target crosses some of the steep ground that remains, so it stays on the route."
				m.log("warning", "The route could not be moved off the steep ground found on the 1 m model: every way to a target crosses some of it.")
				break
			}
			note = fmt.Sprintf(" Keeping out of the ground around %d of the steep stretches would have left no route to a target, so those were left on the route.", stuck)
		}
		added += len(m.Hazards) - before
		rounds++
		var dwell float64
		for _, t := range m.Targets {
			dwell += t.DwellMin * 60
		}
		m.Plan = m.summarise(legs, dwell, "Route moved off ground the 1 m elevation model shows to be too steep.",
			m.Plan.Revision+1)
		m.Sim = newSim(m)
		m.Score = nil
		e.refreshHabitat(m)
		if res, err = e.Fine(planPoints(m.Plan), limit); err != nil {
			return fmt.Errorf("the 1 m elevation check did not finish: %w", err)
		}
	}

	if avoid && len(res.Stretches) > 0 && note == "" && rounds > 0 {
		note = fmt.Sprintf(" The check stops after %d replans; the steep ground that remains stays on the route.", rounds)
	}
	res.Revision = m.Plan.Revision
	if res.Stretches == nil {
		res.Stretches = []FineStretch{}
	}
	res.Clear = len(res.Stretches) == 0
	res.Rounds, res.KeepOuts, res.CellsSurveyed, res.FirstFound = rounds, added, len(surveyed), first
	res.Unavoidable = []FineStretch{}
	for _, s := range res.Stretches {
		if r, c, ok := g.CellAt(s.X, s.Y); ok && fixed[g.Index(r, c)] {
			res.Unavoidable = append(res.Unavoidable, s)
		}
	}
	if first != nil {
		res.AddedM = m.Plan.DistanceM - first.DistanceM
	}
	name := m.Profile().Name
	count := func(n int, one, many string) string {
		if n == 1 {
			return "1 " + one
		}
		return fmt.Sprintf("%d %s", n, many)
	}
	switch {
	case res.Clear && rounds == 0:
		res.Summary = fmt.Sprintf("Checked %.0f m of route on NASA's 1 m elevation model. Nothing on it is steeper than the %s's %.0f degree limit; the steepest point is %.1f degrees.",
			res.CheckedM, name, limit, res.SlopeDeg["max"])
	case res.Clear:
		res.Summary = fmt.Sprintf("The 1 m elevation model showed %s, %.0f m in all, steeper than the %s's %.0f degree limit (up to %.1f degrees). The route was moved in %s and is now clear: its steepest point is %.1f degrees and it is %.0f m longer.",
			count(first.Stretches, "stretch", "stretches"), first.OverLimitM, name, limit, first.MaxSlopeDeg,
			count(rounds, "replan", "replans"), res.SlopeDeg["max"], res.AddedM)
	default:
		res.Summary = fmt.Sprintf("On NASA's 1 m elevation model, %s of this route, %.0f m in all, %s steeper than the %s's %.0f degree limit (up to %.1f degrees).",
			count(len(res.Stretches), "stretch", "stretches"), res.OverLimitM,
			map[bool]string{true: "is", false: "are"}[len(res.Stretches) == 1], name, limit, res.SlopeDeg["max"])
		if rounds > 0 {
			res.Summary += fmt.Sprintf(" The route was replanned %s; before that, %.0f m was over the limit.",
				count(rounds, "time", "times"), first.OverLimitM)
		}
		res.Summary += note
	}
	m.FineCheck = res
	m.log("plan", fmt.Sprintf("1 m check of plan %d: %s", res.Revision, res.Summary))
	if rounds > 0 {
		m.log("plan", fmt.Sprintf("Plan %d: %.0f m, %.1f h. %s", m.Plan.Revision, m.Plan.DistanceM, m.Plan.Seconds/3600,
			m.Plan.Feasibility.Reason))
	}
	return nil
}
