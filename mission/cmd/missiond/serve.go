//go:build !js

package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"beyondearthlabs/mission/internal/mission"
	"beyondearthlabs/mission/internal/terrain"
)

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
