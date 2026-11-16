// 3D models on the map, drawn with three.js as a MapLibre custom layer.
//
//   crew rover   -> the six-wheel rover, built here from simple shapes. It is the same rover that
//                   drives in the 3D world (surface-world/), so the vehicle a route is planned for is
//                   the vehicle seen driving it.
//   scout rover  -> NASA's "Mars Perseverance Rover, 3D Model" (credit NASA/JPL-Caltech)
//   astronaut    -> NASA's "Z2 Spacesuit", its prototype planetary surface suit (credit NASA)
// Models are enlarged so they can be seen from a distance: each keeps a fixed size on screen
// until the view is close enough for it to be shown at true size.

import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from "maplibre-gl";
import * as THREE from "three";
import { BASE } from "@/lib/base";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type ModelKey = "perseverance" | "sev" | "z2_suit" | "rover6";
export type ModelInstance = { model: ModelKey; lon: number; lat: number; headingDeg: number; visible: boolean };

type Spec = { url: string; sizeM: number; screenPx: number; headingOffset: number; upright: boolean; label: string;
              /** Built from shapes instead of loaded from a file. */
              build?: () => THREE.Object3D };

/**
 * The six-wheel rover: rocker-bogie arms, a gold deck, a camera mast, a dish and a power source at the
 * rear. Same shapes and sizes as the rover in the 3D world. Local frame: +x forward, +y up, +z right.
 */
function buildSixWheelRover(): THREE.Object3D {
  const g = new THREE.Group();
  const mat = (color: string, metalness = 0.2, roughness = 0.5) => new THREE.MeshStandardMaterial({ color, metalness, roughness });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0], parent: THREE.Object3D = g) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(...pos);
    mesh.rotation.set(...rot);
    parent.add(mesh);
    return mesh;
  };
  const R = 0.42;
  for (const [x, z] of [[1.3, 1.2], [1.3, -1.2], [0, 1.3], [0, -1.3], [-1.3, 1.2], [-1.3, -1.2]] as const) {
    add(new THREE.CylinderGeometry(R, R, 0.36, 20), mat("#9a9a9a", 0.7, 0.35), [x, R, z], [Math.PI / 2, 0, 0]);
    add(new THREE.TorusGeometry(R * 0.98, 0.035, 6, 14), mat("#555555"), [x, R, z]);
    add(new THREE.BoxGeometry(0.08, 0.5, 0.08), mat("#d4d4d4", 0.6), [x, R + 0.45, z]);
  }
  for (const side of [1, -1]) {
    add(new THREE.BoxGeometry(1.5, 0.09, 0.09), mat("#cfcfcf", 0.6), [0.65, 0.95, side], [0, 0, -0.35]);
    add(new THREE.BoxGeometry(1.5, 0.09, 0.09), mat("#cfcfcf", 0.6), [-0.65, 0.95, side], [0, 0, 0.35]);
  }
  add(new THREE.BoxGeometry(2.7, 0.55, 1.75), mat("#f1ede6", 0.15, 0.5), [0, 1.25, 0]);                 // body
  add(new THREE.BoxGeometry(2.3, 0.08, 1.55), mat("#c9a14a", 0.8, 0.3), [0.1, 1.56, 0]);                // gold deck
  add(new THREE.CylinderGeometry(0.28, 0.28, 0.9, 12), mat("#3a3a3a", 0.5, 0.5), [-1.55, 1.45, 0], [0, 0, 0.7]);   // power source
  add(new THREE.CylinderGeometry(0.04, 0.04, 0.3), mat("#888888"), [-0.6, 1.8, -0.55]);                 // dish stem
  add(new THREE.CylinderGeometry(0.36, 0.36, 0.04, 24), mat("#d8d8d8", 0.5), [-0.6, 2.0, -0.55], [0.5, 0, 0.3]);  // high-gain dish
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.8), mat("#bbbbbb"), [-0.9, 2.0, 0.6]);                   // low-gain antenna
  add(new THREE.CylinderGeometry(0.06, 0.07, 1.4), mat("#e5e5e5", 0.4), [0.95, 2.25, 0.55]);            // camera mast
  add(new THREE.BoxGeometry(0.32, 0.26, 0.6), mat("#f5f5f5"), [0.95, 3.0, 0.55]);                       // camera head
  const eye = new THREE.MeshStandardMaterial({ color: "#111111", emissive: "#204060", emissiveIntensity: 0.6 });
  for (const dz of [0.16, -0.16]) add(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 12), eye, [1.12, 3.0, 0.55 + dz], [0, 0, Math.PI / 2]);
  for (const dz of [0.5, -0.5]) add(new THREE.BoxGeometry(0.04, 0.12, 0.22), new THREE.MeshBasicMaterial({ color: "#fff6e0" }), [1.38, 1.2, dz]);
  return g;
}
export const MODELS: Record<ModelKey, Spec> = {
  // sizeM is the model's largest real dimension: length for vehicles, height for the suit.
  perseverance: { url: `${BASE}/models/perseverance.glb`, sizeM: 3.0, screenPx: 112, headingOffset: Math.PI, upright: false, label: "NASA Perseverance model" },
  sev: { url: `${BASE}/models/sev.glb`, sizeM: 4.5, screenPx: 124, headingOffset: Math.PI, upright: false, label: "NASA Space Exploration Vehicle concept model" },
  // The rover's own +x is forward, so it needs a quarter turn where the NASA files (forward along z) need a half turn.
  rover6: { url: "", sizeM: 3.4, screenPx: 124, headingOffset: Math.PI / 2, upright: false, label: "six-wheel rover model", build: buildSixWheelRover },
  z2_suit: { url: `${BASE}/models/z2_suit.glb`, sizeM: 1.9, screenPx: 116, headingOffset: Math.PI, upright: true, label: "NASA Z-2 spacesuit model" },
};
export const MODEL_FOR_MOVER: Record<string, ModelKey> = { scout: "perseverance", crew_rover: "rover6", astronaut: "z2_suit" };

