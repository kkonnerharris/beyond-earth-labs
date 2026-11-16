// Package terrain loads the measured terrain grid produced by the science
// service and answers questions about it in local metres.
//
// The grid is square and north-up in a Lambert azimuthal equal-area
// projection centred on the mission area, so one cell is the same number of
// metres everywhere. Row 0 is the northern edge and column 0 the western.
// Local coordinates are x east and y north of the grid centre.
package terrain

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
)

// Meta mirrors the fields of terrain.json that the mission service needs.
type Meta struct {
	Name string `json:"name"`
	Body string `json:"body"`
	Grid struct {
		N          int          `json:"n"`
		CellM      float64      `json:"cell_m"`
		SizeM      float64      `json:"size_m"`
		Lat0       float64      `json:"lat0"`
		Lon0       float64      `json:"lon0"`
		Projection string       `json:"projection"`
		Corners    [][2]float64 `json:"corners_lonlat_tl_tr_br_bl"`
	} `json:"grid"`
	Layers []struct {
		Name   string `json:"name"`
		Offset int64  `json:"offset_bytes"`
	} `json:"layers"`
	Units           map[string]string `json:"units"`
	ElevationSource json.RawMessage   `json:"elevation_source"`
	LandingSite     struct {
		Name string  `json:"name"`
		Lat  float64 `json:"lat"`
		Lon  float64 `json:"lon"`
		X    float64 `json:"x"`
		Y    float64 `json:"y"`
	} `json:"landing_site"`
	Validation json.RawMessage `json:"validation"`
	BuiltUTC   string          `json:"built_utc"`
}

// Grid is a loaded terrain grid. Layers are row-major.
type Grid struct {
	Meta      Meta
	N         int
	CellM     float64
	RadiusM   float64 // reference sphere of the body
	Elevation []float32
	Slope     []float32 // degrees, magnitude of the steepest gradient
	Roughness []float32 // metres RMS about the local plane
}

// Reference sphere radii, metres. These match science/bel/bodies.py.
var bodyRadius = map[string]float64{"mars": 3396190.0, "moon": 1737400.0}

// Load reads terrain.json and terrain.bin from dir.
func Load(dir string) (*Grid, error) {
	raw, err := os.ReadFile(filepath.Join(dir, "terrain.json"))
	if err != nil {
		return nil, fmt.Errorf("terrain metadata: %w", err)
	}
	bin, err := os.ReadFile(filepath.Join(dir, "terrain.bin"))
	if err != nil {
		return nil, fmt.Errorf("terrain layers: %w", err)
	}
	return FromBytes(raw, bin)
}

// FromBytes builds the grid from the contents of terrain.json and terrain.bin. The browser build of the
// mission service is handed these two files by the page; the server build reads them from a folder.
func FromBytes(raw, bin []byte) (*Grid, error) {
	var m Meta
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("terrain metadata: %w", err)
	}
	n := m.Grid.N
	if n <= 1 || m.Grid.CellM <= 0 {
		return nil, errors.New("terrain metadata: grid size or cell size missing")
	}
	radius, ok := bodyRadius[m.Body]
	if !ok {
		return nil, fmt.Errorf("terrain metadata: no reference radius for body %q", m.Body)
	}
	g := &Grid{Meta: m, N: n, CellM: m.Grid.CellM, RadiusM: radius}
	for _, l := range m.Layers {
		buf := make([]float32, n*n)
		end := l.Offset + int64(4*n*n)
		if l.Offset < 0 || end > int64(len(bin)) {
			return nil, fmt.Errorf("terrain layer %s: the layer file is too short", l.Name)
		}
		if err := binary.Read(bytes.NewReader(bin[l.Offset:end]), binary.LittleEndian, buf); err != nil {
			return nil, fmt.Errorf("terrain layer %s: %w", l.Name, err)
		}
		switch l.Name {
		case "elevation_m":
			g.Elevation = buf
		case "slope_deg":
			g.Slope = buf
		case "roughness_m":
			g.Roughness = buf
		}
	}
	if g.Elevation == nil || g.Slope == nil || g.Roughness == nil {
		return nil, errors.New("terrain layers: elevation, slope and roughness are all required")
	}
	return g, nil
}

// New builds a grid from in-memory layers (used by tests and synthetic scenarios).
func New(body string, n int, cellM, lat0, lon0 float64, elevation, slope, roughness []float32) (*Grid, error) {
	radius, ok := bodyRadius[body]
	if !ok {
		return nil, fmt.Errorf("no reference radius for body %q", body)
	}
	if len(elevation) != n*n || len(slope) != n*n || len(roughness) != n*n {
		return nil, errors.New("layer sizes do not match the grid")
	}
	g := &Grid{N: n, CellM: cellM, RadiusM: radius, Elevation: elevation, Slope: slope, Roughness: roughness}
	g.Meta.Body = body
	g.Meta.Grid.N, g.Meta.Grid.CellM, g.Meta.Grid.SizeM = n, cellM, float64(n)*cellM
	g.Meta.Grid.Lat0, g.Meta.Grid.Lon0 = lat0, lon0
	return g, nil
}

// Half is half the side length of the grid, metres.
func (g *Grid) Half() float64 { return float64(g.N) * g.CellM / 2 }

