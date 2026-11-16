// Package planner finds routes over the measured terrain grid with A*.
//
// A route is a chain of 8-connected cell centres. The cost of a step comes
// from the mobility model (time or energy for that mover on that grade),
// multiplied by a risk factor that grows as a cell approaches the mover's
// slope or roughness limit. Cells beyond a limit, and cells inside a reported
// hazard, are never entered.
package planner

import (
	"container/heap"
	"errors"
	"fmt"
	"math"

	"beyondearthlabs/mission/internal/mobility"
	"beyondearthlabs/mission/internal/terrain"
)

// Objective selects what the route minimises.
type Objective string

const (
	Fastest     Objective = "time"
	LeastEnergy Objective = "energy"
)

// Hazard is a circular keep-out area in local metres (a reported obstacle, a dust devil track, a soft patch).
type Hazard struct {
	ID      string  `json:"id"`
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	RadiusM float64 `json:"radius_m"`
	Reason  string  `json:"reason"`
	Source  string  `json:"source,omitempty"` // where the keep-out came from; empty for a simulated report
}

// Request describes one planning problem.
type Request struct {
	Profile    mobility.Profile
	Objective  Objective
	StartX     float64
	StartY     float64
	GoalX      float64
	GoalY      float64
	RiskWeight float64 // 0 ignores risk; 1 doubles the cost of a cell at a limit
	Hazards    []Hazard
}

// Point is one vertex of a route with running totals up to that vertex.
type Point struct {
	X          float64 `json:"x"`
	Y          float64 `json:"y"`
	Lon        float64 `json:"lon"`
	Lat        float64 `json:"lat"`
	ElevationM float64 `json:"elevation_m"`
	SlopeDeg   float64 `json:"slope_deg"`
	DistM      float64 `json:"dist_m"`
	Seconds    float64 `json:"seconds"`
	Joules     float64 `json:"joules"`
}

// Route is a planned path and its measured properties.
type Route struct {
	Objective      Objective `json:"objective"`
	ProfileKey     string    `json:"profile"`
	Points         []Point   `json:"points"`
	DistanceM      float64   `json:"distance_m"`
	StraightLineM  float64   `json:"straight_line_m"`
	Seconds        float64   `json:"seconds"`
	Joules         float64   `json:"joules"`
	AscentM        float64   `json:"ascent_m"`
	DescentM       float64   `json:"descent_m"`
	MaxSlopeDeg    float64   `json:"max_slope_deg"`
	MeanSlopeDeg   float64   `json:"mean_slope_deg"`
	MaxRoughnessM  float64   `json:"max_roughness_m"`
	NodesExpanded  int       `json:"nodes_expanded"`
	HazardsAvoided int       `json:"hazards_avoided"`
	// FineCellsAvoided counts cells kept out because the 1 m elevation model shows them to be too steep.
	FineCellsAvoided int      `json:"fine_cells_avoided"`
	SlopeLimitDeg    float64  `json:"slope_limit_deg"`
	Explanation      []string `json:"explanation"`
}

// ErrNoRoute means the goal cannot be reached within the mover's limits.
var ErrNoRoute = errors.New("no route within the mover's slope and roughness limits")

type item struct {
	node int32
	f    float64
}
type pq []item

func (q pq) Len() int            { return len(q) }
func (q pq) Less(i, j int) bool  { return q[i].f < q[j].f }
func (q pq) Swap(i, j int)       { q[i], q[j] = q[j], q[i] }
func (q *pq) Push(x interface{}) { *q = append(*q, x.(item)) }
func (q *pq) Pop() interface{} {
	old := *q
	n := len(old)
	it := old[n-1]
	*q = old[:n-1]
	return it
}

var neighbours = [8][2]int{{-1, -1}, {-1, 0}, {-1, 1}, {0, -1}, {0, 1}, {1, -1}, {1, 0}, {1, 1}}

// risk is 0 on easy ground and 1 at the mover's limit.
func risk(p mobility.Profile, slopeDeg, roughM float64) float64 {
	r := math.Max(slopeDeg/p.MaxSlopeDeg, roughM/p.MaxRoughnessM)
	if r > 1 {
		r = 1
	}
	return r * r
}

