package mission

import (
	"math"
	"strings"
	"testing"

	"beyondearthlabs/mission/internal/planner"
)

// steepAt is a stand-in for the 1 m elevation model: it reports a steep stretch wherever the route
// passes within 5 m of one of the given places, and counts how often it was asked.
func steepAt(calls *int, places ...[2]float64) FineChecker {
	return func(points [][2]float64, limit float64) (*FineCheck, error) {
		*calls++
		out := &FineCheck{Kind: "calculated", LimitDeg: limit, SlopeDeg: map[string]float64{"max": 5},
			RoughnessM: map[string]float64{}, Stretches: []FineStretch{}}
		var dist float64
		for i, p := range points {
			if i > 0 {
				dist += math.Hypot(p[0]-points[i-1][0], p[1]-points[i-1][1])
			}
			for _, q := range places {
				if math.Hypot(p[0]-q[0], p[1]-q[1]) <= 5 {
					out.Stretches = append(out.Stretches, FineStretch{StartM: dist - 3, EndM: dist + 3, LengthM: 6,
						MaxSlopeDeg: limit + 8, X: p[0], Y: p[1]})
					out.OverLimitM += 6
					out.SlopeDeg["max"] = limit + 8
				}
			}
		}
		out.LengthM, out.CheckedM = dist, dist
		return out, nil
	}
}

// onRoute returns a vertex of the first leg about a third of the way along it.
func onRoute(m *Mission) [2]float64 {
	pts := m.Plan.Legs[0].Points
	p := pts[len(pts)/3]
	return [2]float64{p.X, p.Y}
}

func TestFineCheckNeedsTheScienceServiceAndARoute(t *testing.T) {
	e := world(t)
	m := twoTargets(t, e, "crew_rover")
	if err := e.CheckFine(m, false); err == nil || !strings.Contains(err.Error(), "not available") {
		t.Fatalf("expected a 'not available' error without a checker, got %v", err)
	}
	calls := 0
	e.Fine = steepAt(&calls)
	empty, _ := e.New("m2", "Empty", "crew_rover", -1000, 0)
	if err := e.CheckFine(empty, false); err == nil {
		t.Fatal("expected an error for a mission with no route")
	}
	if calls != 0 {
		t.Fatalf("the checker was called %d times for requests that should have been refused", calls)
	}
}

func TestFineCheckOfACleanRouteChangesNothing(t *testing.T) {
	e := world(t)
	m := twoTargets(t, e, "crew_rover")
	calls := 0
	e.Fine = steepAt(&calls)
	rev, dist := m.Plan.Revision, m.Plan.DistanceM
	if err := e.CheckFine(m, true); err != nil {
		t.Fatal(err)
	}
	f := m.FineCheck
	if f == nil || !f.Clear || f.Rounds != 0 || f.KeepOuts != 0 || f.Revision != rev || f.FirstFound != nil {
		t.Fatalf("unexpected result for a clean route: %+v", f)
	}
	if m.Plan.Revision != rev || m.Plan.DistanceM != dist || len(m.Hazards) != 0 || calls != 1 {
		t.Fatalf("a clean check changed the plan: revision %d, %d keep-outs, %d calls", m.Plan.Revision, len(m.Hazards), calls)
	}
}

func TestFineCheckReportsWithoutChangingTheRouteUnlessAskedTo(t *testing.T) {
	e := world(t)
	m := twoTargets(t, e, "crew_rover")
	calls := 0
	e.Fine = steepAt(&calls, onRoute(m))
	rev := m.Plan.Revision
	if err := e.CheckFine(m, false); err != nil {
		t.Fatal(err)
	}
	f := m.FineCheck
	if f.Clear || len(f.Stretches) != 1 || len(m.Hazards) != 0 || m.Plan.Revision != rev {
		t.Fatalf("report-only check: clear=%v stretches=%d keep-outs=%d revision=%d", f.Clear, len(f.Stretches),
			len(m.Hazards), m.Plan.Revision)
	}
	if !strings.Contains(f.Summary, "steeper than") {
		t.Fatalf("summary does not say what was found: %q", f.Summary)
	}
}