// Index returns the flat index of a cell.
func (g *Grid) Index(row, col int) int { return row*g.N + col }

// RowCol returns the row and column of a flat index.
func (g *Grid) RowCol(i int) (int, int) { return i / g.N, i % g.N }

// InBounds reports whether a cell exists.
func (g *Grid) InBounds(row, col int) bool { return row >= 0 && col >= 0 && row < g.N && col < g.N }

// CellAt returns the cell containing local point (x east, y north), and whether it is on the grid.
func (g *Grid) CellAt(x, y float64) (row, col int, ok bool) {
	h := g.Half()
	col = int(math.Floor((x + h) / g.CellM))
	row = int(math.Floor((h - y) / g.CellM))
	return row, col, g.InBounds(row, col)
}

// Centre returns the local coordinates of a cell centre.
func (g *Grid) Centre(row, col int) (x, y float64) {
	h := g.Half()
	return -h + (float64(col)+0.5)*g.CellM, h - (float64(row)+0.5)*g.CellM
}

// ToLonLat converts local metres to planetocentric longitude and latitude in
// degrees (inverse spherical Lambert azimuthal equal-area, Snyder 1987 eq. 24-14 to 24-16).
func (g *Grid) ToLonLat(x, y float64) (lon, lat float64) {
	lat0 := g.Meta.Grid.Lat0 * math.Pi / 180
	lon0 := g.Meta.Grid.Lon0 * math.Pi / 180
	rho := math.Hypot(x, y)
	if rho < 1e-9 {
		return g.Meta.Grid.Lon0, g.Meta.Grid.Lat0
	}
	c := 2 * math.Asin(math.Min(1, rho/(2*g.RadiusM)))
	sinC, cosC := math.Sincos(c)
	phi := math.Asin(cosC*math.Sin(lat0) + y*sinC*math.Cos(lat0)/rho)
	lam := lon0 + math.Atan2(x*sinC, rho*math.Cos(lat0)*cosC-y*math.Sin(lat0)*sinC)
	return lam * 180 / math.Pi, phi * 180 / math.Pi
}

// FromLonLat converts longitude and latitude in degrees to local metres
// (forward spherical Lambert azimuthal equal-area, Snyder 1987 eq. 24-2 to 24-4).
func (g *Grid) FromLonLat(lon, lat float64) (x, y float64) {
	lat0 := g.Meta.Grid.Lat0 * math.Pi / 180
	dl := (lon - g.Meta.Grid.Lon0) * math.Pi / 180
	phi := lat * math.Pi / 180
	k := math.Sqrt(2 / (1 + math.Sin(lat0)*math.Sin(phi) + math.Cos(lat0)*math.Cos(phi)*math.Cos(dl)))
	x = g.RadiusM * k * math.Cos(phi) * math.Sin(dl)
	y = g.RadiusM * k * (math.Cos(lat0)*math.Sin(phi) - math.Sin(lat0)*math.Cos(phi)*math.Cos(dl))
	return x, y
}

// ElevationAt returns the elevation at a local point, interpolated between
// cell centres so that it changes smoothly as a mover crosses a cell.
// Points off the grid are clamped to its edge.
func (g *Grid) ElevationAt(x, y float64) float64 {
	h := g.Half()
	fc := (x+h)/g.CellM - 0.5
	fr := (h-y)/g.CellM - 0.5
	max := float64(g.N - 1)
	fc = math.Max(0, math.Min(max, fc))
	fr = math.Max(0, math.Min(max, fr))
	c0, r0 := int(math.Floor(fc)), int(math.Floor(fr))
	c1, r1 := c0+1, r0+1
	if c1 > g.N-1 {
		c1 = g.N - 1
	}
	if r1 > g.N-1 {
		r1 = g.N - 1
	}
	tc, tr := fc-float64(c0), fr-float64(r0)
	z := func(r, c int) float64 { return float64(g.Elevation[g.Index(r, c)]) }
	top := z(r0, c0)*(1-tc) + z(r0, c1)*tc
	bottom := z(r1, c0)*(1-tc) + z(r1, c1)*tc
	return top*(1-tr) + bottom*tr
}

// Sample is the terrain at one cell.
type Sample struct {
	Row        int     `json:"row"`
	Col        int     `json:"col"`
	X          float64 `json:"x"`
	Y          float64 `json:"y"`
	Lon        float64 `json:"lon"`
	Lat        float64 `json:"lat"`
	ElevationM float64 `json:"elevation_m"`
	SlopeDeg   float64 `json:"slope_deg"`
	RoughnessM float64 `json:"roughness_m"`
}

// SampleAt returns the terrain of the cell containing a local point.
func (g *Grid) SampleAt(x, y float64) (Sample, bool) {
	row, col, ok := g.CellAt(x, y)
	if !ok {
		return Sample{}, false
	}
	i := g.Index(row, col)
	cx, cy := g.Centre(row, col)
	lon, lat := g.ToLonLat(cx, cy)
	return Sample{Row: row, Col: col, X: cx, Y: cy, Lon: lon, Lat: lat,
		ElevationM: float64(g.Elevation[i]), SlopeDeg: float64(g.Slope[i]), RoughnessM: float64(g.Roughness[i])}, true
}
