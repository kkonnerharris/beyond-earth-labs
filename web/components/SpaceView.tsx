"use client";

// The solar system, with Earth, the Moon and Mars picked out. Click one of those three to open its map.
//
// What is real: each planet's direction from the Sun today, from its mean orbital motion
// (circular-orbit approximation), and the NASA imagery on Earth, the Moon and Mars.
// What is not: orbit spacing and planet sizes are drawn for legibility, the other planets are
// plain colours, and the stars are generated.

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { Body } from "@/lib/api";

type Planet = {
  key: string; name: string; orbit: number; size: number; colour: number;
  L0: number; rate: number;          // mean longitude at J2000 (degrees) and its rate (degrees per Julian century)
  body?: Body; ring?: boolean; fact: string;
};
// Mean longitudes and rates after JPL's "Approximate Positions of the Planets". Entered from memory: verify.
const PLANETS: Planet[] = [
  { key: "mercury", name: "Mercury", orbit: 2.2, size: 0.17, colour: 0x8c8680, L0: 252.25, rate: 149472.67, fact: "0.39 au" },
  { key: "venus", name: "Venus", orbit: 3.5, size: 0.32, colour: 0xd9b77a, L0: 181.98, rate: 58517.82, fact: "0.72 au" },
  { key: "earth", name: "Earth", orbit: 5.2, size: 0.52, colour: 0x3a6ea5, L0: 100.46, rate: 35999.37, body: "earth", fact: "1 au · where missions are rehearsed" },
  { key: "mars", name: "Mars", orbit: 7.1, size: 0.44, colour: 0xb5582c, L0: 355.45, rate: 19140.30, body: "mars", fact: "1.52 au · the mission: Jezero Crater" },
  { key: "jupiter", name: "Jupiter", orbit: 9.3, size: 0.8, colour: 0xc9a47e, L0: 34.40, rate: 3034.75, fact: "5.2 au" },
  { key: "saturn", name: "Saturn", orbit: 11.3, size: 0.66, colour: 0xd8c08a, L0: 49.95, rate: 1222.49, ring: true, fact: "9.6 au" },
  { key: "uranus", name: "Uranus", orbit: 12.9, size: 0.48, colour: 0x9fd3d6, L0: 313.24, rate: 428.48, fact: "19 au" },
  { key: "neptune", name: "Neptune", orbit: 14.3, size: 0.46, colour: 0x4f6fd6, L0: 304.88, rate: 218.46, fact: "30 au" },
];
const MOON = { orbit: 1.15, size: 0.17 };

function centuriesSinceJ2000(d: Date): number {
  return (d.getTime() / 86400000 + 2440587.5 - 2451545.0) / 36525;
}

