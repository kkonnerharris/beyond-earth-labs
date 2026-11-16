// Command missiond is the mission service: the authoritative mission state,
// route planning, consumable budgets and the traverse simulation.
//
//	missiond -terrain ../data/jezero -store ../data/missions -addr 127.0.0.1:8300
//
// The web interface only sends commands and draws what this service returns.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"beyondearthlabs/mission/internal/lifesupport"
	"beyondearthlabs/mission/internal/mission"
	"beyondearthlabs/mission/internal/mobility"
	"beyondearthlabs/mission/internal/planner"
	"beyondearthlabs/mission/internal/terrain"
)

type server struct {
	mu       sync.Mutex
	engine   *mission.Engine
	missions map[string]*mission.Mission
	storeDir string
	nextID   int
}

type apiError struct {
	Error string `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, apiError{err.Error()})
}

func decode(r *http.Request, v any) error {
	if r.Body == nil {
		return nil
	}
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	if err := dec.Decode(v); err != nil && err.Error() != "EOF" {
		return fmt.Errorf("request body: %w", err)
	}
	return nil
}

// point accepts either local metres or longitude/latitude.
type point struct {
	X   *float64 `json:"x"`
	Y   *float64 `json:"y"`
	Lon *float64 `json:"lon"`
	Lat *float64 `json:"lat"`
}

func (s *server) local(p point) (float64, float64, error) {
	switch {
	case p.X != nil && p.Y != nil:
		return *p.X, *p.Y, nil
	case p.Lon != nil && p.Lat != nil:
		x, y := s.engine.Grid.FromLonLat(*p.Lon, *p.Lat)
		return x, y, nil
	}
	return 0, 0, errors.New("a point needs x and y (metres) or lon and lat (degrees)")
}

// save writes a mission to disk so it survives a restart. Failures are logged, not fatal.
func (s *server) save(m *mission.Mission) {
	if s.storeDir == "" {
		return
	}
	raw, err := json.Marshal(m)
	if err == nil {
		err = os.WriteFile(filepath.Join(s.storeDir, m.ID+".json"), raw, 0o644)
	}
	if err != nil {
		log.Printf("could not save mission %s: %v", m.ID, err)
	}
}

func (s *server) with(w http.ResponseWriter, r *http.Request, fn func(m *mission.Mission) error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	m, ok := s.missions[r.PathValue("id")]
	if !ok {
		fail(w, http.StatusNotFound, errors.New("no such mission"))
		return
	}
	if err := fn(m); err != nil {
		// The state is still returned so the interface can show what happened.
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"error": err.Error(), "mission": m})
		return
	}
	s.save(m)
	writeJSON(w, http.StatusOK, m)
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	g := s.engine.Grid

	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		n := len(s.missions)
		s.mu.Unlock()
		writeJSON(w, 200, map[string]any{"ok": true, "terrain": g.Meta.Name, "body": g.Meta.Body,
			"grid_cells": g.N, "cell_m": g.CellM, "missions": n})
	})

	mux.HandleFunc("GET /api/profiles", func(w http.ResponseWriter, r *http.Request) {
		keys := make([]string, 0, len(mobility.Profiles))
		for k := range mobility.Profiles {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		out := make([]mobility.Profile, 0, len(keys))
		for _, k := range keys {
			out = append(out, mobility.Profiles[k])
		}
		writeJSON(w, 200, map[string]any{"profiles": out,
			"reserves": map[string]float64{"oxygen": mission.OxygenReserve, "battery": mission.BatteryReserve}})
	})

	mux.HandleFunc("GET /api/terrain", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, g.Meta)
	})

	mux.HandleFunc("GET /api/terrain/sample", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		var x, y float64
		if q.Get("lon") != "" {
			lon, e1 := strconv.ParseFloat(q.Get("lon"), 64)
			lat, e2 := strconv.ParseFloat(q.Get("lat"), 64)
			if e1 != nil || e2 != nil {
				fail(w, 400, errors.New("lon and lat must be numbers"))
				return
			}
			x, y = g.FromLonLat(lon, lat)
		} else {
			var e1, e2 error
			x, e1 = strconv.ParseFloat(q.Get("x"), 64)
			y, e2 = strconv.ParseFloat(q.Get("y"), 64)
			if e1 != nil || e2 != nil {
				fail(w, 400, errors.New("give lon and lat, or x and y"))
				return
			}
		}
		smp, ok := g.SampleAt(x, y)
		if !ok {
			fail(w, 404, errors.New("that point is outside the mapped area"))
			return
		}
		limits := map[string]bool{}
		for k, p := range mobility.Profiles {
			limits[k] = p.Enterable(smp.SlopeDeg, smp.RoughnessM)
		}
		writeJSON(w, 200, map[string]any{"sample": smp, "enterable": limits, "kind": "calculated from the elevation model"})
	})

	// Stateless route planning: compare movers or objectives without touching a mission.
	mux.HandleFunc("POST /api/route", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Profile    string           `json:"profile"`
			Objective  string           `json:"objective"`
			Start      point            `json:"start"`
			Goal       point            `json:"goal"`
			RiskWeight *float64         `json:"risk_weight"`
			Hazards    []planner.Hazard `json:"hazards"`
		}
		if err := decode(r, &req); err != nil {
			fail(w, 400, err)
			return
		}
		p, ok := mobility.Profiles[req.Profile]
		if !ok {
			fail(w, 400, fmt.Errorf("unknown profile %q", req.Profile))
			return
		}
		sx, sy, err := s.local(req.Start)
		if err != nil {
			fail(w, 400, fmt.Errorf("start: %w", err))
			return
		}
		gx, gy, err := s.local(req.Goal)
		if err != nil {
			fail(w, 400, fmt.Errorf("goal: %w", err))
			return
		}
		obj := planner.Fastest
		if req.Objective == string(planner.LeastEnergy) {
			obj = planner.LeastEnergy
		}
		risk := 1.0
		if req.RiskWeight != nil {
			risk = *req.RiskWeight
		}
		rt, err := planner.Plan(g, planner.Request{Profile: p, Objective: obj, StartX: sx, StartY: sy,
			GoalX: gx, GoalY: gy, RiskWeight: risk, Hazards: req.Hazards})
		if err != nil {
			fail(w, http.StatusUnprocessableEntity, err)
			return
		}
		writeJSON(w, 200, rt)
	})

	mux.HandleFunc("POST /api/habitat/budget", func(w http.ResponseWriter, r *http.Request) {
		in := lifesupport.Input{Crew: 4, Sols: 500, LatitudeDeg: g.Meta.Grid.Lat0, Body: g.Meta.Body}
		if err := decode(r, &in); err != nil {
			fail(w, 400, err)
			return
		}
		writeJSON(w, 200, map[string]any{"budget": lifesupport.Compute(in), "crops": lifesupport.Crops,
			"kind": "calculated from stated assumptions"})
	})

	mux.HandleFunc("GET /api/missions", func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		type row struct {
			ID, Name, Mover, CreatedUTC string
			Targets                     int
			Phase                       mission.Phase
		}
		out := []row{}
		for _, m := range s.missions {
			out = append(out, row{m.ID, m.Name, m.Mover, m.CreatedUTC, len(m.Targets), m.Sim.Phase})
		}
		sort.Slice(out, func(i, j int) bool { return out[i].CreatedUTC > out[j].CreatedUTC })
		writeJSON(w, 200, out)
	})

	mux.HandleFunc("POST /api/missions", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Name  string `json:"name"`
			Mover string `json:"mover"`
			Base  *point `json:"base"`
		}
		if err := decode(r, &req); err != nil {
			fail(w, 400, err)
			return
		}
		if req.Mover == "" {
			req.Mover = "crew_rover"
		}
		if req.Name == "" {
			req.Name = "Exploration mission"
		}
		bx, by := g.Meta.LandingSite.X, g.Meta.LandingSite.Y
		if req.Base != nil {
			var err error
			if bx, by, err = s.local(*req.Base); err != nil {
				fail(w, 400, fmt.Errorf("base: %w", err))
				return
			}
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		s.nextID++
		id := fmt.Sprintf("m%s-%d", time.Now().UTC().Format("20060102-150405"), s.nextID)
		m, err := s.engine.New(id, req.Name, req.Mover, bx, by)
		if err != nil {
			fail(w, http.StatusUnprocessableEntity, err)
			return
		}
		if req.Base == nil && g.Meta.LandingSite.Name != "" {
			m.Base.Name = g.Meta.LandingSite.Name
		}
		s.missions[id] = m
		s.save(m)
		writeJSON(w, http.StatusCreated, m)
	})

	mux.HandleFunc("GET /api/missions/{id}", func(w http.ResponseWriter, r *http.Request) {
		s.with(w, r, func(m *mission.Mission) error { return nil })
	})

	mux.HandleFunc("POST /api/missions/{id}/targets", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			point
			Name      string  `json:"name"`
			Objective string  `json:"objective"`
			DwellMin  float64 `json:"dwell_min"`
		}
		if err := decode(r, &req); err != nil {
			fail(w, 400, err)
			return
		}
		x, y, err := s.local(req.point)
		if err != nil {
			fail(w, 400, err)
			return
		}
		s.with(w, r, func(m *mission.Mission) error {
			return s.engine.AddTarget(m, req.Name, req.Objective, x, y, req.DwellMin)
		})
	})

	mux.HandleFunc("DELETE /api/missions/{id}/targets", func(w http.ResponseWriter, r *http.Request) {
		s.with(w, r, func(m *mission.Mission) error { return s.engine.ClearTargets(m) })
	})

	mux.HandleFunc("POST /api/missions/{id}/plan", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Mover      string   `json:"mover"`
			Objective  string   `json:"objective"`
			RiskWeight *float64 `json:"risk_weight"`
		}
		if err := decode(r, &req); err != nil {
			fail(w, 400, err)
			return
		}
		s.with(w, r, func(m *mission.Mission) error {
			mover := req.Mover
			if mover == "" {
				mover = m.Mover
			}
			risk := -1.0
			if req.RiskWeight != nil {
				risk = *req.RiskWeight
			}
			return s.engine.SetMover(m, mover, planner.Objective(req.Objective), risk)
		})
	})

	mux.HandleFunc("POST /api/missions/{id}/finecheck", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Avoid bool `json:"avoid"`
		}
		if err := decode(r, &req); err != nil {
			fail(w, 400, err)
			return
		}
		s.with(w, r, func(m *mission.Mission) error { return s.engine.CheckFine(m, req.Avoid) })
	})

	mux.HandleFunc("POST /api/missions/{id}/habitat", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Crew       int                `json:"crew"`
			Sols       float64            `json:"sols"`
			CropAreaM2 map[string]float64 `json:"crop_area_m2"`
			Overrides  map[string]float64 `json:"overrides"`
		}
		if err := decode(r, &req); err != nil {
			fail(w, 400, err)
			return
		}
		s.with(w, r, func(m *mission.Mission) error {
			s.engine.SetHabitat(m, req.Crew, req.Sols, req.CropAreaM2, req.Overrides)
			return nil
		})
	})

	mux.HandleFunc("POST /api/missions/{id}/sim/{action}", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Seconds    float64 `json:"seconds"`
			Kind       string  `json:"kind"`
			HeadingDeg float64 `json:"heading_deg"`
			DistanceM  float64 `json:"distance_m"`
		}
		if err := decode(r, &req); err != nil {
			fail(w, 400, err)
			return
		}
		action := r.PathValue("action")
		s.with(w, r, func(m *mission.Mission) error {
			switch action {
			case "start":
				return s.engine.Start(m)
			case "step":
				if req.Seconds <= 0 || req.Seconds > 6*3600 {
					return errors.New("seconds must be between 0 and 21600")
				}
				s.engine.Step(m, req.Seconds)
				return nil
			case "reset":
				s.engine.Reset(m)
				return nil
			case "emergency":
				return s.engine.Inject(m, req.Kind)
			case "drive":
				return s.engine.Drive(m, req.HeadingDeg, req.DistanceM)
			}
			return fmt.Errorf("unknown simulation action %q", action)
		})
	})

	return cors(mux)
}

// cors allows the local web interface to call this service.
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if strings.HasPrefix(origin, "http://localhost:") || strings.HasPrefix(origin, "http://127.0.0.1:") {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// scienceClient calls the science service, which reads NASA's 1 m HiRISE elevation model.
type scienceClient struct {
	base string
	http *http.Client
}

func newScienceClient(url string) *scienceClient {
	// A first read downloads the elevation under the route, so the timeout is long.
	return &scienceClient{base: strings.TrimRight(url, "/"), http: &http.Client{Timeout: 8 * time.Minute}}
}

func (c *scienceClient) post(path string, in, out any) error {
	body, err := json.Marshal(in)
	if err != nil {
		return err
	}
	resp, err := c.http.Post(c.base+path, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("the science service did not answer: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		var e struct {
			Detail any `json:"detail"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&e)
		return fmt.Errorf("science service: %v (HTTP %d)", e.Detail, resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("science service reply: %w", err)
	}
	return nil
}

