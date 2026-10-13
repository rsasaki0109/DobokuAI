import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CityGradingComparisonView from './CityGradingComparisonView';
import { cityGradingConditions, inspectGradingRun } from './cityGrading';
import type { GradingRun } from './cityGrading';
import type { citySectionSnapshot } from './citySectionCSV';
import { cityCSVCell, cityHTMLEscape as escape } from './cityReport';

export function gradingComparison(source: ReturnType<typeof citySectionSnapshot>, baseline: GradingRun, scenario: GradingRun) {
  const sections = source.terrain_sections.sections;
  baseline = inspectGradingRun(baseline, cityGradingConditions(sections, baseline.conditions.target_elevation_m));
  scenario = inspectGradingRun(scenario, cityGradingConditions(sections, scenario.conditions.target_elevation_m));
  if (baseline.engine_version !== scenario.engine_version || baseline.model_version !== scenario.model_version) throw new Error('比較には同じエンジン版で基準案を再計算してください');
  const differences = (['east_west', 'south_north'] as const).map(axis => {
    const a = baseline[axis], b = scenario[axis];
    if (a.known_length_m !== b.known_length_m || a.uncovered_length_m !== b.uncovered_length_m || a.ambiguous_length_m !== b.ambiguous_length_m || a.unresolved_point_count !== b.unresolved_point_count) throw new Error('2案の地形被覆判定が一致しません');
    return { axis, complete: a.complete && b.complete,
      cut_area_delta_m2: a.cut_area_m2 === null || b.cut_area_m2 === null ? null : b.cut_area_m2 - a.cut_area_m2,
      fill_area_delta_m2: a.fill_area_m2 === null || b.fill_area_m2 === null ? null : b.fill_area_m2 - a.fill_area_m2,
      known_cut_area_delta_m2: b.known_cut_area_m2 - a.known_cut_area_m2,
      known_fill_area_delta_m2: b.known_fill_area_m2 - a.known_fill_area_m2 };
  });
  return { baseline, scenario, differences };
}
export type GradingComparison = ReturnType<typeof gradingComparison>;

