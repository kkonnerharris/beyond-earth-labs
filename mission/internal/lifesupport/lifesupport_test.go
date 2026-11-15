package lifesupport

import (
	"math"
	"testing"
)

func base() Input {
	return Input{Crew: 4, Sols: 500, LatitudeDeg: 18.4, Body: "mars"}
}

func TestOxygenAndWaterScaleWithCrew(t *testing.T) {
	a := Compute(base())
	in := base()
	in.Crew = 8
	b := Compute(in)
	if math.Abs(b.OxygenNeedKg-2*a.OxygenNeedKg) > 1e-9 || math.Abs(b.WaterNeedKg-2*a.WaterNeedKg) > 1e-9 {
		t.Fatal("doubling the crew must double oxygen and water needs")
	}
	// Four people at 0.84 kg per Earth day over one 24.66 h sol.
	want := 4 * 0.84 * 24.66 / 24
	if math.Abs(a.OxygenNeedKg-want) > 1e-9 {
		t.Fatalf("oxygen need %.4f, want %.4f", a.OxygenNeedKg, want)
	}
}

func TestOxygenBalanceCloses(t *testing.T) {
	in := base()
	in.CropAreaM2 = map[string]float64{"potato": 60, "lettuce": 10}
	b := Compute(in)
	supplied := b.OxygenFromPlantsKg + b.OxygenRecycledKg + b.OxygenMakeupKg
	if b.OxygenFromPlantsKg < b.OxygenNeedKg && math.Abs(supplied-b.OxygenNeedKg) > 1e-9 {
		t.Fatalf("oxygen sources %.4f do not add up to the need %.4f", supplied, b.OxygenNeedKg)
	}
	if b.OxygenMakeupKg < 0 {
		t.Fatal("negative oxygen makeup")
	}
}

func TestGreenhouseCostsPowerAndWaterAndFeedsPeople(t *testing.T) {
	none := Compute(base())
	in := base()
	in.CropAreaM2 = map[string]float64{"potato": 100}
	g := Compute(in)
	if !(g.LoadKWh > none.LoadKWh) {
		t.Fatal("grow lights must add to the electrical load")
	}
	if !(g.WaterMakeupKg > none.WaterMakeupKg) {
		t.Fatal("crop water must add to the recycling losses")
	}
	if !(g.FoodGrownShare > 0 && g.FoodShippedKg < none.FoodShippedKg) {
		t.Fatal("a greenhouse must reduce shipped food")
	}
	// Lighting energy from first principles: 28 mol/m2/day over 100 m2 for one sol.
	wantKWh := 28.0 * 100 * (24.66 / 24) * 1e6 / 2.7 / 3.6e6
	if math.Abs(g.GrowLightKWh-wantKWh) > 1e-6 {
		t.Fatalf("grow light %.3f kWh, want %.3f", g.GrowLightKWh, wantKWh)
	}
}

func TestDustStormCutsSolarPower(t *testing.T) {
	clear := Compute(base())
	in := base()
	in.Overrides = map[string]float64{"dust_opacity_tau": 4}
	storm := Compute(in)
	if !(storm.SolarKWh < 0.5*clear.SolarKWh) {
		t.Fatalf("tau 4 should more than halve solar energy: %.0f vs %.0f kWh", storm.SolarKWh, clear.SolarKWh)
	}
	if storm.LoadKWh != clear.LoadKWh {
		t.Fatal("dust changes supply, not load")
	}
}

func TestOverriddenAssumptionIsReportedAsUserSet(t *testing.T) {
	in := base()
	in.Overrides = map[string]float64{"solar_array_m2": 900}
	b := Compute(in)
	found := false
	for _, a := range b.Assumptions {
		if a.Key == "solar_array_m2" {
			found = a.Value == 900 && len(a.Basis) > 0 && a.Basis[:11] == "Set by the "
		}
	}
	if !found {
		t.Fatal("override not reflected in the reported assumptions")
	}
}

func TestRadiationAccumulatesWithStayLengthAndRespondsToTheDoseRate(t *testing.T) {
	b := Compute(base())
	// 0.64 mSv per Earth day, 500 sols of 24.66 h.
	want := 0.64 * (24.66 / 24) * 500
	if math.Abs(b.RadiationStayMSv-want) > 1e-6 {
		t.Fatalf("stay dose %.2f mSv, want %.2f", b.RadiationStayMSv, want)
	}
	if math.Abs(b.RadiationShareOfLimit-want/600) > 1e-9 {
		t.Fatalf("share of limit %.4f, want %.4f", b.RadiationShareOfLimit, want/600)
	}
	in := base()
	in.Sols = 250
	if half := Compute(in); math.Abs(half.RadiationStayMSv-want/2) > 1e-6 {
		t.Fatal("half the stay should give half the dose")
	}
	in = base()
	in.Overrides = map[string]float64{"surface_dose_msv_per_day": 0.32}
	if low := Compute(in); math.Abs(low.RadiationStayMSv-want/2) > 1e-6 {
		t.Fatal("half the dose rate should give half the dose")
	}
	in = base()
	in.Body = "moon"
	if Compute(in).RadiationStayMSv != 0 {
		t.Fatal("the Mars surface dose rate must not be applied to the Moon")
	}
}

func TestInsolationFallsWithLatitudeAndIsLowerOnMarsThanMoon(t *testing.T) {
	eq := DailyMeanInsolation("mars", 0, 0, 0.26)
	mid := DailyMeanInsolation("mars", 45, 0, 0.26)
	if !(mid < eq) {
		t.Fatal("insolation should fall with latitude")
	}
	if math.Abs(eq-586.2/math.Pi) > 1e-9 {
		t.Fatalf("equatorial equinox mean should be S/pi, got %.2f", eq)
	}
	if !(DailyMeanInsolation("moon", 0, 0, 0.26) > eq) {
		t.Fatal("the Moon receives more sunlight than Mars")
	}
}
