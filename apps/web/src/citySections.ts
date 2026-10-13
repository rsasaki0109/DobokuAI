import type { CityModel, CityFeature } from './cityModel';
import type { CityFootprint } from './cityReport';

export type SectionStatus = 'unique' | 'uncovered' | 'ambiguous';
export type TerrainSection = {
  axis: 'east_west' | 'south_north'; length: number; start: { east: number; north: number }; end: { east: number; north: number };
  points: { distance: number; status: SectionStatus; elevations: number[]; features: string[] }[];
  intervals: { from: number; to: number; status: SectionStatus; curves: { from: number; to: number }[]; features: string[] }[];
};
type Cut = { from: number; to: number; h0: number; h1: number; vertical: boolean; feature: string };
const sameHeight = 1e-6;
const uniqueHeights = (values: number[]) => {
  const result: number[] = [];
  for (const v of values.sort((a, b) => a - b)) if (!result.length || v - result[result.length - 1] > sameHeight) result.push(v);
  return result;
};

// Geometry of display triangles, not a surveyed river section. Cut every face
// and sweep its exact boundaries; never join across missing or ambiguous spans.
export function traceTerrainSection(model: CityModel, p: CityFootprint, axis: TerrainSection['axis'], sourceVerticalFaces?: ReadonlyMap<CityFeature, ReadonlySet<number>>): TerrainSection {
  const length = axis === 'east_west' ? p.width : p.length;
  if (![p.east, p.north, length].every(Number.isFinite) || length < 1e-6 || length > 5000) throw new Error('断面長は0.000001〜5000mの有限値が必要です');
  const base = (axis === 'east_west' ? p.east : p.north) - length / 2;
  const fixed = axis === 'east_west' ? p.north : p.east;
  const events = new Map<number, { begin: Cut[]; end: Cut[]; touch: Cut[] }>();
  const event = (t: number) => { if (!events.has(t)) events.set(t, { begin: [], end: [], touch: [] }); return events.get(t)!; };
  event(0); event(length);
  let cuts = 0;
  for (const f of model.features.filter(f => f.layer === 'terrain')) {
    for (let i = 0; i < f.positions.length; i += 9) {
      // Tuples: variable horizontal coordinate, fixed coordinate, source height.
      const vertices = [0, 3, 6].map(j => {
        const e = f.positions[i + j], n = -f.positions[i + j + 2], h = model.origin[2] + f.positions[i + j + 1];
        return axis === 'east_west' ? [e, n, h] : [n, e, h];
      });
      if (fixed < Math.min(...vertices.map(v => v[1])) || fixed > Math.max(...vertices.map(v => v[1]))) continue;
      const hit: { t: number; h: number }[] = [];
      for (let j = 0; j < 3; j++) {
        let a = vertices[j], b = vertices[(j + 1) % 3];
        // Canonical ordering makes a shared edge's intersection independent of winding.
        if (a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))) [a, b] = [b, a];
        const da = a[1] - fixed, db = b[1] - fixed;
        if (da === 0) hit.push({ t: a[0] - base, h: a[2] });
        if (db === 0) hit.push({ t: b[0] - base, h: b[2] });
        if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
          const u = (fixed - a[1]) / (b[1] - a[1]);
          hit.push({ t: a[0] + (b[0] - a[0]) * u - base, h: a[2] + (b[2] - a[2]) * u });
        }
      }
      if (!hit.length) continue;
      hit.sort((a, b) => a.t - b.t);
      const left = hit[0], right = hit[hit.length - 1];
      const from = Math.max(0, left.t), to = Math.min(length, right.t);
      if (to < from) continue;
      if (++cuts > 4096) throw new Error('断面と交差する地形面が4096件を超えます。施工範囲を小さくしてください');
      const [a, b, c] = vertices;
      const det = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const vertical = sourceVerticalFaces?.get(f)?.has(i) || Math.abs(det) < 1e-12;
      const height = (t: number) => right.t === left.t ? left.h : left.h + (right.h - left.h) * (t - left.t) / (right.t - left.t);
      const cut: Cut = { from, to, h0: height(from), h1: height(to), vertical, feature: f.id };
      if (from === to) event(from).touch.push(cut);
      else { event(from).begin.push(cut); event(to).end.push(cut); }
    }
  }
  const section: TerrainSection = { axis, length,
    start: axis === 'east_west' ? { east: base, north: fixed } : { east: fixed, north: base },
    end: axis === 'east_west' ? { east: base + length, north: fixed } : { east: fixed, north: base + length }, points: [], intervals: [] };
  const distances = [...events.keys()].sort((a, b) => a - b);
  const active = new Set<Cut>();
  const height = (c: Cut, t: number) => c.from === c.to ? c.h0 : c.h0 + (c.h1 - c.h0) * (t - c.from) / (c.to - c.from);
  for (let i = 0; i < distances.length; i++) {
    const t = distances[i], e = events.get(t)!;
    const touching = new Set([...active, ...e.begin, ...e.touch]);
    if (touching.size > 64) throw new Error('断面位置に64面を超える地形が重なっています。断面の作成を中止しました');
    const heights = uniqueHeights([...touching].filter(c => !c.vertical).map(c => height(c, t)));
    section.points.push({ distance: t, status: [...touching].some(c => c.vertical) || heights.length > 1 ? 'ambiguous' : heights.length ? 'unique' : 'uncovered',
      elevations: heights, features: [...new Set([...touching].map(c => c.feature))] });
    for (const c of e.end) active.delete(c);
    for (const c of e.begin) active.add(c);
    const to = distances[i + 1];
    if (to === undefined) continue;
    if (active.size > 64) throw new Error('断面区間に64面を超える地形が重なっています。断面の作成を中止しました');
    const curves: { from: number; to: number }[] = [];
    for (const c of active) {
      if (c.vertical) continue;
      const curve = { from: height(c, t), to: height(c, to) };
      if (!curves.some(a => Math.abs(a.from - curve.from) <= sameHeight && Math.abs(a.to - curve.to) <= sameHeight)) curves.push(curve);
    }
    section.intervals.push({ from: t, to,
      status: [...active].some(c => c.vertical) || curves.length > 1 ? 'ambiguous' : curves.length ? 'unique' : 'uncovered',
      curves, features: [...new Set([...active].map(c => c.feature))] });
  }
  return section;
}

export const terrainSections = (model: CityModel, footprint: CityFootprint) =>
  [traceTerrainSection(model, footprint, 'east_west'), traceTerrainSection(model, footprint, 'south_north')];
