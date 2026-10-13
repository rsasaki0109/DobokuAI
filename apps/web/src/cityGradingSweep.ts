import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CityGradingSweepView from './CityGradingSweepView';
import { gradingComparison } from './cityGradingComparison';
import type { GradingComparison } from './cityGradingComparison';
import { cityGradingConditions, inspectGradingRun } from './cityGrading';
import type { GradingRun } from './cityGrading';
import type { citySectionSnapshot } from './citySectionCSV';
import { cityCSVCell, cityHTMLEscape as escape } from './cityReport';
import { hasJSONKeys } from './jsonMatch';

export const gradingSweepLimit = 9;
export function validateGradingTargets(targets: number[]): number[] {
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > gradingSweepLimit || Array.from(targets).some(h => typeof h !== 'number' || !Number.isFinite(h) || Math.abs(h) > 12000) || new Set(targets).size !== targets.length) throw new Error('計画標高は重複なしで1〜9個、有限値かつ±12000mで指定してください');
  return [...targets];
}
export function parseGradingTargets(text: string): number[] {
  if (text.length > 2048) throw new Error('標高一覧は2048文字以内で指定してください');
  const parts = text.split(/[,\n]/).map(v => v.trim());
  if (parts.some(v => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v))) throw new Error('標高を半角カンマまたは改行で区切ってください。空欄や数値以外は使えません');
  return validateGradingTargets(parts.map(Number));
}
export type GradingSweepOutcome = { status: 'calculated'; target_elevation_m: number; run: GradingRun; differences: GradingComparison['differences'] }
  | { status: 'failed'; target_elevation_m: number; error: string };
export type GradingSweep = { baseline: GradingRun; targets: number[]; outcomes: GradingSweepOutcome[] };

export function inspectGradingSweep(source: ReturnType<typeof citySectionSnapshot>, baseline: GradingRun, targets: number[], values: unknown[]): GradingSweep {
  targets = validateGradingTargets(targets);
  baseline = inspectGradingRun(baseline, cityGradingConditions(source.terrain_sections.sections, baseline.conditions.target_elevation_m));
  if (!Array.isArray(values) || values.length !== targets.length) throw new Error('全標高の計算結果または失敗記録が必要です');
  const outcomes = values.map((value, i): GradingSweepOutcome => {
    if (!value || typeof value !== 'object') throw new Error('標高ごとの記録が無効です');
    const v = value as Record<string, unknown>;
    if (v.target_elevation_m !== targets[i]) throw new Error('計算対象の標高・順序が一致しません');
    if (v.status === 'failed') {
      if (!hasJSONKeys(v, ['status', 'target_elevation_m', 'error']) || typeof v.error !== 'string' || !v.error.trim() || v.error.length > 4096) throw new Error('失敗記録が無効です');
      return { status: 'failed', target_elevation_m: targets[i], error: v.error };
    }
    if (v.status !== 'calculated' || !hasJSONKeys(v, ['status', 'target_elevation_m', 'run'])) throw new Error('計算記録が無効です');
    const run = inspectGradingRun(v.run, cityGradingConditions(source.terrain_sections.sections, targets[i]));
    const comparison = gradingComparison(source, baseline, run);
    return { status: 'calculated', target_elevation_m: targets[i], run: comparison.scenario, differences: comparison.differences };
  });
  return { baseline, targets, outcomes };
}

