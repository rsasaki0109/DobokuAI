import type { TerrainSection } from './citySections';
import type { CityModel } from './cityModel';

export const citySectionColors = { east_west: '#20764e', south_north: '#2469ac' };
export type CitySectionOverlayData = {
  axes: { axis: TerrainSection['axis']; length: number; segments: number[]; points: number[]; ambiguousPoints: number }[];
  bounds: CityModel['bounds'] | null;
};

// Use the same confirmed results as the charts. Each valid interval is a
// separate segment; never connect across missing, ambiguous or discontinuous heights.
export function citySectionOverlayData(sections: TerrainSection[], originHeight: number): CitySectionOverlayData {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let vertices = 0;
  const axes = sections.map(s => {
    const position = (distance: number, height: number) => [s.start.east + (s.axis === 'east_west' ? distance : 0),
      height - originHeight, -(s.start.north + (s.axis === 'south_north' ? distance : 0))];
    const segments = s.intervals.filter(v => v.status === 'unique').flatMap(v => [...position(v.from, v.curves[0].from), ...position(v.to, v.curves[0].to)]);
    const points = s.points.filter(p => p.status === 'unique').flatMap(p => position(p.distance, p.elevations[0]));
    for (const values of [segments, points]) for (let i = 0; i < values.length; i += 3) {
      for (let j = 0; j < 3; j++) {
        if (!Number.isFinite(values[i + j])) throw new Error('断面の描画座標が有限値ではありません');
        min[j] = Math.min(min[j], values[i + j]); max[j] = Math.max(max[j], values[i + j]);
      }
      vertices++;
    }
    return { axis: s.axis, length: s.length, segments, points, ambiguousPoints: s.points.filter(p => p.status === 'ambiguous').length };
  });
  return { axes, bounds: vertices ? { min, max } : null };
}
