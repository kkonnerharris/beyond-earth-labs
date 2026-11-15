// Package lifesupport computes habitat resource budgets: oxygen, water, food,
// power, and what a greenhouse adds and costs.
//
// Everything here is an engineering estimate from stated assumptions. Each
// assumption is a named field with its basis so the interface can show it and
// the user can change it. Values marked "verify" were entered from memory of
// the cited NASA document and must be checked against it before the numbers
// are quoted anywhere.
package lifesupport

import "math"

// Assumption is one number the budget depends on, with where it comes from.
type Assumption struct {
	Key    string  `json:"key"`
	Label  string  `json:"label"`
	Value  float64 `json:"value"`
	Unit   string  `json:"unit"`
	Basis  string  `json:"basis"`
	Verify bool    `json:"verify"` // true: recalled from the cited source, not yet checked against it
}

const bvad = "NASA Baseline Values and Assumptions Document (Anderson et al., NASA/TP-2015-218570 Rev. 1)"

// Defaults returns the default assumptions keyed by name.
func Defaults() map[string]Assumption {
	list := []Assumption{
		{"o2_kg_per_person_day", "Oxygen breathed", 0.84, "kg per person per day", bvad, true},
		{"water_kg_per_person_day", "Drinking, food and hygiene water", 3.9, "kg per person per day", bvad + ", drinking plus food preparation plus basic hygiene", true},
		{"food_kg_per_person_day", "Food (dry mass)", 0.62, "kg per person per day", bvad, true},
		{"energy_kcal_per_person_day", "Dietary energy", 3000, "kcal per person per day", bvad + ", active crew member", true},
		{"water_recovery", "Water recycled", 0.90, "fraction", "Assumption. The International Space Station's system has demonstrated higher recovery; 0.90 is deliberately conservative.", false},
		{"o2_recovery", "Oxygen recovered from carbon dioxide", 0.45, "fraction", "Assumption, in the range of a Sabatier-type system.", false},
		{"habitat_base_kw", "Habitat base electrical load", 12, "kW", "Assumption for a four-person surface habitat. Not a NASA design value.", false},
		{"solar_array_m2", "Solar array area", 400, "m2", "Assumption.", false},
		{"solar_efficiency", "Array efficiency", 0.25, "fraction", "Assumption, including wiring and dust-free cell performance.", false},
		{"dust_opacity_tau", "Dust optical depth", 0.5, "tau", "Assumption for a clear season. A regional dust storm can exceed 3.", false},
		{"tau_transmission_k", "Loss of sunlight per unit optical depth", 0.26, "per tau", "Assumption: sunlight reaching a flat panel falls as exp(-k tau). Scattered light keeps the total from dropping as fast as the direct beam. Check against Appelbaum and Flood (1990).", true},
		{"battery_kwh", "Battery bank", 300, "kWh", "Assumption.", false},
		{"led_umol_per_joule", "Grow-light efficacy", 2.7, "micromol per joule", "Assumption for current horticultural LEDs.", false},
		{"surface_dose_msv_per_day", "Radiation dose on the surface", 0.64, "mSv per day", "Measured by Curiosity's Radiation Assessment Detector at Gale crater in 2012-2013 (Hassler et al. 2014, Science 343, 1244797). It was not measured at Jezero and varies with the solar cycle. No habitat shielding is modelled.", true},
		{"career_dose_limit_msv", "NASA career radiation limit", 600, "mSv", "NASA Space Flight Human-System Standard, NASA-STD-3001 Volume 1.", true},
	}
	out := make(map[string]Assumption, len(list))
	for _, a := range list {
		out[a.Key] = a
	}
	return out
}

// Crop is one greenhouse crop with its controlled-environment performance.
type Crop struct {
	Key             string  `json:"key"`
	Name            string  `json:"name"`
	EdibleDryGM2Day float64 `json:"edible_dry_g_m2_day"` // edible dry mass
	KcalPerDryG     float64 `json:"kcal_per_dry_g"`
	LightMolM2Day   float64 `json:"light_mol_m2_day"` // photosynthetic photon flux, daily integral
	WaterKgM2Day    float64 `json:"water_kg_m2_day"`  // transpiration, almost all recoverable as condensate
	Verify          bool    `json:"verify"`
}

// Crops are nominal controlled-environment values. All are marked verify:
// they were entered from memory of the crop tables in the NASA document above.
var Crops = map[string]Crop{
	"lettuce": {"lettuce", "Lettuce", 6.6, 2.5, 17, 1.8, true},
	"potato":  {"potato", "White potato", 21.1, 3.6, 28, 4.0, true},
	"wheat":   {"wheat", "Wheat", 22.7, 3.4, 115, 11.8, true},
	"soybean": {"soybean", "Soybean", 4.5, 4.5, 28, 2.9, true},
	"tomato":  {"tomato", "Tomato", 8.7, 3.0, 27, 2.8, true},
}

