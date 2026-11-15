package mission

import (
	"fmt"
	"math"
)

// ScoreLine is one part of the mission score with the reason for it.
type ScoreLine struct {
	Label  string  `json:"label"`
	Points float64 `json:"points"`
	Max    float64 `json:"max"`
	Why    string  `json:"why"`
}

// Score rates a finished traverse out of 100. It is a training aid: the
// weights are a design choice of this project, stated here and on screen.
//
//	Science     60  share of the planned targets that were visited
//	Safety      25  back at base with the reserve untouched (10 if the reserve was used, 0 if a consumable ran out)
//	Efficiency  15  planned distance over distance travelled, scaled by the share of targets visited
type Score struct {
	Total float64     `json:"total"`
	Rank  string      `json:"rank"`
	Lines []ScoreLine `json:"lines"`
	Note  string      `json:"note"`
}

// score returns nil until the traverse has ended.
func (e *Engine) score(m *Mission) *Score {
	s := &m.Sim
	if s.Phase != PhaseComplete && s.Phase != PhaseAborted {
		return nil
	}
	n := len(m.Targets)
	visited := 0
	for _, t := range m.Targets {
		if t.Visited {
			visited++
		}
	}
	share := 0.0
	if n > 0 {
		share = float64(visited) / float64(n)
	}
	sc := &Score{Note: "A training score for this simulation. The weights are this project's choice, not a NASA standard."}

	sc.Lines = append(sc.Lines, ScoreLine{"Science", math.Round(60 * share), 60,
		fmt.Sprintf("%d of %d target(s) visited.", visited, n)})

	_, _, reserve := m.capacity()
	used := s.Capacity - s.Remaining
	// The reserve is intact if what is left is at least the reserve share of what was used.
	safety, why := 0.0, ""
	switch {
	case s.Phase == PhaseAborted:
		why = fmt.Sprintf("%s ran out before reaching base.", resourceName(s.Resource))
	case s.Remaining >= reserve*used:
		safety = 25
		why = fmt.Sprintf("Back at base with %.0f%% of %s left; the %.0f%% reserve was never needed.",
			100*s.Remaining/s.Capacity, resourceName(s.Resource), 100*reserve)
	default:
		safety = 10
		why = fmt.Sprintf("Back at base, but with only %.0f%% of %s left: the reserve was used.",
			100*s.Remaining/s.Capacity, resourceName(s.Resource))
	}
	sc.Lines = append(sc.Lines, ScoreLine{"Safety", safety, 25, why})

	eff := 0.0
	effWhy := "No distance was planned."
	if m.Plan != nil && s.DistanceM > 0 && s.Phase == PhaseComplete {
		ratio := math.Min(1, m.Plan.DistanceM/s.DistanceM)
		eff = math.Round(15 * ratio * share)
		effWhy = fmt.Sprintf("Planned %.0f m, travelled %.0f m, with %d replan(s).", m.Plan.DistanceM, s.DistanceM, s.Replans)
	} else if s.Phase == PhaseAborted {
		effWhy = "Not scored: the traverse did not finish."
	}
	sc.Lines = append(sc.Lines, ScoreLine{"Efficiency", eff, 15, effWhy})

	for _, l := range sc.Lines {
		sc.Total += l.Points
	}
	switch {
	case sc.Total >= 90:
		sc.Rank = "Flight director"
	case sc.Total >= 70:
		sc.Rank = "Mission specialist"
	case sc.Total >= 40:
		sc.Rank = "Trainee"
	default:
		sc.Rank = "Fly it again"
	}
	return sc
}
