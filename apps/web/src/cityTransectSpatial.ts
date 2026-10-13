import { probeCitySection } from './citySectionProbe';
import type { CitySectionProbe } from './citySectionProbe';
import { transectCoordinate } from './cityTransect';
import type { TerrainTransect } from './cityTransect';
import type { CityModel } from './cityModel';

export type TransectProbe = Omit<CitySectionProbe, 'axis'>;
export function probeTerrainTransect(transect: TerrainTransect, distance: number): TransectProbe | null {
  // Reuse event precedence and candidate-height handling, then replace the
  // renderer's cardinal coordinates with the original arbitrary line frame.
  const result = probeCitySection({ ...transect.profile, axis: 'east_west' }, distance);
  if (!result) return null;
  const { axis: _axis, ...probe } = result;
  return { ...probe, ...transectCoordinate(transect, distance) };
}

export function transectProbePosition(probe: TransectProbe | null, originHeight: number): [number, number, number] | null {
  if (!probe || probe.status !== 'unique' || probe.elevations.length !== 1) return null;
  const p: [number, number, number] = [probe.east, probe.elevations[0] - originHeight, -probe.north];
  return p.every(Number.isFinite) ? p : null;
}

export type TransectOverlay = { length: number; segments: number[]; points: number[]; ambiguousPoints: number; bounds: CityModel['bounds'] | null };
export function transectOverlayData(transect: TerrainTransect, originHeight: number): TransectOverlay {
  const position = (d: number, h: number) => { const p = transectCoordinate(transect, d); return [p.east, h - originHeight, -p.north]; };
  const segments = transect.profile.intervals.filter(v => v.status === 'unique').flatMap(v => [...position(v.from, v.curves[0].from), ...position(v.to, v.curves[0].to)]);
  const points = transect.profile.points.filter(p => p.status === 'unique').flatMap(p => position(p.distance, p.elevations[0]));
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const values of [segments, points]) for (let i = 0; i < values.length; i += 3) for (let j = 0; j < 3; j++) {
    if (!Number.isFinite(values[i + j])) throw new Error('指定線の描画座標が有限値ではありません');
    min[j] = Math.min(min[j], values[i + j]); max[j] = Math.max(max[j], values[i + j]);
  }
  return { length: transect.profile.length, segments, points, ambiguousPoints: transect.profile.points.filter(p => p.status === 'ambiguous').length, bounds: segments.length || points.length ? { min, max } : null };
}
