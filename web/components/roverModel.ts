// NASA 3D models on the map, drawn with three.js as a MapLibre custom layer.
//
// Every mover has a NASA model (credit NASA / NASA/JPL-Caltech):
//   scout rover  -> "Mars Perseverance Rover, 3D Model"
//   crew rover   -> "Space Exploration Vehicle", NASA's crewed surface rover concept
//   astronaut    -> "Z2 Spacesuit", NASA's prototype planetary surface suit
// Models are enlarged so they can be seen from a distance: each keeps a fixed size on screen
// until the view is close enough for it to be shown at true size.

import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from "maplibre-gl";
import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export type ModelKey = "perseverance" | "sev" | "z2_suit";
export type ModelInstance = { model: ModelKey; lon: number; lat: number; headingDeg: number; visible: boolean };

type Spec = { url: string; sizeM: number; screenPx: number; headingOffset: number; upright: boolean; label: string };
export const MODELS: Record<ModelKey, Spec> = {
  // sizeM is the model's largest real dimension: length for vehicles, height for the suit.
  perseverance: { url: "/models/perseverance.glb", sizeM: 3.0, screenPx: 112, headingOffset: Math.PI, upright: false, label: "NASA Perseverance model" },
  sev: { url: "/models/sev.glb", sizeM: 4.5, screenPx: 124, headingOffset: Math.PI, upright: false, label: "NASA Space Exploration Vehicle concept model" },
  z2_suit: { url: "/models/z2_suit.glb", sizeM: 1.9, screenPx: 116, headingOffset: Math.PI, upright: true, label: "NASA Z-2 spacesuit model" },
};
export const MODEL_FOR_MOVER: Record<string, ModelKey> = { scout: "perseverance", crew_rover: "sev", astronaut: "z2_suit" };

const MAP_METRES_PER_MARS_METRE = 6371008.8 / 3396190; // the map engine's globe is Earth-sized

type Loaded = { scene: THREE.Scene; holder: THREE.Group; native: number };

export function createModelLayer(instances: { current: ModelInstance[] }, onLoaded: (model: ModelKey, ok: boolean) => void): CustomLayerInterface {
  const camera = new THREE.Camera();
  const loaded = new Map<ModelKey, Loaded | "loading" | "failed">();
  let renderer: THREE.WebGLRenderer | null = null;
  let map: MlMap | null = null;

  // Two of NASA's files are Draco-compressed; the decoder is served from /draco (copied from three.js).
  const draco = new DRACOLoader();
  draco.setDecoderPath("/draco/");
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(draco);

  const load = (key: ModelKey) => {
    loaded.set(key, "loading");
    gltfLoader.load(MODELS[key].url, (gltf) => {
      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 1.7));
      const sun = new THREE.DirectionalLight(0xfff1e0, 2.4);
      sun.position.set(-0.6, 1, 0.4);
      scene.add(sun);
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const dim = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      gltf.scene.position.set(-centre.x, -box.min.y, -centre.z);     // centred, standing on the ground
      const holder = new THREE.Group();
      holder.add(gltf.scene);
      scene.add(holder);
      loaded.set(key, { scene, holder, native: (MODELS[key].upright ? dim.y : Math.max(dim.x, dim.z)) || 1 });
      onLoaded(key, true);
      map?.triggerRepaint();
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
