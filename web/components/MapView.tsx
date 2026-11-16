"use client";

import maplibregl, { type GeoJSONSource, type Map as MlMap } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { BODY_RADIUS_M, scienceApi, type Body, type M2020, type Mission, type RegionInfo, type Terrain, type Terrain3D } from "@/lib/api";
import { circleRing, metresPerPixel, niceScale } from "@/lib/geo";
import { createModelLayer, MODELS, MODEL_FOR_MOVER, type ModelInstance } from "./roverModel";

export type LayerState = Record<string, boolean>;
export type Focus = { lon: number; lat: number; zoom: number; key: number; pitch?: number; bearing?: number };

type Props = {
  body: Body;
  terrain: Terrain | null;
  dem: Terrain3D | null;
  threeD: boolean;
  surface: boolean;          // ground-level chase camera behind the mover
  aim: number;               // compass heading the chase camera looks along, degrees
  m2020: M2020 | null;
  mission: Mission | null;
  layers: LayerState;
  regions: RegionInfo[];
  selectedRegion: string | null;
  focus: Focus | null;
  placing: boolean;
  onClick: (lon: number, lat: number) => void;
  onRegion: (region: string) => void;
};

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const EXAGGERATION = 2;

// Raster basemaps. Mars and Moon imagery comes from NASA Solar System Treks through the science
// service (which reprojects it); Earth imagery comes straight from NASA GIBS.
const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg";
const RASTERS: { id: string; body: Body; url?: string; minzoom?: number; maxzoom: number; credit: string }[] = [
  { id: "mars_viking", body: "mars", maxzoom: 8, credit: "Imagery: NASA Solar System Treks (JPL)" },
  { id: "mars_themis_day", body: "mars", maxzoom: 10, credit: "Imagery: NASA Solar System Treks (JPL)" },
  { id: "jezero_ctx", body: "mars", minzoom: 8, maxzoom: 14, credit: "Imagery: NASA Solar System Treks (JPL)" },
  { id: "jezero_hirise", body: "mars", minzoom: 11, maxzoom: 18, credit: "Imagery: NASA Solar System Treks (JPL)" },
  { id: "moon_wac", body: "moon", maxzoom: 9, credit: "Imagery: NASA Solar System Treks (JPL)" },
  { id: "earth_bluemarble", body: "earth", url: GIBS, maxzoom: 8, credit: "Imagery: NASA GIBS, Blue Marble" },
];
const OVERLAYS = ["hillshade", "slope", "thermal"] as const;

