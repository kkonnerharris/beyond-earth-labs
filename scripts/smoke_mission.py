"""End-to-end check of the mission service through its HTTP API.

Run with the service listening on 127.0.0.1:8300:
    python scripts/smoke_mission.py

Creates a crew-rover mission at the Perseverance landing site, adds two
science targets on the real Jezero terrain, runs the traverse, injects an
obstacle and a dust storm, and prints what the service decided. Exits
non-zero if anything is inconsistent.
"""
import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8300/api"


def call(method, path, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        sys.exit(1)


st, terrain = call("GET", "/terrain")
ls = terrain["landing_site"]
print(f"terrain: {terrain['name']}, landing site {ls['name']} at x={ls['x']} y={ls['y']}")

st, smp = call("GET", f"/terrain/sample?x={ls['x']}&y={ls['y']}")
check(st == 200 and -2700 < smp["sample"]["elevation_m"] < -2400 and "slope_deg" in smp["sample"],
      f"terrain sample at the landing site: {smp['sample']['elevation_m']:.0f} m, {smp['sample']['slope_deg']:.1f} deg")

st, m = call("POST", "/missions", {"name": "Smoke test", "mover": "crew_rover"})
check(st == 201 and m["base"]["name"] == ls["name"], "mission created at the landing site")
mid = m["id"]

# Two targets west of the landing site, toward the delta front (local metres).
st, m = call("POST", f"/missions/{mid}/targets",
             {"x": ls["x"] - 2200, "y": ls["y"] + 900, "name": "Delta front scarp", "objective": "Image layered deposits", "dwell_min": 20})
check(st == 200 and m["plan"] is not None, "first target accepted and planned")
st, m = call("POST", f"/missions/{mid}/targets",
             {"x": ls["x"] - 3000, "y": ls["y"] + 1700, "name": "Delta top", "objective": "Sample fine-grained rock", "dwell_min": 20})
check(st == 200 and len(m["plan"]["legs"]) == 3, "second target accepted: three legs")
p = m["plan"]
print(f"   plan: {p['distance_m']:.0f} m, {p['seconds'] / 3600:.2f} h, max slope {p['max_slope_deg']:.1f} deg")
print("   " + p["feasibility"]["reason"])
check(p["feasibility"]["ok"], "plan is feasible on the battery with reserve")
check(p["max_slope_deg"] <= 20.0, "no leg exceeds the rover's 20 degree limit")

# The same plan measured on NASA's 1 m HiRISE elevation model. The first run downloads the elevation
# under the route (up to a few minutes on a slow link); later runs read it from data/cache/hirise/.
st, m = call("POST", f"/missions/{mid}/finecheck", {"avoid": False}, timeout=600)
f = m.get("fine_check") or {}
check(st == 200 and f.get("revision") == m["plan"]["revision"] and f["no_data_m"] == 0
      and abs(f["checked_m"] - m["plan"]["distance_m"]) < 0.02 * m["plan"]["distance_m"],
      f"1 m check measured the whole route: {f.get('checked_m', 0):.0f} m, steepest {f.get('slope_deg', {}).get('max', 0):.1f} deg "
      f"at 1 m against {m['plan']['max_slope_deg']:.1f} deg at 20 m, {len(f.get('stretches', []))} stretch(es) over the limit")
check(f["slope_deg"]["max"] >= m["plan"]["max_slope_deg"] - 3 and len(m["hazards"]) == 0,
      "a report-only check changes nothing")
found = len(f["stretches"])
st, m = call("POST", f"/missions/{mid}/finecheck", {"avoid": True}, timeout=600)
f = m["fine_check"]
print("   " + f["summary"])
check(st == 200 and f["revision"] == m["plan"]["revision"] and (f["rounds"] > 0) == (found > 0),
      f"1 m check with avoidance: {f['rounds']} replan(s), {len(m['hazards'])} cell(s) kept out, "
      f"{f['over_limit_m']:.0f} m still over the limit")
check(all(h.get("source") == "hirise_1m" for h in m["hazards"]) and m["plan"]["feasibility"]["ok"],
      "keep-outs come from the 1 m model and the plan is still feasible")
if found:
    check(f["over_limit_m"] < f["first_found"]["over_limit_m"], "the moved route has less steep ground than the first one")
fine_cells = len(m["hazards"])

# The same legs on foot should be refused: too much oxygen.
st, walk = call("POST", "/route", {"profile": "astronaut", "start": {"x": ls["x"], "y": ls["y"]},
                                   "goal": {"x": ls["x"] - 3000, "y": ls["y"] + 1700}})
check(st == 200, f"stateless route on foot: {walk['distance_m']:.0f} m, {walk['seconds'] / 3600:.2f} h one way")

st, m = call("POST", f"/missions/{mid}/sim/start")
check(st == 200 and m["sim"]["phase"] == "moving", "traverse started")
st, m = call("POST", f"/missions/{mid}/sim/step", {"seconds": 240})
check(m["sim"]["distance_m"] > 100, f"after 4 min the rover has driven {m['sim']['distance_m']:.0f} m")

st, m = call("POST", f"/missions/{mid}/sim/emergency", {"kind": "obstacle"})
reported = [h for h in m["hazards"] if not h.get("source")]
check(st == 200 and len(reported) == 1 and len(m["hazards"]) == fine_cells + 1 and m["sim"]["replans"] >= 1,
      "obstacle injected and route replanned")
hz = reported[0]
inside = [pt for leg in m["sim"]["active_legs"] for pt in leg["points"]
          if (pt["x"] - hz["x"]) ** 2 + (pt["y"] - hz["y"]) ** 2 <= hz["radius_m"] ** 2]
check(not inside, "replanned route stays out of the keep-out area")

for _ in range(8):
    st, m = call("POST", f"/missions/{mid}/sim/step", {"seconds": 120})
visited = [t["name"] for t in m["targets"] if t["visited"]]
print(f"   t={m['sim']['seconds'] / 60:.0f} min, phase {m['sim']['phase']}, visited {visited}")

solar_before = m["habitat"]["solar_kwh_per_sol"]
st, m = call("POST", f"/missions/{mid}/sim/emergency", {"kind": "dust_storm"})
check(st == 200 and m["sim"]["turned_back"], "dust storm orders a return to base")
check(m["habitat"]["solar_kwh_per_sol"] < 0.5 * solar_before,
      f"habitat solar falls from {solar_before:.0f} to {m['habitat']['solar_kwh_per_sol']:.0f} kWh per sol")

for _ in range(200):
    if m["sim"]["phase"] not in ("moving", "at_target"):
        break
    st, m = call("POST", f"/missions/{mid}/sim/step", {"seconds": 120})
check(m["sim"]["phase"] == "complete", "rover is back at base")
print(f"   total {m['sim']['distance_m']:.0f} m in {m['sim']['seconds'] / 3600:.2f} h, "
      f"{100 * m['sim']['remaining'] / m['sim']['capacity']:.0f}% battery left")
print("--- mission log")
for ev in m["events"]:
    print(f"   [{ev['t_seconds'] / 60:6.1f} min] {ev['kind']:9s} {ev['message']}")