export function buildCityGradingComparisonReport(source: ReturnType<typeof citySectionSnapshot>, baseline: GradingRun, scenario: GradingRun, generatedAt = new Date().toISOString()) {
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('比較資料の作成日時が無効です');
  const comparison = gradingComparison(source, baseline, scenario);
  const snapshot = { ...structuredClone(source), report_type: 'city_centerline_grading_comparison',
    generated_at: generatedAt, numerical_solver_linked: true, numerical_engine: 'doboku-earthwork', hydraulic_solver_linked: false,
    volume_calculated: false, difference_direction: 'scenario_minus_baseline', comparison };
  const headers = ['axis', 'row_type', 'start_distance_m', 'end_distance_m', 'status', 'complete', 'baseline_target_elevation_m', 'scenario_target_elevation_m',
    'baseline_cut_area_m2', 'baseline_fill_area_m2', 'scenario_cut_area_m2', 'scenario_fill_area_m2', 'cut_area_delta_m2', 'fill_area_delta_m2',
    'baseline_known_cut_area_m2', 'baseline_known_fill_area_m2', 'scenario_known_cut_area_m2', 'scenario_known_fill_area_m2', 'known_cut_area_delta_m2', 'known_fill_area_delta_m2',
    'known_length_m', 'uncovered_length_m', 'ambiguous_length_m', 'unresolved_point_count', 'engine_version', 'model_version', 'baseline_executed_at_utc', 'scenario_executed_at_utc', 'generated_at_utc',
    'baseline_crossing_distance_m', 'scenario_crossing_distance_m', 'height_pairs_json', 'point_heights_json', 'feature_ids_json',
    'sections_inspected_at_utc', 'crs', 'origin_json', 'origin_axis_units_json', 'section_coordinates_json', 'footprint_json', 'source_files_json', 'source_url',
    'attribution', 'usage_terms', 'dataset_json', 'data_kind', 'display_version', 'method', 'shared_height_tolerance_m', 'difference_direction', 'volume_calculated'];
  const rows: (number | string)[][] = [];
  for (const d of comparison.differences) {
    const a = comparison.baseline[d.axis], b = comparison.scenario[d.axis], section = source.terrain_sections.sections.find(s => s.axis === d.axis)!;
    const common = { axis: d.axis, baseline_target_elevation_m: baseline.conditions.target_elevation_m, scenario_target_elevation_m: scenario.conditions.target_elevation_m,
      engine_version: baseline.engine_version, model_version: baseline.model_version, baseline_executed_at_utc: baseline.executed_at, scenario_executed_at_utc: scenario.executed_at, generated_at_utc: generatedAt,
      sections_inspected_at_utc: source.sections_inspected_at, crs: source.crs, origin_json: JSON.stringify(source.origin), origin_axis_units_json: JSON.stringify(source.origin_axis_units),
      section_coordinates_json: JSON.stringify({ start: section.start, end: section.end }), footprint_json: JSON.stringify(source.footprint), source_files_json: JSON.stringify(source.sources), source_url: source.source_url,
      attribution: source.attribution, usage_terms: source.usage_terms, dataset_json: JSON.stringify(source.dataset), data_kind: source.data_kind, display_version: source.display_version,
      method: source.terrain_sections.method, shared_height_tolerance_m: source.terrain_sections.shared_height_tolerance_m, difference_direction: snapshot.difference_direction, volume_calculated: 'false' };
    const add = (fields: Record<string, number | string | null>) => { const row: Record<string, number | string | null> = { ...common, ...fields }; rows.push(headers.map(key => row[key] ?? '')); };
    add({ row_type: 'summary', start_distance_m: 0, end_distance_m: section.length, status: d.complete ? 'complete' : 'partial', complete: String(d.complete),
      baseline_cut_area_m2: a.cut_area_m2, baseline_fill_area_m2: a.fill_area_m2, scenario_cut_area_m2: b.cut_area_m2, scenario_fill_area_m2: b.fill_area_m2,
      cut_area_delta_m2: d.cut_area_delta_m2, fill_area_delta_m2: d.fill_area_delta_m2,
      baseline_known_cut_area_m2: a.known_cut_area_m2, baseline_known_fill_area_m2: a.known_fill_area_m2, scenario_known_cut_area_m2: b.known_cut_area_m2, scenario_known_fill_area_m2: b.known_fill_area_m2,
      known_cut_area_delta_m2: d.known_cut_area_delta_m2, known_fill_area_delta_m2: d.known_fill_area_delta_m2,
      known_length_m: a.known_length_m, uncovered_length_m: a.uncovered_length_m, ambiguous_length_m: a.ambiguous_length_m, unresolved_point_count: a.unresolved_point_count });
    for (let i = 0; i < a.spans.length; i++) {
      const av = a.spans[i], bv = b.spans[i], interval = section.intervals[i];
      add({ row_type: 'interval', start_distance_m: av.start_m, end_distance_m: av.end_m, status: interval.status,
        baseline_cut_area_m2: av.cut_area_m2, baseline_fill_area_m2: av.fill_area_m2, scenario_cut_area_m2: bv.cut_area_m2, scenario_fill_area_m2: bv.fill_area_m2,
        cut_area_delta_m2: av.cut_area_m2 === null || bv.cut_area_m2 === null ? null : bv.cut_area_m2 - av.cut_area_m2,
        fill_area_delta_m2: av.fill_area_m2 === null || bv.fill_area_m2 === null ? null : bv.fill_area_m2 - av.fill_area_m2,
        baseline_crossing_distance_m: av.crossing_distance_m, scenario_crossing_distance_m: bv.crossing_distance_m,
        height_pairs_json: JSON.stringify(interval.curves), feature_ids_json: JSON.stringify(interval.features) });
    }
    for (const p of section.points) add({ row_type: 'point', start_distance_m: p.distance, end_distance_m: p.distance, status: p.status, point_heights_json: JSON.stringify(p.elevations), feature_ids_json: JSON.stringify(p.features) });
  }
  const csv = '\uFEFF' + [headers, ...rows].map(r => r.map(cityCSVCell).join(',')).join('\r\n') + '\r\n';
  const figures = renderToStaticMarkup(createElement(CityGradingComparisonView, { sections: source.terrain_sections.sections, comparison }));
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DobokuAI — 計画標高2案の断面積比較</title><style>body{font:15px/1.7 system-ui;color:#243c33;background:#f5f7f3}main{max-width:1100px;margin:24px auto;padding:24px;background:white}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccd7cf;padding:8px;overflow-wrap:anywhere}.city-review{margin:24px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}svg,tr{break-inside:avoid}@media print{main{margin:0;padding:8px}.download{display:none}}</style></head><body><main>
    <h1>計画標高2案の断面積比較</h1><p>${escape(source.title)} / 作成日時 ${escape(generatedAt)}</p>
    <p>同じ原地形・施工範囲・2線で水平計画面だけを比較。差は比較案−基準案、単位m²です。欠損を補完せず、全長差と一意な区間の小計差を区別します。土量・水理・構造・干渉・施工可否・工期・費用は未算定です。</p>
    ${figures}<p>Rust doboku-earthwork ${escape(baseline.engine_version)} / ${escape(baseline.model_version)}<br>基準案計算日時 ${escape(baseline.executed_at)}<br>比較案計算日時 ${escape(scenario.executed_at)}<br>断面点検日時 ${escape(source.sections_inspected_at)}<br>CRS ${escape(source.crs)} / 表示原点 ${escape(JSON.stringify(source.origin))}</p>
    <a class="download" download="doboku-city-grading-comparison.csv" href="data:text/csv;charset=utf-8,${escape(encodeURIComponent(csv))}">この比較結果のCSVを保存</a>
    <h2>出典・利用条件</h2><p>${escape(source.attribution)}<br>${escape(source.usage_terms)}<br>${escape(source.source_url)}</p>
    <h2>元断面・条件・比較結果JSON</h2><pre id="city-grading-comparison-snapshot">${escape(JSON.stringify(snapshot, null, 2))}</pre>
  </main></body></html>`;
  return { snapshot, csv, html };
}
