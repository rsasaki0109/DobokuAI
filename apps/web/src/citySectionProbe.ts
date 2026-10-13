import type { SectionStatus, TerrainSection } from './citySections';

export type CitySectionProbe = {
  axis: TerrainSection['axis']; distance: number; east: number; north: number;
  status: SectionStatus; elevations: number[]; features: string[]; kind: 'point' | 'interval';
};

// Exact event points take precedence over neighbouring intervals. A vertical
// projection or ambiguous span stays ambiguous even where candidate heights meet.
export function probeCitySection(section: TerrainSection, distance: number): CitySectionProbe | null {
  if (!Number.isFinite(distance) || distance < 0 || distance > section.length) return null;
  const point = section.points.find(p => p.distance === distance);
  const interval = point ? undefined : section.intervals.find(v => v.from < distance && distance < v.to);
  if (!point && !interval) return null;
  const elevations = point ? [...point.elevations] : interval!.curves.map(c => {
    const fraction = (distance - interval!.from) / (interval!.to - interval!.from);
    return c.from + (c.to - c.from) * fraction;
  });
  const unique: number[] = [];
  for (const h of elevations.sort((a, b) => a - b)) if (!unique.length || h - unique[unique.length - 1] > 1e-6) unique.push(h);
  return { axis: section.axis, distance,
    east: section.start.east + (section.axis === 'east_west' ? distance : 0),
    north: section.start.north + (section.axis === 'south_north' ? distance : 0),
    status: point?.status ?? interval!.status, elevations: unique,
    features: [...(point?.features ?? interval!.features)], kind: point ? 'point' : 'interval' };
}

export function cityProbePosition(probe: CitySectionProbe | null, originHeight: number): [number, number, number] | null {
  if (!probe || probe.status !== 'unique' || probe.elevations.length !== 1) return null;
  const position: [number, number, number] = [probe.east, probe.elevations[0] - originHeight, -probe.north];
  return position.every(Number.isFinite) ? position : null;
}