// Input is everything the budget depends on.
type Input struct {
	Crew        int                `json:"crew"`
	Sols        float64            `json:"sols"`
	LatitudeDeg float64            `json:"latitude_deg"`
	Body        string             `json:"body"`
	Overrides   map[string]float64 `json:"overrides"`     // assumption key -> value
	CropAreaM2  map[string]float64 `json:"crop_area_m2"`  // crop key -> growing area
	ExtraLoadKW float64            `json:"extra_load_kw"` // rover charging and similar, averaged over a sol
}

// Budget is the result, per sol unless a name says otherwise.
type Budget struct {
	Assumptions []Assumption `json:"assumptions"`

	OxygenNeedKg       float64 `json:"oxygen_need_kg_per_sol"`
	OxygenFromPlantsKg float64 `json:"oxygen_from_plants_kg_per_sol"`
	OxygenRecycledKg   float64 `json:"oxygen_recycled_kg_per_sol"`
	OxygenMakeupKg     float64 `json:"oxygen_makeup_kg_per_sol"`

	WaterNeedKg     float64 `json:"water_need_kg_per_sol"`
	WaterCropKg     float64 `json:"water_through_crops_kg_per_sol"`
	WaterMakeupKg   float64 `json:"water_makeup_kg_per_sol"`
	WaterMissionKg  float64 `json:"water_makeup_kg_mission"`
	OxygenMissionKg float64 `json:"oxygen_makeup_kg_mission"`

	FoodNeedKcal   float64 `json:"food_need_kcal_per_sol"`
	FoodGrownKcal  float64 `json:"food_grown_kcal_per_sol"`
	FoodGrownShare float64 `json:"food_grown_share"`
	FoodShippedKg  float64 `json:"food_shipped_dry_kg_mission"`

	GrowAreaM2      float64 `json:"grow_area_m2"`
	GrowLightKWh    float64 `json:"grow_light_kwh_per_sol"`
	LoadKWh         float64 `json:"load_kwh_per_sol"`
	SolarKWh        float64 `json:"solar_kwh_per_sol"`
	PowerMarginKWh  float64 `json:"power_margin_kwh_per_sol"`
	BatteryHours    float64 `json:"battery_hours_at_load"`
	SolarWM2DayMean float64 `json:"sunlight_w_m2_daily_mean"`

	RadiationPerSolMSv    float64 `json:"radiation_msv_per_sol"`
	RadiationStayMSv      float64 `json:"radiation_msv_stay"`
	RadiationShareOfLimit float64 `json:"radiation_share_of_career_limit"`

	Findings []string `json:"findings"`
}

// MeanSolarConstant returns the mean top-of-atmosphere solar irradiance, W/m2.
func MeanSolarConstant(body string) float64 {
	if body == "moon" || body == "earth" {
		return 1361.0
	}
	return 586.2 // Mars at its mean distance of 1.524 au
}

// SolHours is the length of a solar day in hours.
func SolHours(body string) float64 {
	switch body {
	case "moon":
		return 708.7
	case "earth":
		return 24.0
	default:
		return 24.66
	}
}

// DailyMeanInsolation returns the sol-averaged irradiance on a horizontal
// surface at equinox for a latitude, after dust losses, W/m2. At equinox the
// daily mean of the cosine of the solar zenith angle is cos(latitude)/pi.
func DailyMeanInsolation(body string, latDeg, tau, k float64) float64 {
	mu := math.Cos(latDeg*math.Pi/180) / math.Pi
	if mu < 0 {
		mu = 0
	}
	trans := 1.0
	if body == "mars" || body == "" {
		trans = math.Exp(-k * tau)
	}
	return MeanSolarConstant(body) * mu * trans
}