export default function SpaceView({ counts, onPick, onClose }: {
  counts: Record<Body, number>; onPick: (body: Body) => void; onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<Record<string, HTMLElement | null>>({});
  const [failed, setFailed] = useState<string[]>([]);
  const pick = useRef(onPick);
  pick.current = onPick;
  const today = useRef(new Date());

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 600);
    const disposables: { dispose: () => void }[] = [];

    // Generated star field.
    const starPos = new Float32Array(2600 * 3);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < 2600; i++) {
      const u = rnd() * 2 - 1, t = rnd() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      starPos.set([220 * r * Math.cos(t), 220 * u, 220 * r * Math.sin(t)], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xcfd8e6, size: 0.7, transparent: true, opacity: 0.75 });
    scene.add(new THREE.Points(starGeo, starMat));
    disposables.push(starGeo, starMat);

    // The Sun lights everything from the centre.
    const sunGeo = new THREE.SphereGeometry(0.95, 48, 32);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffd98a });
    scene.add(new THREE.Mesh(sunGeo, sunMat));
    scene.add(new THREE.PointLight(0xfff4e0, 260, 0, 1.6));
    scene.add(new THREE.AmbientLight(0xffffff, 0.22));
    disposables.push(sunGeo, sunMat);

    const loader = new THREE.TextureLoader();
    const texture = (body: Body, name: string) => {
      const tex = loader.load(`/svc/science/globe/${body}.jpg`, () => undefined, undefined, () => setFailed((f) => [...f, name]));
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      disposables.push(tex);
      return tex;
    };

    const T = centuriesSinceJ2000(today.current);
    const anchors: { key: string; obj: THREE.Object3D; drop: number }[] = [];
    const clickable: THREE.Mesh[] = [];
    const spinning: THREE.Mesh[] = [];
    for (const p of PLANETS) {
      const picked = !!p.body;
      const ringGeo = new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 181 }, (_, i) => new THREE.Vector3(p.orbit * Math.cos((i / 180) * 2 * Math.PI), 0, p.orbit * Math.sin((i / 180) * 2 * Math.PI))));
      const ringMat = new THREE.LineBasicMaterial({ color: picked ? 0x7f93aa : 0x2c3c4f, transparent: true, opacity: picked ? 0.9 : 0.7 });
      scene.add(new THREE.Line(ringGeo, ringMat));
      disposables.push(ringGeo, ringMat);

      const angle = (((p.L0 + p.rate * T) % 360) * Math.PI) / 180;       // heliocentric longitude today
      const geo = new THREE.SphereGeometry(p.size, 64, 40);
      const mat = new THREE.MeshStandardMaterial(p.body ? { map: texture(p.body, p.name), roughness: 1 } : { color: p.colour, roughness: 1 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(p.orbit * Math.cos(angle), 0, -p.orbit * Math.sin(angle));
      mesh.userData = { body: p.body };
      scene.add(mesh);
      disposables.push(geo, mat);
      spinning.push(mesh);
      anchors.push({ key: p.key, obj: mesh, drop: p.size + 0.12 });
      if (p.body) clickable.push(mesh);
      if (p.ring) {
        const rg = new THREE.RingGeometry(p.size * 1.35, p.size * 2.1, 64);
        const rm = new THREE.MeshBasicMaterial({ color: 0xcdb98a, side: THREE.DoubleSide, transparent: true, opacity: 0.55 });
        const ring = new THREE.Mesh(rg, rm);
        ring.rotation.x = Math.PI / 2 - 0.45;
        mesh.add(ring);
        disposables.push(rg, rm);
      }
      if (p.key === "earth") {                         // the Moon rides with Earth
        const mg = new THREE.SphereGeometry(MOON.size, 48, 32);
        const mm = new THREE.MeshStandardMaterial({ map: texture("moon", "Moon"), roughness: 1 });
        const moon = new THREE.Mesh(mg, mm);
        moon.position.set(mesh.position.x + MOON.orbit * 0.8, 0.05, mesh.position.z - MOON.orbit * 0.6);
        moon.userData = { body: "moon" };
        scene.add(moon);
        disposables.push(mg, mm);
        spinning.push(moon);
        clickable.push(moon);
        anchors.push({ key: "moon", obj: moon, drop: -(MOON.size + 0.62) });
      }
    }

    const resize = () => {
      const { clientWidth: W, clientHeight: H } = el;
      renderer.setSize(W, H);
      camera.aspect = W / H;
      const fov = (camera.fov * Math.PI) / 180;
      const reach = 15.3;                                // just outside Neptune's ring
      const dist = Math.max(reach / Math.tan(fov / 2) / camera.aspect, (reach * 0.72) / Math.tan(fov / 2)) * 1.02;
      camera.position.set(0, dist * 0.62, dist * 0.78);  // looking down on the orbits at an angle
      camera.lookAt(0, -0.6, 0);
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    const ray = new THREE.Raycaster();
    const hit = (e: MouseEvent): Body | null => {
      const b = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1), camera);
      const h = ray.intersectObjects(clickable)[0];
      return h ? (h.object.userData.body as Body) : null;
    };
    const onMove = (e: MouseEvent) => { renderer.domElement.style.cursor = hit(e) ? "pointer" : "default"; };
    const onClick = (e: MouseEvent) => { const b = hit(e); if (b) pick.current(b); };
    renderer.domElement.addEventListener("mousemove", onMove);
    renderer.domElement.addEventListener("click", onClick);

    let raf = 0, last = performance.now();
    const v = new THREE.Vector3();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!still) for (const m of spinning) m.rotation.y += dt * 0.25;
      renderer.render(scene, camera);
      for (const a of anchors) {                         // keep each label beside its planet
        const node = labels.current[a.key];
        if (!node) continue;
        a.obj.getWorldPosition(v);
        v.y -= a.drop;
        v.project(camera);
        node.style.transform = `translate(-50%, 0) translate(${((v.x + 1) / 2) * el.clientWidth}px, ${((1 - v.y) / 2) * el.clientHeight}px)`;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("mousemove", onMove);
      renderer.domElement.removeEventListener("click", onClick);
      for (const d of disposables) d.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  const picks: { key: string; name: string; body: Body; line: string }[] = [
    { key: "earth", name: "Earth", body: "earth", line: `${counts.earth} test sites measured` },
    { key: "moon", name: "Moon", body: "moon", line: `${counts.moon} regions measured` },
    { key: "mars", name: "Mars", body: "mars", line: `${counts.mars} regions · the mission` },
  ];
  return (
    <div className="fixed inset-x-0 bottom-0 top-12 z-40 bg-black" role="dialog" aria-label="The solar system, with Earth, the Moon and Mars highlighted">
      <div ref={host} className="absolute inset-0" />
      <div className="pointer-events-none absolute left-6 top-5 max-w-[440px]">
        <p className="label text-mars-soft">The solar system today</p>
        <h2 className="mt-1.5 text-[26px] font-semibold leading-tight text-text">Learn on Earth. Adapt on Mars.</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Three worlds, one terrain model. Choose Earth, the Moon or Mars to open its map.
        </p>
        <p className="num mt-2 text-[11.5px] text-faint">{today.current.toISOString().slice(0, 10)}</p>
      </div>
      <button className="btn absolute right-5 top-5 bg-panel/90" onClick={onClose}>Back to the map</button>

      {PLANETS.filter((p) => !p.body).map((p) => (
        <span key={p.key} ref={(n) => { labels.current[p.key] = n; }} className="pointer-events-none absolute left-0 top-0 whitespace-nowrap text-center text-[11px] leading-tight text-muted">
          {p.name}<span className="num block text-[10px] text-faint">{p.fact}</span>
        </span>
      ))}
      {picks.map((w) => (
        <button key={w.key} ref={(n) => { labels.current[w.key] = n; }} onClick={() => onPick(w.body)} title={`Open the ${w.name} map`}
                className="absolute left-0 top-0 whitespace-nowrap rounded-full border border-mars/70 bg-panel/90 px-2 py-[1px] text-[11.5px] font-semibold text-text transition-colors hover:border-mars hover:bg-mars/20 focus-visible:border-signal">
          {w.name}
        </button>
      ))}
      <ul className="absolute left-6 top-[188px] flex flex-col gap-1.5">
        {picks.map((w) => (
          <li key={w.key}>
            <button onClick={() => onPick(w.body)} className="flex items-baseline gap-2 rounded-md border border-line-strong bg-panel/80 px-2.5 py-1.5 text-left transition-colors hover:border-mars">
              <span className="w-12 text-[13px] font-semibold text-text">{w.name}</span>
              <span className="text-[11.5px] text-muted">{w.line}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="pointer-events-none absolute bottom-4 left-6 right-6 text-[11px] leading-snug text-faint">
        Each planet is shown in its direction from the Sun today, from its mean orbital motion; because real orbits are not perfect circles this can be off by about ten degrees for Mars and more for Mercury. Orbit spacing and planet sizes are not to scale. Earth, the Moon and Mars carry NASA imagery (Blue Marble, LROC Wide Angle Camera, Viking Orbiters); the other planets are plain colours and the stars are generated.
        {failed.length > 0 && <span className="text-warn"> NASA imagery did not load for: {failed.join(", ")}.</span>}
      </p>
    </div>
  );
}
