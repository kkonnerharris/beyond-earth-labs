// The two services, for the shared copy that has no server.
//
// Mission service: the real one, compiled from the same Go code to WebAssembly (mission/cmd/missiond,
// built with GOOS=js GOARCH=wasm). It is started in the page, handed the terrain files once, and then
// answers each request through the same routes the server uses. Routes, supply checks, the habitat
// budget, the traverse simulation, emergencies and the score are all computed by it, in the browser.
//
// Science service: its answers were saved as files when the copy was built (scripts/build_pages_app.py).
// What cannot be saved ahead of time is refused with a plain message: the 1 m elevation check and the
// rover camera frames, which read NASA's servers live.

import { BASE } from "./base";

type GoRuntime = { importObject: WebAssembly.Imports; run: (instance: WebAssembly.Instance) => Promise<void> };
declare global {
  interface Window {
    Go?: new () => GoRuntime;
    belMissionInit?: (meta: string, bin: Uint8Array) => string;
    belMissionRequest?: (method: string, path: string, body: string) => { status: number; body: string };
  }
}

let booting: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.appendChild(s);
  });
}

/** Start the mission service in the page (once) and hand it the Jezero terrain. */
function boot(): Promise<void> {
  if (booting) return booting;
  booting = (async () => {
    await loadScript(`${BASE}/wasm_exec.js`);
    const go = new window.Go!();
    const [wasm, meta, bin] = await Promise.all([
      fetch(`${BASE}/mission.wasm`).then((r) => { if (!r.ok) throw new Error("the mission service file did not load"); return r.arrayBuffer(); }),
      fetch(`${BASE}/svc/terrain/terrain.json`).then((r) => { if (!r.ok) throw new Error("the terrain description did not load"); return r.text(); }),
      fetch(`${BASE}/svc/terrain/terrain.bin`).then((r) => { if (!r.ok) throw new Error("the terrain layers did not load"); return r.arrayBuffer(); }),
    ]);
    const { instance } = await WebAssembly.instantiate(wasm, go.importObject);
    void go.run(instance);                       // runs until the page closes
    for (let i = 0; i < 200 && !window.belMissionInit; i++) await new Promise((r) => setTimeout(r, 10));
    if (!window.belMissionInit) throw new Error("the mission service did not start in this browser");
    const problem = window.belMissionInit(meta, new Uint8Array(bin));
    if (problem) throw new Error(`the mission service could not read the terrain: ${problem}`);
  })();
  booting.catch(() => { booting = null; });
  return booting;
}

const safe = (s: string | null) => (s ?? "").replace(/[^a-zA-Z0-9_-]/g, "_");
const NOT_HERE = "This part reads NASA's servers live through the science service, which the shared copy does not have. Run the app from the repository to use it.";

/** The saved file that answers a science request, or an answer given directly. */
function scienceAnswer(path: string): { file: string } | { value: unknown } {
  const u = new URL(path, "http://shared.copy");
  const p = u.pathname, q = u.searchParams;
  if (p === "/regions") return { file: `/regions/${safe(q.get("body"))}.json` };
  if (p === "/analogs") return { file: `/analogs/${safe(q.get("region"))}__${safe(q.get("target")) || "default"}.json` };
  if (p === "/earth/climate") return { file: `/earth/climate/${safe(q.get("region"))}.json` };
  if (p === "/jezero/views") return { value: { available: false, reason: NOT_HERE } };
  return { file: `${p}.json` };
}

export async function staticRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
  if (path.startsWith("/svc/mission")) {
    await boot();
    const res = window.belMissionRequest!(init?.method ?? "GET", "/api" + path.slice("/svc/mission".length), typeof init?.body === "string" ? init.body : "");
    let body: unknown = null;
    try { body = res.body ? JSON.parse(res.body) : null; } catch { /* not JSON */ }
    if (res.status >= 400) {
      const b = body as { error?: string; mission?: unknown } | null;
      const message = (b?.error ?? `the mission service answered ${res.status}`)
        .replace("the science service is not connected", "it reads NASA's 1 m file live through the science service, which the shared copy does not have");
      const err = new Error(message) as Error & { mission?: unknown };
      if (b?.mission) err.mission = b.mission;
      throw err;
    }
    return body as T;
  }
  const answer = scienceAnswer(path.slice("/svc/science".length));
  if ("value" in answer) return answer.value as T;
  const res = await fetch(`${BASE}/svc/science${answer.file}`);
  if (!res.ok) throw new Error(NOT_HERE);
  return (await res.json()) as T;
}