// checkRoute measures a route on the 1 m elevation model.
func (c *scienceClient) checkRoute(points [][2]float64, limitDeg float64) (*mission.FineCheck, error) {
	var out mission.FineCheck
	if err := c.post("/jezero/finecheck", map[string]any{"points": points, "limit_deg": limitDeg}, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// surveyCells measures whole planner cells on the 1 m elevation model.
func (c *scienceClient) surveyCells(cells [][2]float64, cellM, limitDeg float64) ([]mission.FineCell, error) {
	var out struct {
		Cells []mission.FineCell `json:"cells"`
	}
	const batch = 4000 // the science service accepts up to 6000 cells in one request
	var all []mission.FineCell
	for i := 0; i < len(cells); i += batch {
		j := min(i+batch, len(cells))
		out.Cells = nil
		if err := c.post("/jezero/finecells", map[string]any{"cells": cells[i:j], "cell_m": cellM, "limit_deg": limitDeg}, &out); err != nil {
			return nil, err
		}
		all = append(all, out.Cells...)
	}
	return all, nil
}

func main() {
	terrainDir := flag.String("terrain", filepath.Join("..", "data", "jezero"), "folder with terrain.json and terrain.bin")
	storeDir := flag.String("store", filepath.Join("..", "data", "missions"), "folder where missions are saved (empty to disable)")
	addr := flag.String("addr", "127.0.0.1:8300", "listen address")
	science := flag.String("science", "http://127.0.0.1:8310", "science service, which reads the 1 m elevation model (empty to disable)")
	flag.Parse()

	grid, err := terrain.Load(*terrainDir)
	if err != nil {
		log.Fatalf("cannot load terrain: %v\nBuild it first: (in science/) python -m bel.jezero build", err)
	}
	if *storeDir != "" {
		if err := os.MkdirAll(*storeDir, 0o755); err != nil {
			log.Fatalf("cannot create the mission store: %v", err)
		}
	}
	s := &server{engine: &mission.Engine{Grid: grid}, missions: map[string]*mission.Mission{}, storeDir: *storeDir}
	if *science != "" {
		sc := newScienceClient(*science)
		s.engine.Fine, s.engine.FineCells = sc.checkRoute, sc.surveyCells
	}
	log.Printf("terrain: %s, %d x %d cells of %.0f m", grid.Meta.Name, grid.N, grid.N, grid.CellM)
	log.Printf("mission service listening on http://%s", *addr)
	srv := &http.Server{Addr: *addr, Handler: s.routes(), ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(srv.ListenAndServe())
}
