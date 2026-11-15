// Small geometry helpers for drawing. Mission values still come from the services.

const D2R = Math.PI / 180;

/** Inverse spherical Lambert azimuthal equal-area: local metres to [lon, lat] degrees. */
export function laeaInverse(x: number, y: number, lat0: number, lon0: number, radius: number): [number, number] {
  const rho = Math.hypot(x, y);
  if (rho < 1e-9) return [lon0, lat0];
  const c = 2 * Math.asin(Math.min(1, rho / (2 * radius)));
  const sinC = Math.sin(c), cosC = Math.cos(c);
  const p0 = lat0 * D2R;
  const lat = Math.asin(cosC * Math.sin(p0) + (y * sinC * Math.cos(p0)) / rho);
  const lon = lon0 * D2R + Math.atan2(x * sinC, rho * Math.cos(p0) * cosC - y * Math.sin(p0) * sinC);
  return [lon / D2R, lat / D2R];
}

/** A circle of `radiusM` metres around a local point, as a closed [lon, lat] ring. */
export function circleRing(x: number, y: number, radiusM: number, lat0: number, lon0: number, bodyRadius: number, steps = 48) {
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push(laeaInverse(x + radiusM * Math.cos(a), y + radiusM * Math.sin(a), lat0, lon0, bodyRadius));
  }
  return ring;
}

/** Ground metres per screen pixel for a Web Mercator map of a body with the given radius. */
export function metresPerPixel(latDeg: number, zoom: number, bodyRadius: number): number {
  return (2 * Math.PI * bodyRadius * Math.cos(latDeg * D2R)) / (512 * Math.pow(2, zoom));
}

/** Pick a round scale-bar length that fits within maxPx pixels. */
export function niceScale(mPerPx: number, maxPx = 120): { metres: number; px: number; label: string } {
  const max = mPerPx * maxPx;
  const pow = Math.pow(10, Math.floor(Math.log10(max)));
  const metres = [5, 2, 1].map((k) => k * pow).find((v) => v <= max) ?? pow;
  const label = metres >= 1000 ? `${metres / 1000} km` : `${metres} m`;
  return { metres, px: metres / mPerPx, label };
}

export function fmtDuration(seconds: number): string {
  if (!isFinite(seconds)) return "–";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h >= 48) return `${(s / 88775).toFixed(1)} sols`;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  return `${m} min ${String(s % 60).padStart(2, "0")} s`;
}

export function fmtDistance(m: number): string {
  if (!isFinite(m)) return "–";
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`;
}

export function fmtEnergy(joules: number): string {
  const wh = joules / 3600;
  return wh >= 1000 ? `${(wh / 1000).toFixed(2)} kWh` : `${wh.toFixed(0)} Wh`;
}

export function resourceLabel(resource: string): { name: string; unit: string; digits: number } {
  return resource === "oxygen_kg"
    ? { name: "Suit oxygen", unit: "kg", digits: 3 }
    : { name: "Battery", unit: "Wh", digits: 0 };
}