// Illustrative sky for the tilted view. Only Earth gets an atmosphere glow on the globe.
const SKY: Record<Body, maplibregl.SkySpecification> = {
  mars: { "sky-color": "#1a120e", "horizon-color": "#8a5a3c", "fog-color": "#6b4630", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.6, "fog-ground-blend": 0.2, "atmosphere-blend": 0 },
  moon: { "sky-color": "#000000", "horizon-color": "#05070b", "fog-color": "#05070b", "sky-horizon-blend": 0.2, "horizon-fog-blend": 0.2, "fog-ground-blend": 0, "atmosphere-blend": 0 },
  earth: { "sky-color": "#0a1830", "horizon-color": "#7fb2e6", "fog-color": "#a9c8ea", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.5, "fog-ground-blend": 0.2,
           "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 0.9, 5, 0.6, 7, 0] },
};

/** Top-down rover drawn on a canvas so no image asset is needed. Points north (up). */
function roverIcon(size = 96): ImageData {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const u = size / 48;
  g.translate(size / 2, size / 2);
  g.fillStyle = "#11161d";
  for (const x of [-15, 15]) for (const y of [-15, 0, 15]) {
    g.beginPath(); g.roundRect((x - 4) * u, (y - 6) * u, 8 * u, 12 * u, 2.5 * u); g.fill();
    g.strokeStyle = "#8ea0b4"; g.lineWidth = 1 * u; g.stroke();
  }
  g.fillStyle = "#e9eef4"; g.strokeStyle = "#0a0e13"; g.lineWidth = 1.4 * u;
  g.beginPath(); g.roundRect(-10 * u, -14 * u, 20 * u, 28 * u, 4 * u); g.fill(); g.stroke();
  g.fillStyle = "#e2733c";
  g.beginPath(); g.roundRect(-7 * u, -2 * u, 14 * u, 12 * u, 2 * u); g.fill();
  g.fillStyle = "#0a0e13";
  g.beginPath(); g.arc(0, -9 * u, 3.4 * u, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#5fd4e0";
  g.beginPath(); g.arc(0, -9 * u, 1.5 * u, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "#5fd4e0"; g.lineWidth = 1.6 * u;
  g.beginPath(); g.moveTo(0, -16 * u); g.lineTo(0, -21 * u); g.stroke();
  return g.getImageData(0, 0, size, size);
}

/** A suited crew member seen from above. */
function walkerIcon(size = 72): ImageData {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const u = size / 36;
  g.translate(size / 2, size / 2);
  g.fillStyle = "#e9eef4"; g.strokeStyle = "#0a0e13"; g.lineWidth = 1.2 * u;
  g.beginPath(); g.ellipse(0, 1 * u, 9 * u, 6 * u, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = "#e2733c";
  g.beginPath(); g.roundRect(-5 * u, 3 * u, 10 * u, 5 * u, 1.5 * u); g.fill();
  g.fillStyle = "#f6f8fa";
  g.beginPath(); g.arc(0, -1 * u, 5 * u, 0, Math.PI * 2); g.fill(); g.stroke();
  g.fillStyle = "#5fd4e0";
  g.beginPath(); g.arc(0, -3.2 * u, 2.4 * u, Math.PI, 0); g.fill();
  return g.getImageData(0, 0, size, size);
}

function lineFeature(coords: [number, number][], props: Record<string, unknown> = {}): GeoJSON.Feature {
  return { type: "Feature", properties: props, geometry: { type: "LineString", coordinates: coords } };
}

export default function MapView(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const markersRef = markers;
  const regionMarkers = useRef<maplibregl.Marker[]>([]);
  const anim = useRef<{ from: [number, number]; to: [number, number]; t0: number; heading: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [layerOn, setLayerOn] = useState(false);
  const [modelsOk, setModelsOk] = useState<Record<string, boolean>>({});
  const instances = useRef<ModelInstance[]>([]);
  const modelLabels = useRef<maplibregl.Marker[]>([]);
  const [cursor, setCursor] = useState<{ lon: number; lat: number } | null>(null);
  const [scale, setScale] = useState<{ px: number; label: string } | null>(null);
  const cb = useRef({ onClick: p.onClick, onRegion: p.onRegion });
  cb.current = { onClick: p.onClick, onRegion: p.onRegion };
  const bodyRef = useRef(p.body);
  bodyRef.current = p.body;

  // Create the map once.
  useEffect(() => {
    if (!el.current || mapRef.current) return;
    const sources: Record<string, maplibregl.SourceSpecification> = {};
    const layers: maplibregl.LayerSpecification[] = [
      { id: "background", type: "background", paint: { "background-color": "#020305" } },
    ];
    for (const r of RASTERS) {
      sources[r.id] = { type: "raster", tiles: [r.url ?? scienceApi.tileUrl(r.id)], tileSize: 256,
                        minzoom: r.minzoom ?? 0, maxzoom: r.maxzoom, attribution: r.credit };
      layers.push({ id: r.id, type: "raster", source: r.id, layout: { visibility: "none" },
                    paint: { "raster-fade-duration": 150, "raster-opacity": r.id === "mars_themis_day" ? 0.85 : 1 } });
    }
    const map = new maplibregl.Map({
      container: el.current,
      style: { version: 8, projection: { type: "globe" }, sources, layers, sky: SKY.mars },
      center: [77.385, 18.465], zoom: 11.4, minZoom: 0.8, maxZoom: 20.5, maxPitch: 82,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-left");
    map.on("load", () => {
      map.addImage("rover", roverIcon(), { pixelRatio: 2 });
      map.addImage("walker", walkerIcon(), { pixelRatio: 2 });
      for (const id of ["m2020", "plan", "active", "track", "hazards", "fine", "mover", "area"]) {
        map.addSource(id, { type: "geojson", data: EMPTY });
      }
      map.addLayer({ id: "area", type: "line", source: "area",
                     paint: { "line-color": "#5fd4e0", "line-width": 1, "line-opacity": 0.55, "line-dasharray": [3, 3] } });
      map.addLayer({ id: "m2020", type: "line", source: "m2020", layout: { "line-join": "round", "line-cap": "round" },
                     paint: { "line-color": "#ffffff", "line-width": 1.6, "line-opacity": 0.75 } });
      map.addLayer({ id: "hazards-fill", type: "fill", source: "hazards", paint: { "fill-color": "#ef6a5e", "fill-opacity": 0.22 } });
      map.addLayer({ id: "hazards-line", type: "line", source: "hazards", paint: { "line-color": "#ef6a5e", "line-width": 1.5 } });
      map.addLayer({ id: "plan", type: "line", source: "plan", layout: { "line-join": "round", "line-cap": "round" },
                     paint: { "line-color": "#f0a070", "line-width": 2, "line-opacity": 0.55, "line-dasharray": [1.5, 2] } });
      map.addLayer({ id: "active-casing", type: "line", source: "active", layout: { "line-join": "round", "line-cap": "round" },
                     paint: { "line-color": "#070a0f", "line-width": 6, "line-opacity": 0.7 } });
      map.addLayer({ id: "active", type: "line", source: "active", layout: { "line-join": "round", "line-cap": "round" },
                     paint: { "line-color": "#e2733c", "line-width": 3 } });
      map.addLayer({ id: "track", type: "line", source: "track", layout: { "line-join": "round", "line-cap": "round" },
                     paint: { "line-color": "#5fd4e0", "line-width": 2.5 } });
      // Stretches of the route that are steeper than the mover's limit on the 1 m elevation model.
      map.addLayer({ id: "fine", type: "circle", source: "fine",
                     paint: { "circle-radius": 6, "circle-color": "#ef6a5e", "circle-stroke-color": "#ffffff", "circle-stroke-width": 1.5 } });
      map.addLayer({ id: "mover", type: "symbol", source: "mover",
                     layout: { "icon-image": ["get", "icon"], "icon-rotate": ["get", "heading"], "icon-rotation-alignment": "map",
                               "icon-pitch-alignment": "map", "icon-allow-overlap": true, "icon-ignore-placement": true,
                               "icon-size": ["interpolate", ["linear"], ["zoom"], 8, 0.45, 13, 0.8, 17, 1.25] } });
      setReady(true);
      // NASA's 3D models, if the files have been fetched (scripts/fetch_nasa_models.py).
      fetch(MODELS.perseverance.url, { method: "HEAD" }).then((r) => {
        if (!r.ok || mapRef.current !== map) return;
        map.addLayer(createModelLayer(instances, (k, ok) => setModelsOk((v) => ({ ...v, [k]: ok }))));
        setLayerOn(true);
      }).catch(() => undefined);
    });
    map.on("click", (e) => cb.current.onClick(e.lngLat.lng, e.lngLat.lat));
    map.on("mousemove", (e) => setCursor({ lon: e.lngLat.lng, lat: e.lngLat.lat }));
    map.on("mouseout", () => setCursor(null));
    const updateScale = () => {
      // A scale bar is only meaningful once the view is close enough to be nearly flat.
      setScale(map.getZoom() >= 4 && map.getPitch() < 50
        ? niceScale(metresPerPixel(map.getCenter().lat, map.getZoom(), BODY_RADIUS_M[bodyRef.current])) : null);
    };
    map.on("move", updateScale);
    updateScale();
    // Mission labels would crowd the globe, so they appear only once the view is close.
    map.on("zoom", () => {
      const show = map.getZoom() >= 8.5 ? "" : "none";
      for (const mk of markersRef.current) mk.getElement().style.display = show;
    });
    mapRef.current = map;
    (window as unknown as { __belMap?: MlMap }).__belMap = map;   // for the browser checks in scripts/
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // Local analysis overlays need the mission-area corners.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !p.terrain) return;
    const corners = p.terrain.grid.corners_lonlat_tl_tr_br_bl as [[number, number], [number, number], [number, number], [number, number]];
    for (const name of OVERLAYS) {
      const info = p.terrain.overlays[name];
      if (!info?.file || map.getSource(`ov-${name}`)) continue;
      map.addSource(`ov-${name}`, { type: "image", url: window.location.origin + scienceApi.overlayUrl(name), coordinates: corners });
      map.addLayer({ id: `ov-${name}`, type: "raster", source: `ov-${name}`, layout: { visibility: "none" },
                     paint: { "raster-opacity": name === "hillshade" ? 0.55 : 0.6, "raster-fade-duration": 0 } }, "area");
    }
    (map.getSource("area") as GeoJSONSource).setData(lineFeature([...corners, corners[0]]));
  }, [ready, p.terrain]);

  // 3D terrain: the surface is raised from the measured elevation model.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (p.dem && !map.getSource("jezero-dem")) {
      map.addSource("jezero-dem", { type: "raster-dem", tiles: [scienceApi.demUrl()], tileSize: p.dem.tile_size,
                                    encoding: "terrarium", maxzoom: p.dem.max_zoom, bounds: p.dem.bounds_lonlat });
    }
    const on = p.threeD && p.body === "mars" && !!map.getSource("jezero-dem");
    map.setTerrain(on ? { source: "jezero-dem", exaggeration: EXAGGERATION } : null);
  }, [ready, p.dem, p.threeD, p.body]);

  // Surface view: the camera rides close behind the mover, looking where it is heading.
  // The rust tint over the grey orbital imagery is illustrative.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (p.dem && !map.getSource("tint")) {
      const [w, s, e, n] = p.dem.bounds_lonlat;
      map.addSource("tint", { type: "geojson", data: { type: "Feature", properties: {},
        geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } } });
      map.addLayer({ id: "tint", type: "fill", source: "tint", layout: { visibility: "none" },
                     paint: { "fill-color": "#b4532a", "fill-opacity": 0.3 } }, "area");
    }
    if (map.getLayer("tint")) map.setLayoutProperty("tint", "visibility", p.surface && p.body === "mars" ? "visible" : "none");
  }, [ready, p.dem, p.surface, p.body]);

  useEffect(() => {
    const map = mapRef.current;
    const m = p.mission;
    if (!map || !ready) return;
    const on = p.surface && !!m && p.body === "mars";
    // In the surface view the camera is anchored to the terrain height under the mover. The 3D heights
    // are relative and can be far from zero, and at a steep tilt that would push the mover off-screen.
    map.setCenterClampedToGround(!on);
    if (!on || !m) return;
    const here: [number, number] = [m.sim.lon, m.sim.lat];
    map.setCenterElevation(map.queryTerrainElevation(here) ?? 0);
    map.easeTo({ center: here, zoom: 18.3, pitch: 76, bearing: p.aim, offset: [0, 110],
                 duration: 280, easing: (t) => t, essential: true });
  }, [ready, p.surface, p.aim, p.body, p.mission?.sim.lon, p.mission?.sim.lat, p.mission?.id]);

  // Layer visibility and the sky for each body.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const show = (id: string, on: boolean) => { if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none"); };
    for (const r of RASTERS) show(r.id, r.body === p.body && (r.body !== "mars" || !!p.layers[r.id]));
    for (const name of OVERLAYS) show(`ov-${name}`, p.body === "mars" && !!p.layers[name]);
    const mars = p.body === "mars";
    show("m2020", mars && !!p.layers.m2020);
    for (const id of ["area", "plan", "active", "active-casing", "track", "hazards-fill", "hazards-line", "fine", "mover"]) show(id, mars);
    // In 3D the mover is drawn as a 3D model, so its flat icon is hidden (unless that model failed to load).
    if (layerOn && p.threeD && p.mission && modelsOk[MODEL_FOR_MOVER[p.mission.mover]] !== false) show("mover", false);
    map.setSky(SKY[p.body]);
  }, [ready, p.layers, p.body, p.terrain, layerOn, modelsOk, p.threeD, p.mission?.mover, p.mission?.id]);

  // NASA 3D models: the mission's mover (rover or astronaut) and Perseverance at its last published stop.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const show3d = layerOn && p.threeD && p.body === "mars";
    const list: (ModelInstance & { label: string })[] = [];
    const m = p.mission;
    const key = m ? MODEL_FOR_MOVER[m.mover] : undefined;
    if (m && key) {
      const who = m.mover === "astronaut" ? "Astronaut" : m.mover === "scout" ? "Scout rover" : "Crew rover";
      list.push({ model: key, lon: m.sim.lon, lat: m.sim.lat, headingDeg: m.sim.heading_deg, visible: show3d,
                  label: `${who} · ${MODELS[key].label}, enlarged` });
    }
    const last = p.m2020?.waypoints.reduce<{ sol: number | null; lon: number; lat: number } | null>(
      (best, w) => (w.sol !== null && (best === null || (best.sol ?? -1) < w.sol) ? w : best), null);
    if (last && m?.mover !== "scout") {
      list.push({ model: "perseverance", lon: last.lon, lat: last.lat, headingDeg: 0, visible: show3d,
                  label: `Perseverance, sol ${last.sol} · NASA model, enlarged` });
    }
    instances.current = list;
    const want = show3d ? list : [];
    if (modelLabels.current.length !== want.length) {
      modelLabels.current.forEach((mk) => mk.remove());
      modelLabels.current = want.map((it) => {
        const d = document.createElement("div");
        d.style.pointerEvents = "none";
        d.innerHTML = `<div style="transform:translateY(-${Math.round(MODELS[it.model].screenPx * (MODELS[it.model].upright ? 1.0 : 0.62)) + 14}px);font:500 10.5px var(--font-sans);color:#dbe4ee;background:rgba(7,10,15,.82);border:1px solid #2c3c4f;border-radius:4px;padding:2px 6px;white-space:nowrap"></div>`;
        return new maplibregl.Marker({ element: d, anchor: "bottom" }).setLngLat([it.lon, it.lat]).addTo(map);
      });
    }
    want.forEach((it, i) => {
      const mk = modelLabels.current[i];
      mk.setLngLat([it.lon, it.lat]);
      const text = mk.getElement().firstElementChild as HTMLElement | null;
      if (text && text.textContent !== it.label) text.textContent = it.label;
    });
    map.triggerRepaint();
  }, [ready, layerOn, p.threeD, p.body, p.m2020, p.mission?.mover, p.mission?.sim.lon, p.mission?.sim.lat, p.mission?.sim.heading_deg, p.mission?.id]);

  // Perseverance's real traverse.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !p.m2020) return;
    (map.getSource("m2020") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: p.m2020.traverse.map((s) => lineFeature(s.points.map((q) => [q[2], q[3]] as [number, number]), { sol: s.sol })),
    });
  }, [ready, p.m2020]);

  // Mission geometry.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const m = p.mission;
    const legs = (routes: { points: { lon: number; lat: number }[] }[]) => ({
      type: "FeatureCollection" as const,
      features: routes.filter((r) => r.points?.length > 1).map((r) => lineFeature(r.points.map((q) => [q.lon, q.lat] as [number, number]))),
    });
    const running = !!m && m.sim.phase !== "idle";
    (map.getSource("plan") as GeoJSONSource).setData(m?.plan && running ? legs(m.plan.legs) : EMPTY);
    (map.getSource("active") as GeoJSONSource).setData(m ? legs(running ? m.sim.active_legs : m.plan?.legs ?? []) : EMPTY);
    (map.getSource("track") as GeoJSONSource).setData(
      m && m.sim.track.length > 1 ? { type: "FeatureCollection", features: [lineFeature([...m.sim.track, [m.sim.lon, m.sim.lat]])] } : EMPTY);
    (map.getSource("hazards") as GeoJSONSource).setData(m && p.terrain ? {
      type: "FeatureCollection",
      features: m.hazards.map((h) => ({ type: "Feature" as const, properties: { id: h.id },
        geometry: { type: "Polygon" as const, coordinates: [circleRing(h.x, h.y, h.radius_m, p.terrain!.grid.lat0, p.terrain!.grid.lon0, BODY_RADIUS_M.mars)] } })),
    } : EMPTY);

    // Stretches of the current plan that are steeper than the limit on the 1 m elevation model.
    const fine = m?.fine_check && m.plan && m.fine_check.revision === m.plan.revision ? m.fine_check.stretches : [];
    (map.getSource("fine") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: fine.map((s) => ({ type: "Feature" as const, properties: { slope: s.max_slope_deg },
        geometry: { type: "Point" as const, coordinates: [s.lon, s.lat] } })),
    });

    // Base and target markers are HTML so their labels stay crisp.
    markers.current.forEach((mk) => mk.remove());
    markers.current = [];
    if (m && p.body === "mars") {
      const mk = (lon: number, lat: number, html: string) => {
        const d = document.createElement("div");
        d.innerHTML = html;
        d.style.pointerEvents = "none";
        if (map.getZoom() < 8.5) d.style.display = "none";
        markers.current.push(new maplibregl.Marker({ element: d, anchor: "bottom" }).setLngLat([lon, lat]).addTo(map));
      };
      mk(m.base.lon, m.base.lat,
        `<div style="display:flex;flex-direction:column;align-items:center;gap:3px">
           <div style="font:600 10px var(--font-sans);letter-spacing:.06em;text-transform:uppercase;color:#dbe4ee;background:rgba(7,10,15,.82);border:1px solid #2c3c4f;border-radius:4px;padding:2px 6px;white-space:nowrap">${m.base.name}</div>
           <div style="width:12px;height:12px;border:2px solid #5fd4e0;background:#070a0f;transform:rotate(45deg)"></div></div>`);
      m.targets.forEach((t, i) => mk(t.lon, t.lat,
        `<div style="display:flex;flex-direction:column;align-items:center;gap:3px">
           <div style="font:500 11px var(--font-sans);color:#dbe4ee;background:rgba(7,10,15,.82);border:1px solid ${t.visited ? "#2f7a55" : "#5a3320"};border-radius:4px;padding:2px 6px;white-space:nowrap">${t.name}</div>
           <div style="width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font:600 10px var(--font-mono);color:#140a04;background:${t.visited ? "#58c98b" : "#e2733c"};border:2px solid #070a0f">${i + 1}</div></div>`));
    }
  }, [ready, p.mission, p.terrain, p.body]);

  // The mover glides between the positions the mission service reports.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const m = p.mission;
    const src = map.getSource("mover") as GeoJSONSource;
    if (!m) { src.setData(EMPTY); return; }
    const icon = m.mover === "astronaut" ? "walker" : "rover";
    const to: [number, number] = [m.sim.lon, m.sim.lat];
    const from = anim.current?.to ?? to;
    anim.current = { from, to, t0: performance.now(), heading: m.sim.heading_deg };
    let raf = 0;
    const tick = () => {
      const a = anim.current!;
      const k = Math.min(1, (performance.now() - a.t0) / 260);
      const pos: [number, number] = [a.from[0] + (a.to[0] - a.from[0]) * k, a.from[1] + (a.to[1] - a.from[1]) * k];
      src.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: { icon, heading: a.heading },
                    geometry: { type: "Point", coordinates: pos } }] });
      const inst = instances.current[0];           // the 3D model glides with the same interpolation
      if (inst && inst.model === MODEL_FOR_MOVER[m.mover]) { inst.lon = pos[0]; inst.lat = pos[1]; }
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [ready, p.mission?.sim.lon, p.mission?.sim.lat, p.mission?.sim.heading_deg, p.mission?.mover, p.mission?.id]);

  // Named regions on each body.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    regionMarkers.current.forEach((mk) => mk.remove());
    regionMarkers.current = [];
    for (const r of p.regions) {
      const b = document.createElement("button");
      const on = r.region === p.selectedRegion;
      b.type = "button";
      b.title = r.name;
      b.setAttribute("aria-label", `Select ${r.name}`);
      b.style.cssText = `width:${on ? 14 : 9}px;height:${on ? 14 : 9}px;border-radius:50%;cursor:pointer;padding:0;` +
        `background:${on ? "#e2733c" : r.control ? "rgba(232,184,74,.95)" : "rgba(95,212,224,.9)"};border:2px solid #070a0f;` +
        `box-shadow:0 0 0 1px ${on ? "#f0a070" : "rgba(95,212,224,.5)"}`;
      b.onclick = (e) => { e.stopPropagation(); cb.current.onRegion(r.region); };
      const lon = r.lon > 180 ? r.lon - 360 : r.lon;
      regionMarkers.current.push(new maplibregl.Marker({ element: b }).setLngLat([lon, r.lat]).addTo(map));
    }
  }, [ready, p.regions, p.selectedRegion]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !p.focus) return;
    const lon = p.focus.lon > 180 ? p.focus.lon - 360 : p.focus.lon;
    map.flyTo({ center: [lon, p.focus.lat], zoom: p.focus.zoom, pitch: p.focus.pitch ?? 0, bearing: p.focus.bearing ?? 0,
                duration: 1600, essential: true });
  }, [p.focus]);

  const bodyName = p.body === "moon" ? "the Moon" : p.body === "earth" ? "Earth" : "Mars";
  return (
    <div className="relative h-full w-full">
      <div ref={el} className="h-full w-full" style={{ cursor: p.placing ? "crosshair" : undefined }}
           role="application" aria-label={`Interactive 3D map of ${bodyName}`} />
      <div className="pointer-events-none absolute bottom-3 left-3 flex items-end gap-4">
        {scale && (
          <div className="flex flex-col gap-1">
            <span className="num text-[11px] text-text">{scale.label}</span>
            <div className="h-1.5 border-x border-b border-text" style={{ width: scale.px }} />
          </div>
        )}
        {cursor && (
          <span className="num rounded border border-line bg-ink/80 px-2 py-0.5 text-[11px] text-muted">
            {cursor.lat.toFixed(4)}° N&nbsp;&nbsp;{(cursor.lon < 0 && p.body !== "earth" ? cursor.lon + 360 : cursor.lon).toFixed(4)}° E
          </span>
        )}
        {p.threeD && p.body === "mars" && (
          <span className="rounded border border-line bg-ink/80 px-2 py-0.5 text-[11px] text-muted">
            Heights exaggerated {EXAGGERATION}×{layerOn ? " · 3D models enlarged" : ""} · drag with the right button to tilt and turn
          </span>
        )}
      </div>
    </div>
  );
}
