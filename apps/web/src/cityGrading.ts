import type { TerrainSection } from './citySections';

export type GradingSpan = { start_m: number; end_m: number; ground:
  | { status: 'unique'; start_elevation_m: number; end_elevation_m: number }
  | { status: 'uncovered' | 'ambiguous' } };
export type GradingProfile = { length_m: number; spans: GradingSpan[]; unresolved_points_m: number[] };
export type GradingConditions = { target_elevation_m: number; east_west: GradingProfile; south_north: GradingProfile };
export type GradingSpanAreas = { start_m: number; end_m: number; cut_area_m2: number | null; fill_area_m2: number | null; crossing_distance_m: number | null };
export type GradingAreas = {
  complete: boolean; known_length_m: number; uncovered_length_m: number; ambiguous_length_m: number; unresolved_point_count: number;
  cut_area_m2: number | null; fill_area_m2: number | null; known_cut_area_m2: number; known_fill_area_m2: number; spans: GradingSpanAreas[];
};
export type GradingRun = { engine_version: string; model_version: string; executed_at: string; conditions: GradingConditions;
  east_west: GradingAreas; south_north: GradingAreas; volume_m3: null };
export type GradingOverlay = { target_elevation_m: number; east_west: GradingAreas; south_north: GradingAreas };

export function cityGradingConditions(sections: TerrainSection[], target: number): GradingConditions {
  if (!Number.isFinite(target) || Math.abs(target) > 12000) throw new Error('計画標高は有限値かつ±12000mで指定してください');
  if (sections.length !== 2 || sections[0].axis !== 'east_west' || sections[1].axis !== 'south_north') throw new Error('東西・南北の確認済み断面が必要です');
  const profile = (s: TerrainSection): GradingProfile => ({ length_m: s.length,
    spans: s.intervals.map(v => {
      if (v.status === 'unique' && v.curves.length !== 1) throw new Error('一意な断面に高さ曲線が1本必要です');
      return { start_m: v.from, end_m: v.to, ground: v.status === 'unique'
        ? { status: 'unique', start_elevation_m: v.curves[0].from, end_elevation_m: v.curves[0].to }
        : { status: v.status } };
    }), unresolved_points_m: s.points.filter(p => p.status !== 'unique').map(p => p.distance) });
  return { target_elevation_m: target, east_west: profile(sections[0]), south_north: profile(sections[1]) };
}

// Check the echoed conditions and output contract before showing/exporting it.
// This is not a second numerical solver or an independent source-data audit.
export function inspectGradingRun(value: unknown, conditions: GradingConditions): GradingRun {
  const run = value as GradingRun;
  if (!run || typeof run.engine_version !== 'string' || !run.engine_version || run.model_version !== 'linear-profile-grading-1' ||
    typeof run.executed_at !== 'string' || !Number.isFinite(Date.parse(run.executed_at)) || run.volume_m3 !== null ||
    JSON.stringify(run.conditions) !== JSON.stringify(conditions)) throw new Error('計算結果の条件・版・日時が一致しません');
  const nonnegative = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  for (const axis of ['east_west', 'south_north'] as const) {
    const q = run[axis], p = conditions[axis];
    const complete = p.unresolved_points_m.length === 0 && p.spans.every(s => s.ground.status === 'unique');
    if (!q || q.complete !== complete || q.unresolved_point_count !== p.unresolved_points_m.length ||
      ![q.known_length_m, q.uncovered_length_m, q.ambiguous_length_m, q.known_cut_area_m2, q.known_fill_area_m2].every(nonnegative) ||
      Math.abs(q.known_length_m + q.uncovered_length_m + q.ambiguous_length_m - p.length_m) > p.length_m * 1e-12 ||
      (complete ? !nonnegative(q.cut_area_m2) || !nonnegative(q.fill_area_m2) : q.cut_area_m2 !== null || q.fill_area_m2 !== null) ||
      (complete && (q.cut_area_m2 !== q.known_cut_area_m2 || q.fill_area_m2 !== q.known_fill_area_m2)) ||
      !Array.isArray(q.spans) || q.spans.length !== p.spans.length) throw new Error('断面積結果の判定・数値が無効です');
    for (let i = 0; i < p.spans.length; i++) {
      const a = q.spans[i], b = p.spans[i];
      if (!a || a.start_m !== b.start_m || a.end_m !== b.end_m ||
        (b.ground.status === 'unique' ? !nonnegative(a.cut_area_m2) || !nonnegative(a.fill_area_m2) : a.cut_area_m2 !== null || a.fill_area_m2 !== null) ||
        (a.crossing_distance_m !== null && (b.ground.status !== 'unique' || !Number.isFinite(a.crossing_distance_m) || a.crossing_distance_m < b.start_m || a.crossing_distance_m > b.end_m))) throw new Error('断面積の区間結果が一致しません');
    }
  }
  return structuredClone(run);
}
