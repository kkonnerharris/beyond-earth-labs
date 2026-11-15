package mobility

import (
	"math"
	"testing"
)

func TestRoverUsesMoreEnergyUphillAndNothingExtraForBraking(t *testing.T) {
	p := Profiles["crew_rover"]
	g := Gravity("mars")
	flat, _ := p.Move(100, 0, 0, 0, g)
	up, _ := p.Move(100, 10, 6, 0, g)
	down, _ := p.Move(100, -10, 6, 0, g)
	if !(up.Joules > flat.Joules) {
		t.Fatalf("uphill %.0f J should exceed flat %.0f J", up.Joules, flat.Joules)
	}
	if !(down.Joules < flat.Joules) {
		t.Fatalf("downhill %.0f J should be below flat %.0f J", down.Joules, flat.Joules)
	}
	// Downhill never goes below hotel power for the time taken (no regeneration).
	if down.Joules < p.HotelPowerW*down.Seconds-1e-6 {
		t.Fatal("downhill energy fell below hotel load")
	}
}

func TestFlatRoverEnergyMatchesHandCalculation(t *testing.T) {
	p := Profiles["crew_rover"]
	g := Gravity("mars")
	s, ok := p.Move(1000, 0, 0, 0, g)
	if !ok {
		t.Fatal("flat ground refused")
	}
	seconds := 1000 / p.SpeedFlatMS
	want := p.MassKg*g*p.RollingResistance*1000/p.DriveEfficiency + p.HotelPowerW*seconds
	if math.Abs(s.Joules-want) > 1e-6*want {
		t.Fatalf("got %.1f J, want %.1f J", s.Joules, want)
	}
}

func TestSameRoverNeedsLessEnergyOnTheMoonThanOnMars(t *testing.T) {
	p := Profiles["crew_rover"]
	mars, _ := p.Move(500, 20, 5, 0, Gravity("mars"))
	moon, _ := p.Move(500, 20, 5, 0, Gravity("moon"))
	if !(moon.Joules < mars.Joules) {
		t.Fatalf("moon %.0f J should be below mars %.0f J", moon.Joules, mars.Joules)
	}
}

func TestLimitsAreHard(t *testing.T) {
	p := Profiles["scout"]
	if _, ok := p.Move(20, 0, p.MaxSlopeDeg+0.1, 0, Gravity("mars")); ok {
		t.Fatal("entered a cell steeper than the limit")
	}
	if _, ok := p.Move(20, 0, 0, p.MaxRoughnessM+0.01, Gravity("mars")); ok {
		t.Fatal("entered a cell rougher than the limit")
	}
	if _, ok := p.Move(20, 20, 5, 0, Gravity("mars")); ok { // 45 degree step between cells
		t.Fatal("accepted a 45 degree climb between cells")
	}
}

func TestAstronautSlowsOnGradesAndBurnsMoreOxygenClimbing(t *testing.T) {
	p := Profiles["astronaut"]
	g := Gravity("mars")
	flat, _ := p.Move(100, 0, 0, 0, g)
	up, _ := p.Move(100, 100*math.Tan(10*math.Pi/180), 10, 0, g)
	if !(up.SpeedMS < flat.SpeedMS) {
		t.Fatalf("climbing speed %.2f should be below level speed %.2f", up.SpeedMS, flat.SpeedMS)
	}
	if !(up.Joules > flat.Joules) {
		t.Fatal("climbing should cost more metabolic energy than level walking")
	}
	// Level walking metabolic rate should sit in a plausible suited range.
	rate := flat.Joules / flat.Seconds
	if rate < 150 || rate > 600 {
		t.Fatalf("level metabolic rate %.0f W is outside 150-600 W", rate)
	}
	oxygenPerHour := rate * 3600 * OxygenKgPerJoule
	if oxygenPerHour < 0.03 || oxygenPerHour > 0.16 {
		t.Fatalf("oxygen use %.3f kg/h is outside 0.03-0.16 kg/h", oxygenPerHour)
	}
}

// The planner's heuristic is only valid if no step can ever be cheaper than these bounds.
func TestHeuristicBoundsAreNeverBeaten(t *testing.T) {
	for key, p := range Profiles {
		for _, body := range []string{"mars", "moon"} {
			g := Gravity(body)
			for grade := -24.0; grade <= 24; grade += 1 {
				for _, rough := range []float64{0, 0.3, 0.7} {
					dist := 20.0
					s, ok := p.Move(dist, dist*math.Tan(grade*math.Pi/180), math.Abs(grade), rough, g)
					if !ok {
						continue
					}
					if s.Seconds < dist*p.FastestSecondsPerMetre()-1e-9 {
						t.Fatalf("%s on %s at %.0f deg: %.3f s beats the time bound", key, body, grade, s.Seconds)
					}
					if s.Joules < dist*p.LeastJoulesPerMetre()-1e-9 {
						t.Fatalf("%s on %s at %.0f deg: %.1f J beats the energy bound", key, body, grade, s.Joules)
					}
				}
			}
		}
	}
}
