import type { CityModel } from './cityModel';

export type GroundSample = {
  east: number; north: number; status: 'unique' | 'uncovered' | 'ambiguous' | 'invalid';
  elevations: number[]; features: string[];
};
// Display-coordinate inspection only. Keep source double precision; exclude
// roofs/roads, and never extrapolate across missing terrain or choose a layer.
export function sampleGround(model: CityModel, east: number, north: number): GroundSample {
  const result: GroundSample = { east, north, status: 'uncovered', elevations: [], features: [] };
  if (!Number.isFinite(east) || !Number.isFinite(north)) return { ...result, status: 'invalid' };
  const z = -north;
  let vertical = false;
  for (const feature of model.features.filter(f => f.layer === 'terrain')) {
    const p = feature.positions;
    for (let i = 0; i < p.length; i += 9) {
      const ax = p[i], az = p[i + 2], bx = p[i + 3], bz = p[i + 5], cx = p[i + 6], cz = p[i + 8];
      if (east < Math.min(ax, bx, cx) - 1e-8 || east > Math.max(ax, bx, cx) + 1e-8 ||
          z < Math.min(az, bz, cz) - 1e-8 || z > Math.max(az, bz, cz) + 1e-8) continue;
      const det = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
      if (Math.abs(det) < 1e-12) {
        // A vertical face is not a single-valued ground height at its projection.
        const onEdge = [[ax, az, bx, bz], [bx, bz, cx, cz], [cx, cz, ax, az]].some(([x1, z1, x2, z2]) => {
          const length = Math.hypot(x2 - x1, z2 - z1);
          if (length < 1e-12) return Math.hypot(east - x1, z - z1) <= 1e-8;
          const t = ((east - x1) * (x2 - x1) + (z - z1) * (z2 - z1)) / (length * length);
          return t >= 0 && t <= 1 && Math.abs((east - x1) * (z2 - z1) - (z - z1) * (x2 - x1)) / length <= 1e-8;
        });
        if (onEdge) { vertical = true; if (!result.features.includes(feature.id)) result.features.push(feature.id); }
        continue;
      }
      const u = ((east - ax) * (cz - az) - (z - az) * (cx - ax)) / det;
      const v = ((bx - ax) * (z - az) - (bz - az) * (east - ax)) / det;
      if (u < -1e-10 || v < -1e-10 || u + v > 1 + 1e-10) continue;
      const height = model.origin[2] + p[i + 1] * (1 - u - v) + p[i + 4] * u + p[i + 7] * v;
      if (!result.elevations.some(h => Math.abs(h - height) <= 1e-6)) result.elevations.push(height);
      if (!result.features.includes(feature.id)) result.features.push(feature.id);
    }
  }
  result.elevations.sort((a, b) => a - b);
  result.status = vertical || result.elevations.length > 1 ? 'ambiguous' : result.elevations.length === 1 ? 'unique' : 'uncovered';
  return result;
}

export function footprintGround(model: CityModel, p: { east: number; north: number; width: number; length: number }) {
  if (![p.east, p.north, p.width, p.length].every(Number.isFinite) || p.width <= 0 || p.length <= 0) return [];
  return ([['中心', 0, 0], ['南西', -1, -1], ['南東', 1, -1], ['北東', 1, 1], ['北西', -1, 1]] as const)
    .map(([label, x, y]) => ({ label, ...sampleGround(model, p.east + x * p.width / 2, p.north + y * p.length / 2) }));
}
