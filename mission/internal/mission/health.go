package mission

import (
	"fmt"
	"math"

	"beyondearthlabs/mission/internal/mobility"
)

// Health is a simulated crew health monitor. Every value is produced by a
// simple workload model, not measured from a person, and the monitor is not a
// medical device. It exists to show how a monitor ties into mission decisions:
// workload drives the readings, and a detector flags readings that the
// workload does not explain.
//
// Model (assumptions, shown in the interface):
//   - Metabolic rate comes from the mobility model while walking, 200 W while
//     working at a target, and 140 W while riding in a rover.
//   - Expected heart rate rises linearly with metabolic rate: 62 bpm at rest
//     (80 W) plus 0.21 bpm per watt. Heart rate follows it with a 90 s lag.
//   - Fatigue accumulates with work done and reaches 1 after 8 hours at 300 W.
//   - Anomaly: heart rate more than 15 bpm above the expected value for
//     2 minutes of mission time.
type Health struct {
	Monitored      bool      `json:"monitored"`
	MetabolicW     float64   `json:"metabolic_w"`
	HeartRate      float64   `json:"heart_rate_bpm"`
	ExpectedRate   float64   `json:"expected_heart_rate_bpm"`
	Fatigue        float64   `json:"fatigue"` // 0 to 1
	Anomaly        bool      `json:"anomaly"`
	AnomalySeconds float64   `json:"anomaly_seconds"`
	History        []float64 `json:"heart_rate_history"` // one sample per minute of mission time

	offset      float64 // bpm added by a simulated health fault
	sinceSample float64
}

const (
	restMetabolicW   = 80.0
	restHeartRate    = 62.0
	bpmPerWatt       = 0.21
	heartLagSeconds  = 90.0
	anomalyBpm       = 15.0
	anomalyHoldS     = 120.0
	ridingMetabolicW = 140.0
	workMetabolicW   = 200.0
)

func newHealth(p mobility.Profile) Health {
	monitored := p.Kind == mobility.Astronaut || p.Key == "crew_rover"
	return Health{Monitored: monitored, MetabolicW: restMetabolicW, HeartRate: restHeartRate,
		ExpectedRate: restHeartRate, History: []float64{}}
}

func expectedHeartRate(metabolicW float64) float64 {
	return restHeartRate + bpmPerWatt*math.Max(0, metabolicW-restMetabolicW)
}

// updateHealth advances the monitor over `seconds` of mission time during
// which `joules` of the mover's energy were spent.
func (e *Engine) updateHealth(m *Mission, joules, seconds float64) {
	h := &m.Sim.Health
	if !h.Monitored || seconds <= 0 {
		return
	}
	p := m.Profile()
	switch {
	case p.Kind == mobility.Astronaut && joules > 0:
		h.MetabolicW = joules / seconds
	case p.Kind == mobility.Astronaut:
		h.MetabolicW = workMetabolicW
	default:
		h.MetabolicW = ridingMetabolicW
	}
	h.ExpectedRate = expectedHeartRate(h.MetabolicW)
	target := h.ExpectedRate + h.offset
	h.HeartRate += (target - h.HeartRate) * (1 - math.Exp(-seconds/heartLagSeconds))
	h.Fatigue = math.Min(1, h.Fatigue+h.MetabolicW*seconds/(300.0*8*3600))

	if h.HeartRate-h.ExpectedRate > anomalyBpm {
		h.AnomalySeconds += seconds
	} else {
		h.AnomalySeconds = 0
	}
	if h.AnomalySeconds >= anomalyHoldS && !h.Anomaly {
		h.Anomaly = true
		m.log("warning", fmt.Sprintf("Health monitor (simulated): heart rate %.0f bpm is %.0f above what this workload explains.",
			h.HeartRate, h.HeartRate-h.ExpectedRate))
	}
	h.sinceSample += seconds
	for h.sinceSample >= 60 {
		h.sinceSample -= 60
		h.History = append(h.History, math.Round(h.HeartRate*10)/10)
		if len(h.History) > 120 {
			h.History = h.History[len(h.History)-120:]
		}
	}
}