func blockedByHazard(hz []Hazard, x, y float64) bool {
	for _, h := range hz {
		if math.Hypot(x-h.X, y-h.Y) <= h.RadiusM {
			return true
		}
	}
	return false
}

// hazardMask marks every cell whose centre is inside a keep-out area. A 1 m elevation check can add
// hundreds of single-cell keep-outs, so they are looked up from a mask and not searched at every step.
func hazardMask(g *terrain.Grid, hz []Hazard) []bool {
	if len(hz) == 0 {
		return nil
	}
	mask := make([]bool, g.N*g.N)
	for _, h := range hz {
		reach := int(h.RadiusM/g.CellM) + 1
		r0, c0, _ := g.CellAt(h.X, h.Y) // also valid as a starting point when the centre is off the map
		for r := r0 - reach; r <= r0+reach; r++ {
			for c := c0 - reach; c <= c0+reach; c++ {
				if !g.InBounds(r, c) {
					continue
				}
				x, y := g.Centre(r, c)
				if math.Hypot(x-h.X, y-h.Y) <= h.RadiusM {
					mask[g.Index(r, c)] = true
				}
			}
		}
	}
	return mask
}

// Plan runs A* and returns the best route for the request.
func Plan(g *terrain.Grid, req Request) (*Route, error) {
	sr, sc, ok := g.CellAt(req.StartX, req.StartY)
	if !ok {
		return nil, errors.New("start is outside the mapped area")
	}
	gr, gc, ok := g.CellAt(req.GoalX, req.GoalY)
	if !ok {
		return nil, errors.New("goal is outside the mapped area")
	}
	p := req.Profile
	gravity := mobility.Gravity(g.Meta.Body)
	start, goal := int32(g.Index(sr, sc)), int32(g.Index(gr, gc))
	for name, idx := range map[string]int32{"start": start, "goal": goal} {
		if !p.Enterable(float64(g.Slope[idx]), float64(g.Roughness[idx])) {
			return nil, fmt.Errorf("%s is on ground beyond the %s's limits (slope %.1f deg, limit %.0f deg)",
				name, p.Name, g.Slope[idx], p.MaxSlopeDeg)
		}
	}
	gx, gy := g.Centre(gr, gc)
	if blockedByHazard(req.Hazards, gx, gy) {
		return nil, errors.New("goal is inside a reported hazard")
	}
	blocked := hazardMask(g, req.Hazards)

	// Admissible heuristic: straight-line distance at the best possible cost per metre.
	perMetre := p.FastestSecondsPerMetre()
	if req.Objective == LeastEnergy {
		perMetre = p.LeastJoulesPerMetre()
	}
	h := func(n int32) float64 {
		r, c := g.RowCol(int(n))
		return math.Hypot(float64(r-gr), float64(c-gc)) * g.CellM * perMetre
	}

	n := g.N * g.N
	cost := make([]float64, n)
	parent := make([]int32, n)
	closed := make([]bool, n)
	for i := range cost {
		cost[i] = math.Inf(1)
		parent[i] = -1
	}
	cost[start] = 0
	open := &pq{{start, h(start)}}
	expanded := 0
	found := false
	for open.Len() > 0 {
		cur := heap.Pop(open).(item)
		if closed[cur.node] {
			continue
		}
		closed[cur.node] = true
		expanded++
		if cur.node == goal {
			found = true
			break
		}
		r, c := g.RowCol(int(cur.node))
		for _, d := range neighbours {
			nr, nc := r+d[0], c+d[1]
			if !g.InBounds(nr, nc) {
				continue
			}
			ni := int32(g.Index(nr, nc))
			if closed[ni] {
				continue
			}
			if blocked != nil && blocked[g.Index(nr, nc)] {
				continue
			}
			dist := g.CellM
			if d[0] != 0 && d[1] != 0 {
				dist *= math.Sqrt2
			}
			dz := float64(g.Elevation[ni]) - float64(g.Elevation[cur.node])
			slope, rough := float64(g.Slope[ni]), float64(g.Roughness[ni])
			step, ok := p.Move(dist, dz, slope, rough, gravity)
			if !ok {
				continue
			}
			base := step.Seconds
			if req.Objective == LeastEnergy {
				base = step.Joules
			}
			nc2 := cost[cur.node] + base*(1+req.RiskWeight*risk(p, slope, rough))
			if nc2 < cost[ni] {
				cost[ni] = nc2
				parent[ni] = cur.node
				heap.Push(open, item{ni, nc2 + h(ni)})
			}
		}
	}
	if !found {
		return nil, ErrNoRoute
	}

	// Walk back from the goal, then accumulate true totals forward.
	var chain []int32
	for at := goal; at != -1; at = parent[at] {
		chain = append(chain, at)
	}
	for i, j := 0, len(chain)-1; i < j; i, j = i+1, j-1 {
		chain[i], chain[j] = chain[j], chain[i]
	}
	rt := &Route{Objective: req.Objective, ProfileKey: p.Key, NodesExpanded: expanded,
		SlopeLimitDeg: p.MaxSlopeDeg}
	for _, h := range req.Hazards {
		if h.Source == "" {
			rt.HazardsAvoided++
		} else {
			rt.FineCellsAvoided++
		}
	}
	var slopeSum float64
	for i, idx := range chain {
		r, c := g.RowCol(int(idx))
		x, y := g.Centre(r, c)
		lon, lat := g.ToLonLat(x, y)
		pt := Point{X: x, Y: y, Lon: lon, Lat: lat, ElevationM: float64(g.Elevation[idx]), SlopeDeg: float64(g.Slope[idx])}
		if i > 0 {
			prev := rt.Points[i-1]
			dist := math.Hypot(x-prev.X, y-prev.Y)
			dz := pt.ElevationM - prev.ElevationM
			step, _ := p.Move(dist, dz, pt.SlopeDeg, float64(g.Roughness[idx]), gravity)
			pt.DistM = prev.DistM + dist
			pt.Seconds = prev.Seconds + step.Seconds
			pt.Joules = prev.Joules + step.Joules
			if dz > 0 {
				rt.AscentM += dz
			} else {
				rt.DescentM -= dz
			}
		}
		rt.MaxSlopeDeg = math.Max(rt.MaxSlopeDeg, pt.SlopeDeg)
		rt.MaxRoughnessM = math.Max(rt.MaxRoughnessM, float64(g.Roughness[idx]))
		slopeSum += pt.SlopeDeg
		rt.Points = append(rt.Points, pt)
	}
	last := rt.Points[len(rt.Points)-1]
	rt.DistanceM, rt.Seconds, rt.Joules = last.DistM, last.Seconds, last.Joules
	rt.MeanSlopeDeg = slopeSum / float64(len(rt.Points))
	rt.StraightLineM = math.Hypot(rt.Points[0].X-last.X, rt.Points[0].Y-last.Y)
	rt.Explanation = explain(rt, p)
	return rt, nil
}

