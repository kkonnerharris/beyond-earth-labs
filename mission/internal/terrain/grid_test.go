package terrain

import (
	"math"
	"os"
	"path/filepath"
	"testing"
)

func small(t *testing.T) *Grid {
	t.Helper()
	n := 10
	g, err := New("mars", n, 20, 18.465, 77.385, make([]float32, n*n), make([]float32, n*n), make([]float32, n*n))
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func TestCellAtAndCentreAgree(t *testing.T) {
	g := small(t)
	for row := 0; row < g.N; row++ {
		for col := 0; col < g.N; col++ {
			x, y := g.Centre(row, col)
			r, c, ok := g.CellAt(x, y)
			if !ok || r != row || c != col {
				t.Fatalf("cell (%d,%d) centre maps back to (%d,%d) ok=%v", row, col, r, c, ok)
			}
		}
	}
	// Row 0 is north, column 0 is west.
	_, yTop := g.Centre(0, 0)
	_, yBottom := g.Centre(g.N-1, 0)
	xLeft, _ := g.Centre(0, 0)
	xRight, _ := g.Centre(0, g.N-1)
	if !(yTop > yBottom && xLeft < xRight) {
		t.Fatal("grid orientation is not north-up, west-left")
	}
	if _, _, ok := g.CellAt(g.Half()+1, 0); ok {
		t.Fatal("a point east of the grid was reported as on the grid")
	}
}

func TestProjectionRoundTrip(t *testing.T) {
	g := small(t)
	for _, p := range [][2]float64{{0, 0}, {4800, 4800}, {-4800, 3000}, {1234.5, -4321.0}} {
		lon, lat := g.ToLonLat(p[0], p[1])
		x, y := g.FromLonLat(lon, lat)
		if math.Abs(x-p[0]) > 1e-4 || math.Abs(y-p[1]) > 1e-4 {
			t.Fatalf("round trip of (%.1f, %.1f) gave (%.4f, %.4f)", p[0], p[1], x, y)
		}
	}
	// One degree of latitude on the Mars sphere is 59.27 km.
	_, lat := g.ToLonLat(0, 59274.7)
	if math.Abs(lat-(18.465+1)) > 2e-3 {
		t.Fatalf("59.27 km north should be about one degree; got %.4f", lat-18.465)
	}
}

// The science service writes the grid corners using PROJ. The Go projection
// must agree with it, or routes would be drawn in the wrong place on the map.
func TestProjectionMatchesScienceServiceCorners(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "data", "jezero")
	if _, err := os.Stat(filepath.Join(dir, "terrain.bin")); err != nil {
		t.Skip("data/jezero has not been built")
	}
	g, err := Load(dir)
	if err != nil {
		t.Fatal(err)
	}
	h := g.Half()
	want := g.Meta.Grid.Corners // top-left, top-right, bottom-right, bottom-left
	local := [][2]float64{{-h, h}, {h, h}, {h, -h}, {-h, -h}}
	if len(want) != 4 {
		t.Fatalf("expected 4 corners, got %d", len(want))
	}
	for i, p := range local {
		lon, lat := g.ToLonLat(p[0], p[1])
		// Corners are stored to 6 decimals: 1e-6 degrees is about 6 cm on Mars.
		if math.Abs(lon-want[i][0]) > 2e-6 || math.Abs(lat-want[i][1]) > 2e-6 {
			t.Fatalf("corner %d: Go (%.7f, %.7f), PROJ (%.6f, %.6f)", i, lon, lat, want[i][0], want[i][1])
		}
	}
	// The landing site's stored local position matches its stored coordinates.
	x, y := g.FromLonLat(g.Meta.LandingSite.Lon, g.Meta.LandingSite.Lat)
	if math.Abs(x-g.Meta.LandingSite.X) > 0.2 || math.Abs(y-g.Meta.LandingSite.Y) > 0.2 {
		t.Fatalf("landing site: Go (%.1f, %.1f), science service (%.1f, %.1f)", x, y, g.Meta.LandingSite.X, g.Meta.LandingSite.Y)
	}
	s, ok := g.SampleAt(x, y)
	if !ok || s.ElevationM > -2400 || s.ElevationM < -2700 {
		t.Fatalf("landing site elevation %.1f m is not near the expected -2570 m", s.ElevationM)
	}
}
