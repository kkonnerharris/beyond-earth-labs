package mission

import (
	"errors"
	"fmt"
	"math"

	"beyondearthlabs/mission/internal/mobility"
)

// PhaseManual means the mover is being driven or walked by hand in the surface view.
const PhaseManual Phase = "manual"

// MaxDriveStepM is the most one drive command may move.
const MaxDriveStepM = 200.0

// Drive moves the mover by hand: distanceM along headingDeg (clockwise from
// north) from where it stands. The same mobility model, slope limits and
// consumables apply as on a planned route, so hand driving cannot go where a
// route could not. It is available when no planned traverse is running.
func (e *Engine) Drive(m *Mission, headingDeg, distanceM float64) error {
	s := &m.Sim
	if s.Phase != PhaseIdle && s.Phase != PhaseManual {
		return errors.New("hand driving is available when no traverse is running; reset the simulation first")
	}
	if !(distanceM > 0) || distanceM > MaxDriveStepM {
		return fmt.Errorf("distance must be more than 0 and at most %.0f m", MaxDriveStepM)
	}
	p := m.Profile()
	gravity := mobility.Gravity(m.Body)
	if s.Phase == PhaseIdle {
		s.Phase = PhaseManual
		s.Track = append(s.Track, [2]float64{s.Lon, s.Lat})
		m.log("sim", "Hand driving started from "+m.Base.Name+".")
	}
	s.HeadingDeg = math.Mod(math.Mod(headingDeg, 360)+360, 360)
	rad := s.HeadingDeg * math.Pi / 180
	dx, dy := math.Sin(rad), math.Cos(rad)
	step := e.Grid.CellM / 2
	var blocked error
	for moved := 0.0; moved < distanceM-1e-9; {
		d := math.Min(step, distanceM-moved)
		nx, ny := s.X+dx*d, s.Y+dy*d
		next, ok := e.Grid.SampleAt(nx, ny)
		if !ok {
			blocked = errors.New("that is the edge of the mapped area")
			break
		}
		dz := e.Grid.ElevationAt(nx, ny) - e.Grid.ElevationAt(s.X, s.Y)
		st, ok := p.Move(d, dz, next.SlopeDeg, next.RoughnessM, gravity)
		if !ok {
			blocked = fmt.Errorf("blocked: the ground ahead slopes %.1f degrees and the %s's limit is %.0f",
				next.SlopeDeg, p.Name, p.MaxSlopeDeg)
			break
		}
		e.spend(m, st.Joules, st.Seconds)
		s.DistanceM += d
		s.SpeedMS = st.SpeedMS
		moved += d
		s.X, s.Y = nx, ny
		s.Lon, s.Lat = e.Grid.ToLonLat(nx, ny)
		s.ElevationM, s.SlopeDeg = e.Grid.ElevationAt(nx, ny), next.SlopeDeg
		if s.Phase == PhaseAborted {
			break
		}
	}
	s.Track = append(s.Track, [2]float64{s.Lon, s.Lat})
	if len(s.Track) > 2000 {
		s.Track = s.Track[len(s.Track)-2000:]
	}
	// Keep the "can we still get home" figures current while driving by hand.
	if home, err := e.returnRoute(m); err == nil {
		_, _, reserve := m.capacity()
		need := (m.consumption(home.Joules, 0) + s.LeakPerHour*home.Seconds/3600) * (1 + reserve)
		wasSafe := s.ReturnMargin >= 0
		s.ReturnNeed, s.ReturnMargin, s.ReturnM = need, s.Remaining-need, home.DistanceM
		if wasSafe && s.ReturnMargin < 0 {
			m.log("warning", fmt.Sprintf("Turn back: getting home from here needs %.2f %s with reserve and %.2f remains.",
				need, unitOf(s.Resource), s.Remaining))
		}
	}
	return blocked
}