func explain(rt *Route, p mobility.Profile) []string {
	out := []string{}
	if rt.StraightLineM > 0 {
		detour := (rt.DistanceM/rt.StraightLineM - 1) * 100
		switch {
		case detour < 8:
			out = append(out, fmt.Sprintf("Nearly direct: %.0f m against %.0f m in a straight line.", rt.DistanceM, rt.StraightLineM))
		default:
			out = append(out, fmt.Sprintf("Detours %.0f%% (%.0f m against %.0f m straight) to stay on gentler ground.",
				detour, rt.DistanceM, rt.StraightLineM))
		}
	}
	out = append(out, fmt.Sprintf("Steepest ground on the route is %.1f degrees; the %s's limit is %.0f degrees.",
		rt.MaxSlopeDeg, p.Name, p.MaxSlopeDeg))
	out = append(out, fmt.Sprintf("Climbs %.0f m and descends %.0f m.", rt.AscentM, rt.DescentM))
	if rt.HazardsAvoided > 0 {
		out = append(out, fmt.Sprintf("Keeps clear of %d reported hazard area(s).", rt.HazardsAvoided))
	}
	if rt.FineCellsAvoided > 0 {
		out = append(out, fmt.Sprintf("Keeps out of %d cell(s) the 1 m elevation model shows to be too steep.", rt.FineCellsAvoided))
	}
	return out
}