// Compute returns the habitat budget for an input.
func Compute(in Input) Budget {
	as := Defaults()
	for k, v := range in.Overrides {
		if a, ok := as[k]; ok {
			a.Value = v
			a.Basis = "Set by the user. Default basis: " + a.Basis
			as[k] = a
		}
	}
	val := func(k string) float64 { return as[k].Value }
	crew := float64(in.Crew)
	solDays := SolHours(in.Body) / 24.0 // Earth days per sol; per-day rates are per Earth day
	if in.Body == "moon" {
		solDays = 1 // lunar budgets are reported per Earth day
	}

	var b Budget
	for _, k := range []string{"o2_kg_per_person_day", "water_kg_per_person_day", "food_kg_per_person_day",
		"energy_kcal_per_person_day", "water_recovery", "o2_recovery", "habitat_base_kw", "solar_array_m2",
		"solar_efficiency", "dust_opacity_tau", "tau_transmission_k", "battery_kwh", "led_umol_per_joule",
		"surface_dose_msv_per_day", "career_dose_limit_msv"} {
		b.Assumptions = append(b.Assumptions, as[k])
	}

	// Greenhouse.
	var dryG, cropWater, lightMol float64
	for key, area := range in.CropAreaM2 {
		c, ok := Crops[key]
		if !ok || area <= 0 {
			continue
		}
		b.GrowAreaM2 += area
		dryG += c.EdibleDryGM2Day * area * solDays
		b.FoodGrownKcal += c.EdibleDryGM2Day * c.KcalPerDryG * area * solDays
		cropWater += c.WaterKgM2Day * area * solDays
		lightMol += c.LightMolM2Day * area * solDays
	}
	// Photosynthesis releases about 32 g of oxygen per 30 g of carbohydrate fixed.
	// Edible mass is roughly half of total plant growth, so total fixation is about twice the edible dry mass.
	b.OxygenFromPlantsKg = dryG * 2.0 * (32.0 / 30.0) / 1000.0
	b.GrowLightKWh = lightMol * 1e6 / val("led_umol_per_joule") / 3.6e6

	// Oxygen.
	b.OxygenNeedKg = crew * val("o2_kg_per_person_day") * solDays
	afterPlants := math.Max(0, b.OxygenNeedKg-b.OxygenFromPlantsKg)
	b.OxygenRecycledKg = afterPlants * val("o2_recovery")
	b.OxygenMakeupKg = afterPlants - b.OxygenRecycledKg

	// Water: crew water is recycled; crop transpiration is condensed and reused at the same recovery.
	b.WaterNeedKg = crew * val("water_kg_per_person_day") * solDays
	b.WaterCropKg = cropWater
	b.WaterMakeupKg = (b.WaterNeedKg + cropWater) * (1 - val("water_recovery"))

	// Food.
	b.FoodNeedKcal = crew * val("energy_kcal_per_person_day") * solDays
	if b.FoodNeedKcal > 0 {
		b.FoodGrownShare = math.Min(1, b.FoodGrownKcal/b.FoodNeedKcal)
	}
	b.FoodShippedKg = crew * val("food_kg_per_person_day") * solDays * in.Sols * (1 - b.FoodGrownShare)

	// Power.
	hours := SolHours(in.Body)
	if in.Body == "moon" {
		hours = 24
	}
	b.LoadKWh = (val("habitat_base_kw")+in.ExtraLoadKW)*hours + b.GrowLightKWh
	b.SolarWM2DayMean = DailyMeanInsolation(in.Body, in.LatitudeDeg, val("dust_opacity_tau"), val("tau_transmission_k"))
	b.SolarKWh = b.SolarWM2DayMean * val("solar_array_m2") * val("solar_efficiency") * hours / 1000.0
	b.PowerMarginKWh = b.SolarKWh - b.LoadKWh
	if b.LoadKWh > 0 {
		b.BatteryHours = val("battery_kwh") / (b.LoadKWh / hours)
	}

	b.WaterMissionKg = b.WaterMakeupKg * in.Sols
	b.OxygenMissionKg = b.OxygenMakeupKg * in.Sols

	// Radiation: a surface dose rate measured on Mars, accumulated over the stay. Mars only.
	if in.Body == "mars" || in.Body == "" {
		b.RadiationPerSolMSv = val("surface_dose_msv_per_day") * solDays
		b.RadiationStayMSv = b.RadiationPerSolMSv * in.Sols
		if lim := val("career_dose_limit_msv"); lim > 0 {
			b.RadiationShareOfLimit = b.RadiationStayMSv / lim
		}
	}

	// Plain-language findings.
	if b.PowerMarginKWh < 0 {
		b.Findings = append(b.Findings, "Power: the array does not cover the load. The shortfall each sol must come from stored energy or another source.")
	} else {
		b.Findings = append(b.Findings, "Power: the array covers the load with margin at this dust level.")
	}
	if b.GrowAreaM2 > 0 {
		b.Findings = append(b.Findings, "Greenhouse: growing food adds lighting load and moves more water through the recycling system. Both are included above.")
	}
	if b.RadiationShareOfLimit >= 0.5 {
		b.Findings = append(b.Findings, "Radiation: the surface stay alone uses half or more of the career limit, before the cruise to Mars and back is counted.")
	}
	if b.FoodGrownShare < 1 {
		b.Findings = append(b.Findings, "Food: the greenhouse does not feed the crew on its own. The rest is shipped.")
	}
	return b
}
