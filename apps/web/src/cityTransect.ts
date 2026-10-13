import type { CityModel, CityFeature } from './cityModel';
import { traceTerrainSection } from './citySections';
import type { TerrainSection } from './citySections';

export type TransectLine = { start: { east: number; north: number }; end: { east: number; north: number } };
export type TerrainTransect = {
  line: TransectLine; unit_direction: { east: number; north: number };
  profile: Omit<TerrainSection, 'axis'>;
};

export function traceTerrainTransect(model: CityModel, line: TransectLine): TerrainTransect {
  const { start, end } = line;
  if (![start.east, start.north, end.east, end.north].every(Number.isFinite)) throw new Error('指定線の座標には有限値が必要です');
  for (const p of [start, end]) if (p.east < model.bounds.min[0] || p.east > model.bounds.max[0] || p.north < -model.bounds.max[2] || p.north > -model.bounds.min[2]) throw new Error('指定線の両端をモデルの水平範囲内に置いてください');
  const de = end.east - start.east, dn = end.north - start.north, length = Math.hypot(de, dn);
  if (length < 1e-6 || length > 5000) throw new Error('指定線の長さは0.000001〜5000mが必要です');
  const east = de / length, north = dn / length;
  const ce = start.east + de / 2, cn = start.north + dn / 2;
  const sourceVerticalFaces = new Map<CityFeature, ReadonlySet<number>>();
  // Temporary rigid horizontal frame. Original source heights and IDs remain
  // unchanged; the original model is never modified or persisted in this frame.
  const features = model.features.filter(f => f.layer === 'terrain').map(f => {
    const positions = f.positions.slice();
    const vertical = new Set<number>();
    for (let i = 0; i < positions.length; i += 9) {
      const p = f.positions;
      const determinant = (p[i + 3] - p[i]) * (p[i + 8] - p[i + 2]) - (p[i + 5] - p[i + 2]) * (p[i + 6] - p[i]);
      if (Math.abs(determinant) < 1e-12) vertical.add(i);
    }
    for (let i = 0; i < positions.length; i += 3) {
      const e = f.positions[i] - ce, n = -f.positions[i + 2] - cn;
      positions[i] = e * east + n * north;
      positions[i + 2] = e * north - n * east;
    }
    const projected = { ...f, positions };
    sourceVerticalFaces.set(projected, vertical);
    return projected;
  });
  // Rigid rotation can introduce a nonzero determinant for a source vertical
  // face. Keep its original classification even when intersections differ by
  // a few ulps; do not turn the resulting microscopic span into ground.
  const { axis: _axis, ...profile } = traceTerrainSection({ ...model, features }, { east: 0, north: 0, width: length, length: 1, elevation: 0 }, 'east_west', sourceVerticalFaces);
  profile.start = { ...start }; profile.end = { ...end };
  return { line: structuredClone(line), unit_direction: { east, north }, profile };
}

export function transectCoordinate(transect: TerrainTransect, distance: number) {
  if (!Number.isFinite(distance) || distance < 0 || distance > transect.profile.length) throw new Error('指定線の距離が範囲外です');
  const { start, end } = transect.line;
  if (distance === 0) return { ...start };
  if (distance === transect.profile.length) return { ...end };
  const f = distance / transect.profile.length;
  return { east: start.east + (end.east - start.east) * f, north: start.north + (end.north - start.north) * f };
}