const MAP_METRES_PER_MARS_METRE = 6371008.8 / 3396190; // the map engine's globe is Earth-sized

type Loaded = { scene: THREE.Scene; holder: THREE.Group; native: number };

export function createModelLayer(instances: { current: ModelInstance[] }, onLoaded: (model: ModelKey, ok: boolean) => void): CustomLayerInterface {
  const camera = new THREE.Camera();
  const loaded = new Map<ModelKey, Loaded | "loading" | "failed">();
  let renderer: THREE.WebGLRenderer | null = null;
  let map: MlMap | null = null;

  // Two of NASA's files are Draco-compressed; the decoder is served from /draco (copied from three.js).
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${BASE}/draco/`);
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(draco);

  const place = (key: ModelKey, object: THREE.Object3D) => {
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.7));
    const sun = new THREE.DirectionalLight(0xfff1e0, 2.4);
    sun.position.set(-0.6, 1, 0.4);
    scene.add(sun);
    const box = new THREE.Box3().setFromObject(object);
    const dim = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    object.position.set(-centre.x, -box.min.y, -centre.z);     // centred, standing on the ground
    const holder = new THREE.Group();
    holder.add(object);
    scene.add(holder);
    loaded.set(key, { scene, holder, native: (MODELS[key].upright ? dim.y : Math.max(dim.x, dim.z)) || 1 });
    onLoaded(key, true);
    map?.triggerRepaint();
  };

  const load = (key: ModelKey) => {
    const build = MODELS[key].build;
    if (build) { place(key, build()); return; }
    loaded.set(key, "loading");
    gltfLoader.load(MODELS[key].url, (gltf) => {
      place(key, gltf.scene);
    }, undefined, (err) => {
      console.warn(`3D model ${key} failed to load; the flat icon is shown instead.`, err);
      loaded.set(key, "failed");
      onLoaded(key, false);
    });
  };

  return {
    id: "nasa-models",
    type: "custom",
    renderingMode: "3d",
    onAdd(m: MlMap, gl: WebGLRenderingContext | WebGL2RenderingContext) {
      map = m;
      renderer = new THREE.WebGLRenderer({ canvas: m.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
    },
    render(_gl: WebGLRenderingContext | WebGL2RenderingContext, args: CustomRenderMethodInput) {
      if (!map || !renderer) return;
      const main = new THREE.Matrix4().fromArray(Array.from(args.defaultProjectionData.mainMatrix));
      for (const it of instances.current) {
        if (!it.visible) continue;
        const entry = loaded.get(it.model);
        if (entry === undefined) { load(it.model); continue; }   // models load only when first needed
        if (entry === "loading" || entry === "failed") continue;
        const spec = MODELS[it.model];
        const altitude = map.queryTerrainElevation([it.lon, it.lat]) ?? 0;
        const mapMetresPerPixel = (40075016.686 * Math.cos((it.lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
        const size = Math.max(spec.screenPx * mapMetresPerPixel, spec.sizeM * MAP_METRES_PER_MARS_METRE);
        const s = size / entry.native;
        entry.holder.rotation.y = spec.headingOffset - (it.headingDeg * Math.PI) / 180;
        const model = new THREE.Matrix4()
          .fromArray(Array.from(map.transform.getMatrixForModel([it.lon, it.lat], altitude)))
          .scale(new THREE.Vector3(s, s, s));
        camera.projectionMatrix = main.clone().multiply(model);
        renderer.resetState();
        renderer.render(entry.scene, camera);
      }
    },
    onRemove() {
      loaded.clear();
      renderer = null;
    },
  };
}
