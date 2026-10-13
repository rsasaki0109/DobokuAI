import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CityTransectView from './CityTransectView';
import { cityReportSnapshot, cityHTMLEscape as escape, cityCSVCell } from './cityReport';
import type { ReportInput } from './cityReport';
import { traceTerrainTransect, transectCoordinate } from './cityTransect';
import type { TransectLine } from './cityTransect';

export function buildCityTransectReport(input: ReportInput, line: TransectLine, generatedAt = new Date().toISOString()) {
  const { terrain_inspection: _inspection, ...source } = cityReportSnapshot(input, generatedAt);
  const transect = traceTerrainTransect(input.model, line);
  const snapshot = structuredClone({ ...source, report_type: 'city_terrain_transect_inspection',
    hydraulic_solver_linked: false, volume_calculated: false,
    transect_inspected_at: source.generated_at,
    terrain_transect: { method: 'display_triangle_intersections_rigid_horizontal_line_frame', shared_height_tolerance_m: 1e-6, ...transect } });
  const rows: (string | number)[][] = [[
    'kind', 'distance_from_m', 'distance_to_m', 'east_from_m', 'north_from_m', 'east_to_m', 'north_to_m', 'status', 'height_candidates_m', 'feature_ids',
    'generated_at_utc', 'crs', 'origin', 'origin_axis_units', 'source_files', 'source_url', 'attribution', 'usage_terms', 'data_kind', 'numerical_solver_linked',
    'display_version', 'model_inspected_at', 'method', 'shared_height_tolerance_m', 'line_start_east_m', 'line_start_north_m', 'line_end_east_m', 'line_end_north_m', 'line_length_m',
  ]];
  const add = (kind: string, from: number, to: number, status: string, heights: unknown[], features: string[]) => {
    const a = transectCoordinate(transect, from), b = transectCoordinate(transect, to);
    rows.push([kind, from, to, a.east, a.north, b.east, b.north, status, heights.length ? JSON.stringify(heights) : '', JSON.stringify(features), snapshot.generated_at, snapshot.crs,
      JSON.stringify(snapshot.origin), JSON.stringify(snapshot.origin_axis_units), JSON.stringify(snapshot.sources), snapshot.source_url, snapshot.attribution, snapshot.usage_terms, snapshot.data_kind, 'false',
      snapshot.display_version, snapshot.inspected_at, snapshot.terrain_transect.method, snapshot.terrain_transect.shared_height_tolerance_m,
      transect.line.start.east, transect.line.start.north, transect.line.end.east, transect.line.end.north, transect.profile.length]);
  };
  for (const p of transect.profile.points) add('point', p.distance, p.distance, p.status, p.elevations, p.features);
  for (const v of transect.profile.intervals) add('interval', v.from, v.to, v.status, v.curves, v.features);
  const csv = '\ufeff' + rows.map(row => row.map(cityCSVCell).join(',')).join('\r\n') + '\r\n';
  const figures = renderToStaticMarkup(createElement(CityTransectView, { transect: snapshot.terrain_transect, expanded: true }));
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DobokuAI — 任意方向の地形断面</title><style>body{font:15px/1.7 system-ui;background:#f5f7f3;color:#243c33}main{max-width:1050px;margin:32px auto;padding:32px;background:white}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccd7cf;padding:8px;text-align:left;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}.notice{background:#fff3de;padding:16px}svg{break-inside:avoid}</style></head><body><main>
    <h1>任意方向の地形断面確認資料</h1><p>${escape(snapshot.title)} / 表示機能 ${escape(snapshot.display_version)} / 点検・作成日時（UTC） ${escape(snapshot.generated_at)}</p>
    <p class="notice">指定した2点を結ぶ表示地形の確認です。河川の測量断面・水面形ではありません。水中河床、測量精度、範囲全体の被覆は未確認です。土量・水理・構造・施工可否は計算していません。</p>
    <p>水平座標は表示原点からの東・北（m）、標高は原データ基準（m）。CRS ${escape(snapshot.crs)} / 原点 ${escape(JSON.stringify(snapshot.origin))} / 原点の軸単位 ${escape(JSON.stringify(snapshot.origin_axis_units))}。EPSG:6697の水平表示はGRS80接平面近似で、測量座標変換・標高基準変換ではありません。</p>
    ${figures}<p>地形三角形を水平回転した一時座標系で交差を求め、元の標高・地物IDを保持します。建物・道路は除外し、欠損を補完せず、複数高さ・鉛直面を採用しません。共有高さの一致許容値1µm。端点・距離は倍精度の浮動小数点演算です。</p>
    <a download="doboku-city-transect.csv" href="data:text/csv;charset=utf-8,${escape(encodeURIComponent(csv))}">この指定線のCSVを保存</a>
    <h2>出典・利用条件</h2><p>${escape(snapshot.attribution || '未入力')}<br>${escape(snapshot.usage_terms || '未入力')}<br>${escape(snapshot.source_url || '未入力')}</p>
    <h2>再確認用の条件・断面JSON</h2><p>入力ファイルのSHA-256・原点・指定線・高さ候補・欠損判定を保持します。原CityGMLと利用条件を別途保持してください。Rust計算報告書ではありません。</p><pre id="city-transect-snapshot">${escape(JSON.stringify(snapshot, null, 2))}</pre>
    </main></body></html>`;
  return { snapshot, csv, html };
}