export function buildCityGradingSweepReport(source: ReturnType<typeof citySectionSnapshot>, baseline: GradingRun, targets: number[], outcomes: unknown[], generatedAt = new Date().toISOString()) {
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('比較資料の作成日時が無効です');
  const sweep = inspectGradingSweep(source, baseline, targets, outcomes);
  const snapshot = { ...structuredClone(source), report_type: 'city_centerline_grading_sweep', generated_at: generatedAt,
    numerical_solver_linked: true, numerical_engine: 'doboku-earthwork', hydraulic_solver_linked: false, volume_calculated: false,
    difference_direction: 'scenario_minus_baseline', sweep };
  const headers = ['target_elevation_m', 'axis', 'status', 'complete', 'cut_area_m2', 'fill_area_m2', 'known_cut_area_m2', 'known_fill_area_m2',
    'cut_area_delta_m2', 'fill_area_delta_m2', 'known_cut_area_delta_m2', 'known_fill_area_delta_m2', 'known_length_m', 'uncovered_length_m', 'ambiguous_length_m', 'unresolved_point_count',
    'baseline_target_elevation_m', 'baseline_executed_at_utc', 'engine_version', 'model_version', 'executed_at_utc', 'error', 'generated_at_utc', 'sections_inspected_at_utc',
    'crs', 'origin_json', 'origin_axis_units_json', 'section_coordinates_json', 'footprint_json', 'source_files_json', 'source_url', 'attribution', 'usage_terms', 'dataset_json', 'data_kind', 'display_version', 'difference_direction', 'volume_calculated'];
  const rows = sweep.outcomes.flatMap(outcome => (['east_west', 'south_north'] as const).map((axis, i) => {
    const section = source.terrain_sections.sections[i], q = outcome.status === 'calculated' ? outcome.run[axis] : null, d = outcome.status === 'calculated' ? outcome.differences[i] : null;
    return [outcome.target_elevation_m, axis, outcome.status, q ? String(q.complete) : '', q?.cut_area_m2 ?? '', q?.fill_area_m2 ?? '', q?.known_cut_area_m2 ?? '', q?.known_fill_area_m2 ?? '',
      d?.cut_area_delta_m2 ?? '', d?.fill_area_delta_m2 ?? '', d?.known_cut_area_delta_m2 ?? '', d?.known_fill_area_delta_m2 ?? '', q?.known_length_m ?? '', q?.uncovered_length_m ?? '', q?.ambiguous_length_m ?? '', q?.unresolved_point_count ?? '',
      baseline.conditions.target_elevation_m, baseline.executed_at, outcome.status === 'calculated' ? outcome.run.engine_version : '', outcome.status === 'calculated' ? outcome.run.model_version : '', outcome.status === 'calculated' ? outcome.run.executed_at : '', outcome.status === 'failed' ? outcome.error : '', generatedAt, source.sections_inspected_at,
      source.crs, JSON.stringify(source.origin), JSON.stringify(source.origin_axis_units), JSON.stringify({start:section.start,end:section.end}), JSON.stringify(source.footprint), JSON.stringify(source.sources), source.source_url, source.attribution, source.usage_terms, JSON.stringify(source.dataset), source.data_kind, source.display_version, snapshot.difference_direction, 'false'];
  }));
  const csv = '\uFEFF' + [headers, ...rows].map(r => r.map(cityCSVCell).join(',')).join('\r\n') + '\r\n';
  const figures = renderToStaticMarkup(createElement(CityGradingSweepView, { sweep }));
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DobokuAI — 複数標高の断面積比較</title><style>body{font:15px/1.7 system-ui;color:#243c33;background:#f5f7f3}main{max-width:1100px;margin:24px auto;padding:24px;background:white}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccd7cf;padding:8px;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}svg,tr{break-inside:avoid}.city-sections{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}@media print{main{margin:0;padding:8px}.download{display:none}}</style></head><body><main>
    <h1>複数標高の断面積比較</h1><p>${escape(source.title)} / 作成日時 ${escape(generatedAt)}</p>
    <p>同じ原断面と水平計画面をRustで計算した標高ごとの点です。点の間を補間せず、失敗と未知の面積を0へ置き換えません。全長未算定と既知小計を区別します。差は各案−基準案、単位m²。土量・水理・施工可否・工期・費用は未算定です。</p>
    ${figures}<p>基準案：${escape(baseline.conditions.target_elevation_m)} m / ${escape(baseline.engine_version)} / ${escape(baseline.model_version)} / ${escape(baseline.executed_at)}<br>断面点検日時 ${escape(source.sections_inspected_at)}<br>CRS ${escape(source.crs)} / 原点 ${escape(JSON.stringify(source.origin))}</p>
    <a class="download" download="doboku-city-grading-sweep.csv" href="data:text/csv;charset=utf-8,${escape(encodeURIComponent(csv))}">この複数標高比較のCSVを保存</a>
    <h2>出典・利用条件</h2><p>${escape(source.attribution)}<br>${escape(source.usage_terms)}<br>${escape(source.source_url)}</p>
    <h2>元断面・条件・結果・失敗記録JSON</h2><pre id="city-grading-sweep-snapshot">${escape(JSON.stringify(snapshot,null,2))}</pre>
  </main></body></html>`;
  return { snapshot, csv, html };
}
