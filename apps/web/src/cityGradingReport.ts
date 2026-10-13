import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CitySectionsView from './CitySectionsView';
import { cityCSVCell, cityHTMLEscape as escape } from './cityReport';
import type { citySectionSnapshot } from './citySectionCSV';
import { cityGradingConditions, inspectGradingRun } from './cityGrading';
import type { GradingRun } from './cityGrading';

export function buildCityGradingReport(source: ReturnType<typeof citySectionSnapshot>, run: GradingRun) {
  run = inspectGradingRun(run, cityGradingConditions(source.terrain_sections.sections, run.conditions.target_elevation_m));
  const snapshot = { ...structuredClone(source), report_type: 'city_centerline_grading_areas',
    numerical_solver_linked: true, numerical_engine: 'doboku-earthwork', hydraulic_solver_linked: false,
    volume_calculated: false, grading: run };
  const headers = ['axis', 'row_type', 'start_distance_m', 'end_distance_m', 'status', 'cut_area_m2', 'fill_area_m2', 'known_cut_area_m2', 'known_fill_area_m2',
    'known_length_m', 'uncovered_length_m', 'ambiguous_length_m', 'unresolved_point_count', 'crossing_distance_m', 'feature_ids_json', 'height_pairs_json', 'target_elevation_m', 'engine_version', 'model_version', 'executed_at_utc',
    'sections_inspected_at_utc', 'crs', 'origin_json', 'origin_axis_units_json', 'section_coordinates_json', 'footprint_json', 'source_files_json', 'source_url', 'attribution', 'usage_terms', 'dataset_json', 'data_kind', 'display_version', 'shared_height_tolerance_m', 'volume_calculated'];
  const rows: (number | string)[][] = [];
  for (const section of snapshot.terrain_sections.sections) {
    const q = run[section.axis];
    const tail = [run.conditions.target_elevation_m, run.engine_version, run.model_version, run.executed_at, source.sections_inspected_at,
      source.crs, JSON.stringify(source.origin), JSON.stringify(source.origin_axis_units), JSON.stringify({ start: section.start, end: section.end }), JSON.stringify(source.footprint), JSON.stringify(source.sources), source.source_url, source.attribution, source.usage_terms, JSON.stringify(source.dataset), source.data_kind, source.display_version, source.terrain_sections.shared_height_tolerance_m, 'false'];
    rows.push([section.axis, 'summary', 0, section.length, q.complete ? 'complete' : 'partial', q.cut_area_m2 ?? '', q.fill_area_m2 ?? '', q.known_cut_area_m2, q.known_fill_area_m2,
      q.known_length_m, q.uncovered_length_m, q.ambiguous_length_m, q.unresolved_point_count, '', JSON.stringify([...new Set(section.intervals.flatMap(v => v.features))]), '[]', ...tail]);
    for (let i = 0; i < q.spans.length; i++) {
      const v = q.spans[i]; rows.push([section.axis, 'interval', v.start_m, v.end_m, section.intervals[i].status, v.cut_area_m2 ?? '', v.fill_area_m2 ?? '', '', '', '', '', '', '', v.crossing_distance_m ?? '', JSON.stringify(section.intervals[i].features), JSON.stringify(section.intervals[i].curves), ...tail]);
    }
  }
  const csv = '\uFEFF' + [headers, ...rows].map(r => r.map(cityCSVCell).join(',')).join('\r\n') + '\r\n';
  const figures = renderToStaticMarkup(createElement(CitySectionsView, { sections: snapshot.terrain_sections.sections, expanded: true,
    grading: { target_elevation_m: run.conditions.target_elevation_m, east_west: run.east_west, south_north: run.south_north } }));
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DobokuAI — 地形断面の切土・盛土面積</title><style>body{font:15px/1.7 system-ui,sans-serif;color:#243c33;background:#f5f7f3}main{max-width:1050px;margin:24px auto;padding:24px;background:white}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccd7cf;padding:8px;text-align:left;overflow-wrap:anywhere}.city-review{margin:24px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere}.notice{background:#fff3de;padding:16px}svg,tr{break-inside:avoid}@media print{main{margin:0;padding:8px}.download{display:none}}</style></head><body><main>
    <h1>地形断面の切土・盛土面積</h1><p>${escape(source.title)} / 計画標高 ${escape(run.conditions.target_elevation_m)} m（原データ基準）</p>
    <p class="notice">確認済み範囲の中心を通る東西・南北2線の断面積です。切土と盛土は相殺しません。欠損・複数高さ・未解決点がある軸は全長の面積を未算定とし、一意な区間の小計だけを示します。2線の面積を足したり、範囲幅を掛けて土量へ換算しません。範囲全体の地形被覆・土量・水理・構造・建物干渉・施工可否は確認していません。</p>
    <p>エンジン：Rust doboku-earthwork ${escape(run.engine_version)} / モデル ${escape(run.model_version)}<br>計算日時：${escape(run.executed_at)}<br>断面点検日時：${escape(source.sections_inspected_at)}<br>CRS：${escape(source.crs)} / 表示原点 ${escape(JSON.stringify(source.origin))}</p>
    <table><thead><tr><th>軸</th><th>全長の切土/盛土 (m²)</th><th>一意な区間の小計 (m²)</th><th>一意/欠損/曖昧な長さ (m)</th><th>未解決点</th></tr></thead><tbody>${(['east_west', 'south_north'] as const).map(axis => { const q = run[axis]; return `<tr><td>${axis === 'east_west' ? '東西' : '南北'}</td><td>${q.complete ? `${q.cut_area_m2} / ${q.fill_area_m2}` : '未算定'}</td><td>${q.known_cut_area_m2} / ${q.known_fill_area_m2}</td><td>${q.known_length_m} / ${q.uncovered_length_m} / ${q.ambiguous_length_m}</td><td>${q.unresolved_point_count}</td></tr>`; }).join('')}</tbody></table>
    ${figures}<p>計算法：地形と水平計画面の差を区分線形として積分。交差区間はゼロ差の位置で切土・盛土へ分割。一意でない高さを選択・外挿せず、区間をまたいで補間しません。図は縦横別縮尺で、原地形は表示近似を含みます。</p>
    <a class="download" download="doboku-city-grading.csv" href="data:text/csv;charset=utf-8,${escape(encodeURIComponent(csv))}">この結果と同じ条件の断面積CSVを保存</a>
    <h2>出典・利用条件</h2><p>${escape(source.attribution)}<br>${escape(source.usage_terms)}<br>${escape(source.source_url)}</p>
    <h2>再確認用の条件・結果JSON</h2><p>原断面・判定・参照ID・元ファイルのbytes/SHA-256・出典・条件・計算結果を保持します。原CityGMLも別途保持してください。入力値からの積分であり、原データや現地測量を独立認証しません。計算はDBへ保存していません。</p><pre id="city-grading-report-snapshot">${escape(JSON.stringify(snapshot, null, 2))}</pre>
  </main></body></html>`;
  return { snapshot, csv, html };
}