func TestFineCheckMovesTheRouteOffSteepGround(t *testing.T) {
	e := world(t)
	m := twoTargets(t, e, "crew_rover")
	calls := 0
	bad := onRoute(m)
	e.Fine = steepAt(&calls, bad)
	rev, dist := m.Plan.Revision, m.Plan.DistanceM
	if err := e.CheckFine(m, true); err != nil {
		t.Fatal(err)
	}
	f := m.FineCheck
	if !f.Clear || f.Rounds != 1 || f.KeepOuts != 1 || f.FirstFound == nil || f.FirstFound.Stretches != 1 {
		t.Fatalf("expected one replan that clears the route, got %+v", f)
	}
	if m.Plan.Revision != rev+1 || f.Revision != m.Plan.Revision {
		t.Fatalf("plan revision %d, checked revision %d, started at %d", m.Plan.Revision, f.Revision, rev)
	}
	if len(m.Hazards) != 1 || m.Hazards[0].Source != FineSource {
		t.Fatalf("expected one keep-out from the 1 m model, got %+v", m.Hazards)
	}
	if m.Plan.DistanceM <= dist || math.Abs(f.AddedM-(m.Plan.DistanceM-dist)) > 1e-6 {
		t.Fatalf("the detour should be longer: %.1f m before, %.1f m after, reported +%.1f", dist, m.Plan.DistanceM, f.AddedM)
	}
	for _, leg := range m.Plan.Legs {
		for _, p := range leg.Points {
			if math.Hypot(p.X-bad[0], p.Y-bad[1]) <= m.Hazards[0].RadiusM {
				t.Fatalf("the new route still crosses the keep-out at %.0f, %.0f", p.X, p.Y)
			}
		}
	}
	if !m.Plan.Feasibility.OK {
		t.Fatalf("the detour should still be feasible: %s", m.Plan.Feasibility.Reason)
	}
}

func TestFineCheckCannotMoveASteepStretchAtATarget(t *testing.T) {
	e := world(t)
	m := twoTargets(t, e, "crew_rover")
	calls := 0
	e.Fine = steepAt(&calls, [2]float64{m.Targets[0].X, m.Targets[0].Y})
	rev := m.Plan.Revision
	if err := e.CheckFine(m, true); err != nil {
		t.Fatal(err)
	}
	f := m.FineCheck
	if f.Clear || len(f.Unavoidable) == 0 || len(m.Hazards) != 0 || m.Plan.Revision != rev {
		t.Fatalf("a steep stretch at a target should be reported, not avoided: %+v, %d keep-outs", f, len(m.Hazards))
	}
	if !strings.Contains(f.Summary, "at the base or a target") {
		t.Fatalf("summary does not explain why it remains: %q", f.Summary)
	}
}

func TestFineKeepOutsOutliveAResetButNotANewMoverOrANewPlan(t *testing.T) {
	e := world(t)
	m := twoTargets(t, e, "crew_rover")
	calls := 0
	e.Fine = steepAt(&calls, onRoute(m))
	if err := e.CheckFine(m, true); err != nil {
		t.Fatal(err)
	}
	m.Hazards = append(m.Hazards, planner.Hazard{ID: "sim-1", X: 300, Y: 300, RadiusM: 50, Reason: "simulated"})
	e.Reset(m)
	if len(m.Hazards) != 1 || m.Hazards[0].Source != FineSource {
		t.Fatalf("after a reset only the 1 m keep-out should remain, got %+v", m.Hazards)
	}
	if m.FineCheck != nil {
		t.Fatal("a reset replans, so the earlier check should no longer be shown as current")
	}
	if err := e.SetMover(m, "astronaut", planner.Fastest, -1); err != nil {
		t.Fatal(err)
	}
	if len(m.Hazards) != 0 {
		t.Fatalf("a different mover has a different slope limit; keep-outs should be dropped, got %+v", m.Hazards)
	}
}

// A bank runs north-south across the whole map at x = -500, too steep to cross except through one
// gap 40 m wide well north of the direct line. Keeping out of single cells would only shift the
// crossing; the survey has to follow the bank until it finds the gap.
func TestFineCheckFollowsALongBankToAGap(t *testing.T) {
	e := world(t)
	m := twoTargets(t, e, "crew_rover")
	onBank := func(x, y float64) bool { return math.Abs(x+500) <= 10 && !(y >= 200 && y <= 240) }
	checks, surveys := 0, 0
	e.Fine = func(points [][2]float64, limit float64) (*FineCheck, error) {
		checks++
		out := &FineCheck{LimitDeg: limit, SlopeDeg: map[string]float64{"max": 4}, Stretches: []FineStretch{}}
		for _, p := range points {
			if onBank(p[0], p[1]) {
				out.Stretches = append(out.Stretches, FineStretch{LengthM: 8, MaxSlopeDeg: 31, X: p[0], Y: p[1]})
				out.OverLimitM += 8
				out.SlopeDeg["max"] = 31
			}
		}
		return out, nil
	}
	e.FineCells = func(cells [][2]float64, cellM, limit float64) ([]FineCell, error) {
		surveys++
		out := make([]FineCell, len(cells))
		for i, c := range cells {
			out[i] = FineCell{X: c[0], Y: c[1], Posts: 400}
			if onBank(c[0], c[1]) {
				peak := 31.0
				out[i].SteepPosts, out[i].MaxSlopeDeg = 160, &peak
			}
		}
		return out, nil
	}
	if err := e.CheckFine(m, true); err != nil {
		t.Fatal(err)
	}
	f := m.FineCheck
	if !f.Clear || f.Rounds < 2 || f.Rounds > maxFineRounds {
		t.Fatalf("expected the route to clear after following the bank, got clear=%v after %d round(s): %s", f.Clear, f.Rounds, f.Summary)
	}
	if f.KeepOuts < 10 || f.CellsSurveyed < 100 || surveys < 2 {
		t.Fatalf("expected the bank to be surveyed and kept out: %d keep-outs, %d cells surveyed, %d surveys", f.KeepOuts, f.CellsSurveyed, surveys)
	}
	crossed := 0
	for _, leg := range m.Plan.Legs {
		for _, p := range leg.Points {
			if onBank(p.X, p.Y) {
				t.Fatalf("the route still crosses the bank at %.0f, %.0f", p.X, p.Y)
			}
			if math.Abs(p.X+500) <= 10 {
				crossed++
			}
		}
	}
	if crossed == 0 {
		t.Fatal("the route should pass through the gap in the bank")
	}
	for _, h := range m.Hazards {
		if h.Source != FineSource || h.RadiusM != e.Grid.CellM/2 {
			t.Fatalf("unexpected keep-out %+v", h)
		}
	}
	if !strings.Contains(m.Plan.Legs[0].Explanation[len(m.Plan.Legs[0].Explanation)-1], "1 m elevation model") {
		t.Fatalf("the leg should say it keeps out of steep cells: %v", m.Plan.Legs[0].Explanation)
	}
}

