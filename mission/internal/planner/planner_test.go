package planner

import (
	"errors"
	"math"
	"os"
	"path/filepath"
	"testing"

	"beyondearthlabs/mission/internal/mobility"
	"beyondearthlabs/mission/internal/terrain"
)

// flat builds an n x n grid of flat, smooth ground with 10 m cells.
func flat(t *testing.T, n int) *terrain.Grid {
	t.Helper()
	z, s, r := make([]float32, n*n), make([]float32, n*n), make([]float32, n*n)
	g, err := terrain.New("mars", n, 10, 18.4, 77.4, z, s, r)
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func req(g *terrain.Grid, obj Objective) Request {
	h := g.Half()
	return Request{Profile: mobility.Profiles["crew_rover"], Objective: obj,
		StartX: -h + 15, StartY: 0, GoalX: h - 15, GoalY: 0, RiskWeight: 1}
}

func TestFlatGroundRouteIsStraight(t *testing.T) {
	g := flat(t, 60)
	rt, err := Plan(g, req(g, Fastest))
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(rt.DistanceM-rt.StraightLineM) > 1e-6 {
		t.Fatalf("distance %.1f, straight line %.1f", rt.DistanceM, rt.StraightLineM)
	}
	p := mobility.Profiles["crew_rover"]
	if want := rt.DistanceM / p.SpeedFlatMS; math.Abs(rt.Seconds-want) > 1e-6 {
		t.Fatalf("seconds %.2f, want %.2f", rt.Seconds, want)
	}
}

func TestRouteGoesThroughTheOnlyGapInASteepWall(t *testing.T) {
	g := flat(t, 60)
	gapRow := 50
	for row := 0; row < g.N; row++ {
		if row == gapRow {
			continue
		}
		g.Slope[g.Index(row, 30)] = 35 // beyond every profile's limit
	}
	rt, err := Plan(g, req(g, Fastest))
	if err != nil {
		t.Fatal(err)
	}
	crossed := false
	for _, pt := range rt.Points {
		row, col, _ := g.CellAt(pt.X, pt.Y)
		if col == 30 {
			if row != gapRow {
				t.Fatalf("route crossed the wall at row %d, not the gap", row)
			}
			crossed = true
		}
		if pt.SlopeDeg > mobility.Profiles["crew_rover"].MaxSlopeDeg {
			t.Fatalf("route entered a %.0f degree cell", pt.SlopeDeg)
		}
	}
	if !crossed {
		t.Fatal("route never crossed the wall column")
	}
	if rt.DistanceM <= rt.StraightLineM*1.05 {
		t.Fatalf("expected a detour, got %.0f m against %.0f m straight", rt.DistanceM, rt.StraightLineM)
	}
}

func TestSealedWallMeansNoRoute(t *testing.T) {
	g := flat(t, 40)
	for row := 0; row < g.N; row++ {
		g.Slope[g.Index(row, 20)] = 35
	}
	if _, err := Plan(g, req(g, Fastest)); !errors.Is(err, ErrNoRoute) {
		t.Fatalf("want ErrNoRoute, got %v", err)
	}
}

func TestReportedHazardIsAvoided(t *testing.T) {
	g := flat(t, 60)
	r := req(g, Fastest)
	direct, err := Plan(g, r)
	if err != nil {
		t.Fatal(err)
	}
	r.Hazards = []Hazard{{ID: "h1", X: 0, Y: 0, RadiusM: 80, Reason: "test"}}
	rt, err := Plan(g, r)
	if err != nil {
		t.Fatal(err)
	}
	for _, pt := range rt.Points {
		if math.Hypot(pt.X, pt.Y) <= 80 {
			t.Fatalf("route passes %.0f m from the hazard centre", math.Hypot(pt.X, pt.Y))
		}
	}
	if rt.DistanceM <= direct.DistanceM {
		t.Fatal("avoiding a hazard on the direct line must lengthen the route")
	}
}

// A ridge lies across the direct line. Going over is shorter; going around is flat.
func ridge(t *testing.T) *terrain.Grid {
	g := flat(t, 80)
	for row := 0; row < 60; row++ { // the ridge stops short of the southern rows
		for col := 30; col < 50; col++ {
			d := 10 - math.Abs(float64(col)-39.5)
			h := d * 3.0 // 3 m per 10 m cell on each flank: about 16.7 degrees
			g.Elevation[g.Index(row, col)] = float32(h)
			g.Slope[g.Index(row, col)] = 16.7
		}
	}
	return g
}

func TestEnergyObjectiveUsesNoMoreEnergyThanTimeObjective(t *testing.T) {
	g := ridge(t)
	h := g.Half()
	base := Request{Profile: mobility.Profiles["crew_rover"], StartX: -h + 15, StartY: 200, GoalX: h - 15, GoalY: 200}
	base.Objective = Fastest
	fast, err := Plan(g, base)
	if err != nil {
		t.Fatal(err)
	}
	base.Objective = LeastEnergy
	lean, err := Plan(g, base)
	if err != nil {
		t.Fatal(err)
	}
	if lean.Joules > fast.Joules+1e-6 {
		t.Fatalf("energy route uses %.0f J, time route %.0f J", lean.Joules, fast.Joules)
	}
	if fast.Seconds > lean.Seconds+1e-6 {
		t.Fatalf("time route takes %.0f s, energy route %.0f s", fast.Seconds, lean.Seconds)
	}
}

func TestRiskWeightKeepsRouteOffSteepGround(t *testing.T) {
	g := ridge(t)
	h := g.Half()
	r := Request{Profile: mobility.Profiles["crew_rover"], Objective: Fastest,
		StartX: -h + 15, StartY: 200, GoalX: h - 15, GoalY: 200}
	r.RiskWeight = 0
	bold, err := Plan(g, r)
	if err != nil {
		t.Fatal(err)
	}
	r.RiskWeight = 6
	careful, err := Plan(g, r)
	if err != nil {
		t.Fatal(err)
	}
	if careful.MeanSlopeDeg > bold.MeanSlopeDeg+1e-9 {
		t.Fatalf("higher risk weight raised mean slope: %.2f > %.2f", careful.MeanSlopeDeg, bold.MeanSlopeDeg)
	}
}

func TestStartOnForbiddenGroundIsRefusedWithAReason(t *testing.T) {
	g := flat(t, 30)
	r := req(g, Fastest)
	row, col, _ := g.CellAt(r.StartX, r.StartY)
	g.Slope[g.Index(row, col)] = 40
	if _, err := Plan(g, r); err == nil || errors.Is(err, ErrNoRoute) {
		t.Fatalf("want an explanation that the start is beyond limits, got %v", err)
	}
}

// The real Jezero grid, when it has been built: plan from the Perseverance
// landing site to the delta front and check the route obeys the limits.
func TestJezeroLandingSiteToDeltaFront(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "data", "jezero")
	if _, err := os.Stat(filepath.Join(dir, "terrain.bin")); err != nil {
		t.Skip("data/jezero has not been built")
	}
	g, err := terrain.Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	ls := g.Meta.LandingSite
	for _, key := range []string{"scout", "crew_rover", "astronaut"} {
		p := mobility.Profiles[key]
		rt, err := Plan(g, Request{Profile: p, Objective: Fastest, StartX: ls.X, StartY: ls.Y,
			GoalX: ls.X - 3000, GoalY: ls.Y + 1500, RiskWeight: 1})
		if err != nil {
			t.Fatalf("%s: %v", key, err)
		}
		if rt.MaxSlopeDeg > p.MaxSlopeDeg {
			t.Fatalf("%s: route reaches %.1f degrees, limit %.0f", key, rt.MaxSlopeDeg, p.MaxSlopeDeg)
		}
		if rt.DistanceM < rt.StraightLineM-1e-6 {
			t.Fatalf("%s: route shorter than the straight line", key)
		}
		t.Logf("%s: %.0f m (straight %.0f m), %.1f h, %.2f kWh, max slope %.1f deg, %d nodes",
			key, rt.DistanceM, rt.StraightLineM, rt.Seconds/3600, rt.Joules/3.6e6, rt.MaxSlopeDeg, rt.NodesExpanded)
	}
}
