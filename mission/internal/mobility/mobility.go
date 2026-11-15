// Package mobility models how fast a rover or a suited astronaut moves over
// terrain and what it costs them. These are engineering models with stated
// assumptions. They are not flight-qualified and their outputs are estimates.
//
// Two different slopes matter and are kept apart:
//
//   - the terrain slope magnitude of a cell (steepest gradient): a stability
//     limit, the same whichever way the vehicle is heading;
//   - the grade along the direction of travel (rise over run of the step):
//     what the vehicle actually climbs or descends, which sets speed and energy.
package mobility

import "math"

// Gravity returns surface gravity in m/s^2 for a body.
func Gravity(body string) float64 {
	switch body {
	case "moon":
		return 1.62
	case "earth":
		return 9.807
	default:
		return 3.721 // Mars
	}
}

// Kind distinguishes wheeled vehicles from people on foot.
type Kind string

const (
	Rover     Kind = "rover"
	Astronaut Kind = "astronaut"
)

// Profile is one mover. Every field is an assumption that the interface shows to the user.
type Profile struct {
	Key  string `json:"key"`
	Name string `json:"name"`
	Kind Kind   `json:"kind"`

	MassKg        float64 `json:"mass_kg"`         // total moving mass
	MaxSlopeDeg   float64 `json:"max_slope_deg"`   // terrain slope magnitude above which a cell is not entered
	MaxRoughnessM float64 `json:"max_roughness_m"` // roughness above which a cell is not entered
	SpeedFlatMS   float64 `json:"speed_flat_ms"`   // speed on level, smooth ground

	// Rover only.
	RollingResistance float64 `json:"rolling_resistance,omitempty"` // dimensionless, loose regolith
	DriveEfficiency   float64 `json:"drive_efficiency,omitempty"`   // battery to wheel
	HotelPowerW       float64 `json:"hotel_power_w,omitempty"`      // avionics, heaters, sensors while driving
	GenerationW       float64 `json:"generation_w,omitempty"`       // continuous onboard generation (radioisotope source)
	BatteryWh         float64 `json:"battery_wh,omitempty"`

	// Astronaut only.
	PaceFactor float64 `json:"pace_factor,omitempty"` // fraction of the unencumbered speed curve achieved in a suit
	OxygenKg   float64 `json:"oxygen_kg,omitempty"`   // usable oxygen carried

	Basis string `json:"basis"` // where the numbers come from
}

// Profiles available to missions.
var Profiles = map[string]Profile{
	"scout": {
		Key: "scout", Name: "Robotic scout rover", Kind: Rover,
		MassKg: 1025, MaxSlopeDeg: 20, MaxRoughnessM: 1.5, SpeedFlatMS: 0.042,
		RollingResistance: 0.15, DriveEfficiency: 0.6, HotelPowerW: 110, GenerationW: 110, BatteryWh: 1600,
		Basis: "Mass and top speed of NASA's Perseverance rover (1,025 kg, 152 m/h) and the roughly 110 W of its " +
			"radioisotope power source. The 20 degree limit is the steepest ground class Perseverance actually " +
			"crossed on this map (see data/jezero/validation.json). Rolling resistance, efficiency, hotel power " +
			"and battery size are assumptions.",
	},
	"crew_rover": {
		Key: "crew_rover", Name: "Crew rover (unpressurised)", Kind: Rover,
		MassKg: 900, MaxSlopeDeg: 20, MaxRoughnessM: 1.0, SpeedFlatMS: 2.2,
		RollingResistance: 0.15, DriveEfficiency: 0.7, HotelPowerW: 250, BatteryWh: 12000,
		Basis: "Sized after the Apollo Lunar Roving Vehicle class (two crew, open chassis). All values are " +
			"assumptions for a Mars version and are not taken from a NASA design.",
	},
	"astronaut": {
		Key: "astronaut", Name: "Astronaut on foot", Kind: Astronaut,
		MassKg: 180, MaxSlopeDeg: 25, MaxRoughnessM: 0.8, SpeedFlatMS: 1.6, PaceFactor: 0.6, OxygenKg: 0.55,
		Basis: "Walking speed and metabolic cost follow the load-carriage model of Santee et al. (2001) as adapted " +
			"for planetary EVA planning by Marquez (2008). Mass is an 80 kg person plus a 100 kg suit and tools. " +
			"Pace factor and oxygen load are assumptions. Model constants need checking against the papers.",
	},
}

// Oxygen consumed per joule of metabolic energy, kg/J: 1 litre of O2 releases
// about 20.1 kJ, and 1 litre of O2 at standard conditions has a mass of 1.429 g.
const OxygenKgPerJoule = 1.429e-3 / 20100.0

