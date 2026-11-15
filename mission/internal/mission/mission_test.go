package mission

import (
	"math"
	"strings"
	"testing"

	"beyondearthlabs/mission/internal/planner"
	"beyondearthlabs/mission/internal/terrain"
)

// world is 3 km of flat ground with 20 m cells.
func world(t *testing.T) *Engine {
	t.Helper()
	n := 150
	g, err := terrain.New("mars", n, 20, 18.465, 77.385, make([]float32, n*n), make([]float32, n*n), make([]float32, n*n))
	if err != nil {
		t.Fatal(err)
	}
	return &Engine{Grid: g}
}

func twoTargets(t *testing.T, e *Engine, mover string) *Mission {
	t.Helper()
	m, err := e.New("m1", "Test", mover, -1000, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.AddTarget(m, "Outcrop", "Sample layered rock", 0, 0, 10); err != nil {
		t.Fatal(err)
	}
	if err := e.AddTarget(m, "Ridge", "Image the scarp", 600, 400, 10); err != nil {
		t.Fatal(err)
	}
	return m
}

func run(e *Engine, m *Mission, maxSeconds float64) {
	for t := 0.0; t < maxSeconds && (m.Sim.Phase == PhaseMoving || m.Sim.Phase == PhaseDwelling); t += 30 {
		e.Step(m, 30)
	}
}

func TestNominalTraverseVisitsEveryTargetAndComesHome(t *testing.T) {
	e := world(t)
	m := twoTargets(t, e, "crew_rover")
	if m.Plan == nil || len(m.Plan.Legs) != 3 || !m.Plan.Feasibility.OK {
		t.Fatalf("expected a feasible 3-leg plan, got %+v", m.Plan)
	}
	if err := e.Start(m); err != nil {
		t.Fatal(err)
	}
	run(e, m, 1e6)
	if m.Sim.Phase != PhaseComplete {
		t.Fatalf("phase %s, want complete", m.Sim.Phase)
	}
	for _, tg := range m.Targets {
		if !tg.Visited {
			t.Fatalf("%s was not visited", tg.Name)
		}
	}
	if d := math.Hypot(m.Sim.X-m.Base.X, m.Sim.Y-m.Base.Y); d > e.Grid.CellM {
		t.Fatalf("finished %.0f m from base", d)
	}
	// The simulation must reproduce the plan: same distance, time and consumable use.
	if math.Abs(m.Sim.DistanceM-m.Plan.DistanceM) > 1 {
		t.Fatalf("simulated %.1f m, planned %.1f m", m.Sim.DistanceM, m.Plan.DistanceM)
	}
	if math.Abs(m.Sim.Seconds-m.Plan.Seconds) > 31 {
		t.Fatalf("simulated %.0f s, planned %.0f s", m.Sim.Seconds, m.Plan.Seconds)
	}
	used := m.Sim.Capacity - m.Sim.Remaining
	if math.Abs(used-m.Plan.Feasibility.Needed) > 0.01*m.Plan.Feasibility.Needed {
		t.Fatalf("simulated use %.2f, planned %.2f", used, m.Plan.Feasibility.Needed)
	}
}

func TestInfeasiblePlanIsRefusedWithNumbers(t *testing.T) {
	e := world(t)
	m, _ := e.New("m2", "Too far", "astronaut", -1400, -1400)
	// A long loop on foot: more oxygen than the suit carries with reserve.
	_ = e.AddTarget(m, "Far A", "", 1400, -1400, 30)
	_ = e.AddTarget(m, "Far B", "", 1400, 1400, 30)
	_ = e.AddTarget(m, "Far C", "", -1400, 1400, 30)
	if m.Plan == nil {
		t.Fatal("expected a plan")
	}
	if m.Plan.Feasibility.OK {
		t.Fatalf("an %.0f m walk should not be feasible: %s", m.Plan.DistanceM, m.Plan.Feasibility.Reason)
	}
	err := e.Start(m)
	if err == nil || !strings.Contains(err.Error(), "refused") {
		t.Fatalf("start should be refused, got %v", err)
	}
}

func TestObstacleForcesAReplanThatAvoidsIt(t *testing.T) {
	e := world(t)
	m := twoTargets(t, e, "crew_rover")
	_ = e.Start(m)
	e.Step(m, 60)
	if err := e.Inject(m, "obstacle"); err != nil {
		t.Fatal(err)
	}
	if len(m.Hazards) != 1 || m.Sim.Replans < 1 {
		t.Fatalf("expected one hazard and a replan; hazards %d, replans %d", len(m.Hazards), m.Sim.Replans)
	}
	h := m.Hazards[0]
	for _, leg := range m.Sim.ActiveLegs {
		for _, p := range leg.Points {
			if math.Hypot(p.X-h.X, p.Y-h.Y) <= h.RadiusM {
				t.Fatal("the replanned route enters the keep-out area")
			}
		}
	}
	run(e, m, 1e6)
	if m.Sim.Phase != PhaseComplete || !m.Targets[0].Visited || !m.Targets[1].Visited {
		t.Fatalf("mission should still finish after the detour; phase %s", m.Sim.Phase)
	}
	if m.Sim.DistanceM <= m.Plan.DistanceM {
		t.Fatal("the detour should be longer than the original plan")
	}
}

func TestObstacleWhileStoppedAtATargetIsPlacedAheadOnTheNextLeg(t *testing.T) {
	e := world(t)
	m := twoTargets(t, e, "crew_rover")
	_ = e.Start(m)
	for i := 0; i < 400 && m.Sim.Phase != PhaseDwelling; i++ {
		e.Step(m, 10)
	}
	if m.Sim.Phase != PhaseDwelling {
		t.Fatalf("expected to be working at the first target, phase %s", m.Sim.Phase)
	}
	if err := e.Inject(m, "obstacle"); err != nil {
		t.Fatal(err)
	}
	h := m.Hazards[0]
	if d := math.Hypot(h.X-m.Sim.X, h.Y-m.Sim.Y); d < 100 {
		t.Fatalf("obstacle placed %.0f m from the mover; it should be about 150 m ahead", d)
	}
	run(e, m, 1e6)
	if m.Sim.Phase != PhaseComplete || !m.Targets[1].Visited {
		t.Fatalf("mission should finish around the obstacle; phase %s", m.Sim.Phase)
	}
}

func TestLeakTurnsTheTraverseBackBeforeTheReserveIsBroken(t *testing.T) {
	e := world(t)
	// A 6.6 km walk: feasible when nominal (about 0.35 kg of the 0.55 kg carried, with reserve),
	// but not with an extra 0.08 kg per hour leaking for the two and a half hours it takes.
	m, _ := e.New("m3", "Leak", "astronaut", -1400, 0)
	_ = e.AddTarget(m, "Outcrop", "", 600, 0, 20)
	_ = e.AddTarget(m, "Ridge", "", 1400, 1300, 20)
	if !m.Plan.Feasibility.OK {
		t.Fatalf("baseline plan should be feasible: %s", m.Plan.Feasibility.Reason)
	}
	_ = e.Start(m)
	e.Step(m, 300)
	if err := e.Inject(m, "leak"); err != nil {
		t.Fatal(err)
	}
	run(e, m, 1e6)
	if !m.Sim.TurnedBack {
		t.Fatal("a leak this large should force a turn-back")
	}
	if m.Sim.Phase != PhaseComplete {
		t.Fatalf("phase %s: the crew member should reach base", m.Sim.Phase)
	}
	if m.Sim.Remaining <= 0 {
		t.Fatal("oxygen ran out")
	}
	if m.Targets[1].Visited {
		t.Fatal("the far target should have been abandoned")
	}
}

func TestDustStormOrdersReturnAndCutsHabitatSolar(t *testing.T) {
	e := world(t)
	m := twoTargets(t, e, "crew_rover")
	before := m.Habitat.SolarKWh
	_ = e.Start(m)
	e.Step(m, 120)
	if err := e.Inject(m, "dust_storm"); err != nil {
		t.Fatal(err)
	}
	if !m.Sim.TurnedBack {
		t.Fatal("the dust rule should order a return")
	}
	if !(m.Habitat.SolarKWh < 0.5*before) {
		t.Fatalf("habitat solar should fall sharply: %.0f -> %.0f kWh", before, m.Habitat.SolarKWh)
	}
	run(e, m, 1e6)
	if m.Sim.Phase != PhaseComplete {
		t.Fatalf("phase %s, want complete", m.Sim.Phase)
	}
}

func TestHealthAnomalySlowsTheCrewAndRecalculates(t *testing.T) {
	e := world(t)
	m, _ := e.New("m4", "Health", "astronaut", -600, 0)
	_ = e.AddTarget(m, "Outcrop", "", 0, 0, 10)
	planned := m.Plan.Seconds
	_ = e.Start(m)
	e.Step(m, 120)
	if err := e.Inject(m, "crew_health"); err != nil {
		t.Fatal(err)
	}
	run(e, m, 1e6)
	if m.Sim.Phase != PhaseComplete {
		t.Fatalf("phase %s, want complete", m.Sim.Phase)
	}
	if !(m.Sim.Seconds > planned*1.2) {
		t.Fatalf("a slower pace should lengthen the traverse: %.0f s against %.0f s planned", m.Sim.Seconds, planned)
	}
}

func TestGreenhouseChangesHabitatBudgetThroughTheMission(t *testing.T) {
	e := world(t)
	m := twoTargets(t, e, "crew_rover")
	load := m.Habitat.LoadKWh
	e.SetHabitat(m, 4, 500, map[string]float64{"potato": 80}, nil)
	if !(m.Habitat.LoadKWh > load && m.Habitat.FoodGrownShare > 0) {
		t.Fatal("a greenhouse should raise the load and grow some of the food")
	}
}

func TestHealthMonitorTracksWorkloadAndFlagsAnUnexplainedHeartRate(t *testing.T) {
	e := world(t)
	m, _ := e.New("h1", "Health", "astronaut", -600, 0)
	_ = e.AddTarget(m, "Outcrop", "", 400, 0, 10)
	if !m.Sim.Health.Monitored || m.Sim.Health.HeartRate != 62 {
		t.Fatalf("a walker should be monitored and start at rest: %+v", m.Sim.Health)
	}
	_ = e.Start(m)
	for i := 0; i < 20; i++ {
		e.Step(m, 30)
	}
	h := m.Sim.Health
	if h.MetabolicW < 200 || h.HeartRate < 100 {
		t.Fatalf("walking should raise metabolic rate and heart rate: %.0f W, %.0f bpm", h.MetabolicW, h.HeartRate)
	}
	if math.Abs(h.HeartRate-h.ExpectedRate) > 3 || h.Anomaly {
		t.Fatalf("nominal walking must match the workload model and raise no anomaly: %.1f vs %.1f", h.HeartRate, h.ExpectedRate)
	}
	if len(h.History) < 8 || h.Fatigue <= 0 {
		t.Fatal("history and fatigue should accumulate")
	}
	_ = e.Inject(m, "crew_health")
	for i := 0; i < 20; i++ {
		e.Step(m, 30)
	}
	if !m.Sim.Health.Anomaly {
		t.Fatalf("the detector should flag the simulated fault: %.1f vs expected %.1f", m.Sim.Health.HeartRate, m.Sim.Health.ExpectedRate)
	}
	flagged := false
	for _, ev := range m.Events {
		if strings.Contains(ev.Message, "Health monitor") {
			flagged = true
		}
	}
	if !flagged {
		t.Fatal("the anomaly should be written to the mission log")
	}

	scout, _ := e.New("h2", "Scout", "scout", -600, 0)
	if scout.Sim.Health.Monitored {
		t.Fatal("a robotic rover carries no crew to monitor")
	}
}

func TestHandDrivingObeysTheSameLimitsAsARoute(t *testing.T) {
	e := world(t)
	m, _ := e.New("d1", "Drive", "crew_rover", 0, 0)
	if err := e.Drive(m, 0, 40); err != nil { // north
		t.Fatal(err)
	}
	// The base sits at a cell centre, so positions are measured from it.
	if m.Sim.Phase != PhaseManual || math.Abs(m.Sim.Y-(m.Base.Y+40)) > 1e-6 || math.Abs(m.Sim.X-m.Base.X) > 1e-6 {
		t.Fatalf("40 m north of base expected: (%.2f, %.2f) from base (%.2f, %.2f), phase %s", m.Sim.X, m.Sim.Y, m.Base.X, m.Base.Y, m.Sim.Phase)
	}
	if err := e.Drive(m, 90, 30); err != nil { // east
		t.Fatal(err)
	}
	if math.Abs(m.Sim.X-(m.Base.X+30)) > 1e-6 || m.Sim.HeadingDeg != 90 {
		t.Fatalf("30 m east of base expected, heading 90: x %.2f heading %.0f", m.Sim.X, m.Sim.HeadingDeg)
	}
	if !(m.Sim.Remaining < m.Sim.Capacity) || math.Abs(m.Sim.DistanceM-70) > 1e-6 {
		t.Fatal("driving must use battery and count distance")
	}
	if m.Sim.ReturnM <= 0 {
		t.Fatal("the way home should be tracked while driving by hand")
	}

	// A steep cell ahead stops the mover at its edge with a reason.
	row, col, _ := e.Grid.CellAt(m.Sim.X+60, m.Sim.Y)
	e.Grid.Slope[e.Grid.Index(row, col)] = 35
	before := m.Sim.X
	err := e.Drive(m, 90, 120)
	if err == nil || !strings.Contains(err.Error(), "blocked") {
		t.Fatalf("want a blocked message, got %v", err)
	}
	if !(m.Sim.X > before) || m.Sim.X >= before+60 {
		t.Fatalf("the mover should stop short of the steep cell: moved %.1f m", m.Sim.X-before)
	}

	if err := e.Drive(m, 0, 0); err == nil {
		t.Fatal("a zero-length drive should be refused")
	}
	if err := e.Start(m); err == nil {
		t.Fatal("a planned traverse cannot start while driving by hand")
	}
	e.Reset(m)
	if m.Sim.Phase != PhaseIdle || m.Sim.X != m.Base.X {
		t.Fatal("reset should return the mover to base")
	}
	// The edge of the map is a wall, not a crash.
	if err := e.Drive(m, 270, 200); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 20; i++ {
		_ = e.Drive(m, 270, 200)
	}
	if _, _, ok := e.Grid.CellAt(m.Sim.X, m.Sim.Y); !ok {
		t.Fatal("the mover left the mapped area")
	}
}

func TestScoreRewardsScienceSafetyAndEfficiency(t *testing.T) {
	e := world(t)
	m := twoTargets(t, e, "crew_rover")
	if m.Score != nil {
		t.Fatal("no score before the traverse has run")
	}
	_ = e.Start(m)
	e.Step(m, 60)
	if m.Score != nil {
		t.Fatal("no score while the traverse is under way")
	}
	run(e, m, 1e6)
	if m.Score == nil || m.Score.Total != 100 || m.Score.Rank != "Flight director" {
		t.Fatalf("a nominal traverse should score 100, got %+v", m.Score)
	}

	// A dust storm before the first target: nothing visited, but home safely.
	m2 := twoTargets(t, e, "crew_rover")
	_ = e.Start(m2)
	e.Step(m2, 60)
	_ = e.Inject(m2, "dust_storm")
	run(e, m2, 1e6)
	if m2.Score == nil || m2.Score.Lines[0].Points != 0 || m2.Score.Lines[1].Points != 25 {
		t.Fatalf("an early turn-back should score no science and full safety, got %+v", m2.Score)
	}
	if m2.Score.Total >= m.Score.Total {
		t.Fatal("turning back early must score below a complete traverse")
	}

	e.Reset(m)
	if m.Score != nil {
		t.Fatal("reset should clear the score")
	}
}

func TestResetRestoresTheMission(t *testing.T) {
	e := world(t)
	m := twoTargets(t, e, "crew_rover")
	_ = e.Start(m)
	e.Step(m, 200)
	_ = e.Inject(m, "obstacle")
	e.Reset(m)
	if m.Sim.Phase != PhaseIdle || len(m.Hazards) != 0 || m.Sim.Remaining != m.Sim.Capacity || m.Plan == nil {
		t.Fatal("reset should clear hazards, refill consumables and restore the plan")
	}
	if m.Objective != planner.Fastest {
		t.Fatal("reset must not change planning preferences")
	}
}
