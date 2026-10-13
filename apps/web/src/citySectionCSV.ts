import { cityCSVCell, cityReportSnapshot } from './cityReport';
import type { ReportInput } from './cityReport';
import type { TerrainSection } from './citySections';

export function citySectionSnapshot(input: ReportInput, sections: TerrainSection[], inspectedAt: string, generatedAt = new Date().toISOString()) {
  const { terrain_inspection: _fivePoints, ...meta } = cityReportSnapshot(input, generatedAt);
  if (!Number.isFinite(Date.parse(inspectedAt))) throw new Error('断面点検日時が無効です');
  const p = meta.footprint;
  if (sections.length !== 2 || sections.some((s, i) => s.axis !== (i === 0 ? 'east_west' : 'south_north') ||
    s.length !== (i === 0 ? p.width : p.length) ||
    s.start.east !== (i === 0 ? p.east - p.width / 2 : p.east) || s.end.east !== (i === 0 ? (p.east - p.width / 2) + p.width : p.east) ||
    s.start.north !== (i === 0 ? p.north : p.north - p.length / 2) || s.end.north !== (i === 0 ? p.north : (p.north - p.length / 2) + p.length))) throw new Error('断面と確認済み施工範囲の位置が一致しません');
  return { ...meta, report_type: 'city_terrain_centerline_inspection', sections_inspected_at: new Date(inspectedAt).toISOString(),
    terrain_sections: { method: 'display_triangle_line_intersections', shared_height_tolerance_m: 1e-6, sections: structuredClone(sections) } };
}

export function citySectionCSVFromSnapshot(meta: ReturnType<typeof citySectionSnapshot>) {
  const p = meta.footprint;
  const headers = ['axis', 'row_type', 'start_distance_m', 'end_distance_m', 'start_east_m', 'start_north_m', 'end_east_m', 'end_north_m', 'status',
    'start_elevation_m', 'end_elevation_m', 'point_heights_json', 'interval_height_pairs_json', 'feature_ids_json',
    'footprint_east_m', 'footprint_north_m', 'footprint_width_m', 'footprint_length_m', 'marker_elevation_m', 'crs', 'lod', 'origin_json', 'origin_axis_units_json',
    'attribution', 'usage_terms', 'source_url', 'source_files_json', 'dataset_json', 'data_kind', 'generated_at_utc', 'sections_inspected_at_utc', 'display_version',
    'method', 'shared_height_tolerance_m', 'whole_footprint_coverage_verified', 'numerical_solver_linked'];
  const rows: (string | number)[][] = [];
  for (const s of meta.terrain_sections.sections) {
    const coordinate = (t: number) => s.axis === 'east_west' ? [s.start.east + t, s.start.north] : [s.start.east, s.start.north + t];
    const tail = [p.east, p.north, p.width, p.length, p.elevation, meta.crs, meta.lod, JSON.stringify(meta.origin), JSON.stringify(meta.origin_axis_units),
      meta.attribution, meta.usage_terms, meta.source_url, JSON.stringify(meta.sources), JSON.stringify(meta.dataset ?? null), meta.data_kind,
      meta.generated_at, meta.sections_inspected_at, meta.display_version, meta.terrain_sections.method, meta.terrain_sections.shared_height_tolerance_m, 'false', 'false'];
    for (const point of s.points) rows.push([s.axis, 'point', point.distance, point.distance, ...coordinate(point.distance), ...coordinate(point.distance), point.status,
      point.status === 'unique' ? point.elevations[0] : '', point.status === 'unique' ? point.elevations[0] : '', JSON.stringify(point.elevations), '[]', JSON.stringify(point.features), ...tail]);
    for (const v of s.intervals) rows.push([s.axis, 'interval', v.from, v.to, ...coordinate(v.from), ...coordinate(v.to), v.status,
      v.status === 'unique' ? v.curves[0].from : '', v.status === 'unique' ? v.curves[0].to : '', '[]', JSON.stringify(v.curves), JSON.stringify(v.features), ...tail]);
  }
  return '\uFEFF' + [headers, ...rows].map(row => row.map(cityCSVCell).join(',')).join('\r\n') + '\r\n';
}

export function citySectionCSV(input: ReportInput, sections: TerrainSection[], inspectedAt: string, generatedAt = new Date().toISOString()) {
  return citySectionCSVFromSnapshot(citySectionSnapshot(input, sections, inspectedAt, generatedAt));
}