// The second target sits inside a ring of steep ground: every way in crosses it. A single steep spot on
// the first leg can be driven round. Keeping out of all of it at once leaves no route, so the check has
// to move the route off the spot and leave the ring crossing on the route, saying why.
func TestFineCheckAvoidsWhatItCanWhenATargetIsRingedBySteepGround(t *testing.T) {
	e := world(t)
	m := twoTargets(t, e, "crew_rover")
	spot := onRoute(m)
	tx, ty := m.Targets[1].X, m.Targets[1].Y
	inRing := func(x, y float64) bool { d := math.Hypot(x-tx, y-ty); return d >= 40 && d <= 90 }
	nearSpot := func(x, y float64) bool { return math.Hypot(x-spot[0], y-spot[1]) <= 5 }
	e.Fine = func(points [][2]float64, limit float64) (*FineCheck, error) {
		out := &FineCheck{LimitDeg: limit, SlopeDeg: map[string]float64{"max": 4}, Stretches: []FineStretch{}}
		wasIn := false
		for _, p := range points {
			in := inRing(p[0], p[1])
			if nearSpot(p[0], p[1]) || (in && !wasIn) {
				slope := 26.0
				if in {
					slope = 33
				}
				out.Stretches = append(out.Stretches, FineStretch{LengthM: 8, MaxSlopeDeg: slope, X: p[0], Y: p[1]})
				out.OverLimitM += 8
				out.SlopeDeg["max"] = math.Max(out.SlopeDeg["max"], slope)
			}
			wasIn = in
		}
		return out, nil
	}
	e.FineCells = func(cells [][2]float64, cellM, limit float64) ([]FineCell, error) {
		out := make([]FineCell, len(cells))
		for i, c := range cells {
			out[i] = FineCell{X: c[0], Y: c[1], Posts: 400}
			if inRing(c[0], c[1]) {
				peak := 33.0
				out[i].SteepPosts, out[i].MaxSlopeDeg = 120, &peak
			}
		}
		return out, nil
	}
	rev := m.Plan.Revision
	if err := e.CheckFine(m, true); err != nil {
		t.Fatal(err)
	}
	f := m.FineCheck
	if f.Clear || f.Rounds < 1 || len(m.Hazards) == 0 || m.Plan.Revision <= rev {
		t.Fatalf("expected the route to be moved but not cleared: %+v, %d keep-outs", f, len(m.Hazards))
	}
	for _, h := range m.Hazards {
		if h.Source != FineSource {
			t.Fatalf("unexpected keep-out %+v", h)
		}
	}
	crossesRing := false
	for _, leg := range m.Plan.Legs {
		for _, p := range leg.Points {
			if nearSpot(p.X, p.Y) {
				t.Fatalf("the route still passes the avoidable steep spot at %.0f, %.0f", p.X, p.Y)
			}
			crossesRing = crossesRing || inRing(p.X, p.Y)
		}
	}
	if !crossesRing {
		t.Fatal("the ring cannot be avoided, yet the route does not cross it")
	}
	visited := 0
	for _, leg := range m.Plan.Legs {
		end := leg.Points[len(leg.Points)-1]
		if math.Hypot(end.X-tx, end.Y-ty) < 30 {
			visited++
		}
	}
	if visited != 1 {
		t.Fatalf("the ringed target should still be reached once, got %d", visited)
	}
	if !strings.Contains(f.Summary, "left on the route") && !strings.Contains(f.Summary, "stays on the route") {
		t.Fatalf("summary does not say why steep ground remains: %q", f.Summary)
	}
}