// Enterable reports whether the mover may enter a cell with this terrain.
func (p Profile) Enterable(slopeMagDeg, roughnessM float64) bool {
	return slopeMagDeg <= p.MaxSlopeDeg && roughnessM <= p.MaxRoughnessM
}

// Speed returns ground speed in m/s for a step.
// gradeDeg is the grade along the direction of travel (positive uphill).
func (p Profile) Speed(gradeDeg, slopeMagDeg, roughnessM float64) float64 {
	rough := 1 - 0.5*math.Min(1, roughnessM/p.MaxRoughnessM)
	if p.Kind == Astronaut {
		return walkingSpeed(gradeDeg) * p.PaceFactor * rough
	}
	// Rover: slows linearly to 30% of flat speed at its slope limit.
	derate := 1 - 0.7*math.Min(1, slopeMagDeg/p.MaxSlopeDeg)
	return p.SpeedFlatMS * derate * rough
}

// walkingSpeed is the unencumbered speed-versus-grade curve (m/s) used with
// the Santee load-carriage model in planetary traverse planning (Marquez 2008).
func walkingSpeed(gradeDeg float64) float64 {
	a := gradeDeg
	switch {
	case a < -20:
		return 0.05
	case a < -10:
		return 0.095*a + 1.95
	case a < 0:
		return 0.06*a + 1.6
	case a < 6:
		return -0.02*a + 1.6
	case a < 15:
		return -0.039*a + 1.71
	default:
		return 0.05
	}
}

// PowerW returns the power drawn while moving at speed v on a grade: net
// electrical power from the battery for a rover (after any onboard
// generation, never negative), metabolic power for an astronaut.
func (p Profile) PowerW(gradeDeg, v, gravity float64) float64 {
	sin, cos := math.Sincos(gradeDeg * math.Pi / 180)
	if p.Kind == Astronaut {
		level := (3.28*p.MassKg + 71.1) * (0.661*v*cos + 0.115)
		var slope float64
		if gradeDeg >= 0 {
			slope = 3.5 * p.MassKg * gravity * v * sin
		} else {
			slope = 2.4 * p.MassKg * gravity * v * sin * math.Pow(0.3, math.Abs(gradeDeg)/7.65)
		}
		return math.Max(level+slope, 80) // never below a resting metabolic rate
	}
	// Rover: rolling resistance plus the weight component along the grade.
	// Braking downhill recovers nothing, so traction power is never negative.
	traction := p.MassKg * gravity * (p.RollingResistance*cos + sin) * v
	if traction < 0 {
		traction = 0
	}
	return math.Max(0, traction/p.DriveEfficiency+p.HotelPowerW-p.GenerationW)
}

// Step is the cost of one move.
type Step struct {
	Seconds float64
	Joules  float64 // battery energy (rover) or metabolic energy (astronaut)
	SpeedMS float64
}

// Move returns the time and energy to travel a horizontal distance with an
// elevation change dz into a cell with the given terrain. ok is false when the
// cell may not be entered.
func (p Profile) Move(distM, dzM, slopeMagDeg, roughnessM, gravity float64) (Step, bool) {
	if !p.Enterable(slopeMagDeg, roughnessM) {
		return Step{}, false
	}
	grade := math.Atan2(dzM, distM) * 180 / math.Pi
	if math.Abs(grade) > p.MaxSlopeDeg {
		return Step{}, false
	}
	v := p.Speed(grade, slopeMagDeg, roughnessM)
	if v <= 0 {
		return Step{}, false
	}
	path := math.Hypot(distM, dzM)
	t := path / v
	return Step{Seconds: t, Joules: p.PowerW(grade, v, gravity) * t, SpeedMS: v}, true
}

// FastestSecondsPerMetre is a lower bound on time per metre anywhere (for the planner's heuristic).
func (p Profile) FastestSecondsPerMetre() float64 {
	v := p.SpeedFlatMS
	if p.Kind == Astronaut {
		v = 1.6 * p.PaceFactor // the speed curve peaks on level ground
	}
	return 1 / v
}

// LeastJoulesPerMetre is a lower bound on energy per metre anywhere (for the planner's heuristic).
func (p Profile) LeastJoulesPerMetre() float64 {
	if p.Kind == Astronaut {
		// Resting metabolic floor at the fastest possible speed.
		return 80 / (1.6 * p.PaceFactor)
	}
	// Coasting downhill still pays hotel power, less onboard generation, for the time spent.
	return math.Max(0, p.HotelPowerW-p.GenerationW) / p.SpeedFlatMS
}
