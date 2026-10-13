import type { CityModel } from './cityModel';
import { footprintGround } from './cityTerrain';
import webPackage from '../package.json' with { type: 'json' };

export type CityFootprint = { east: number; north: number; width: number; length: number; elevation: number };
export type ReportInput = {
  title: string; model: CityModel; footprint: CityFootprint;
  sources: { name: string; bytes: number; sha256: string }[];
  inspected_at: string; source_url: string; attribution: string; usage_terms: string;
  data_kind: 'synthetic' | 'public_city_model' | 'unspecified'; dataset: unknown;
};
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
// String cells can contain imported filenames/IDs. Preserve numbers as numbers,
// and neutralize spreadsheet formulas only in text cells.
export const cityCSVCell = (value: string | number) => {
  const text = typeof value === 'number' ? String(value) : /^[\s]*[=+@-]|^[\t\r\n]/.test(value) ? "'" + value : value;
  return '"' + text.replaceAll('"', '""') + '"';
};
const status = { unique: '高さが一意', uncovered: '地形なし', ambiguous: '高さが一意でない', invalid: '無効な位置' };

export function cityReportSnapshot(input: ReportInput, generatedAt = new Date().toISOString()) {
  const p = input.footprint, m = input.model;
  if (!Object.values(p).every(Number.isFinite) || p.width <= 0 || p.length <= 0 || p.width > 5000 || p.length > 5000 ||
      p.east - p.width / 2 < m.bounds.min[0] || p.east + p.width / 2 > m.bounds.max[0] ||
      -p.north - p.length / 2 < m.bounds.min[2] || -p.north + p.length / 2 > m.bounds.max[2] ||
      p.elevation < m.origin[2] + m.bounds.min[1] || p.elevation > m.origin[2] + m.bounds.max[1]) throw new Error('確認済みの有効な施工範囲が必要です');
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('資料作成日時が無効です');
  generatedAt = new Date(generatedAt).toISOString();
  const samples = footprintGround(m, p);
  const originUnits = m.crs === 'EPSG:6697' ? ['degree', 'degree', 'm'] : ['m', 'm', 'm'];
  return {
    schema_version: 1, report_type: 'city_terrain_inspection', display_version: webPackage.version,
    generated_at: generatedAt, inspected_at: input.inspected_at,
    numerical_solver_linked: false, whole_footprint_coverage_verified: false,
    title: input.title, data_kind: input.data_kind, dataset: input.dataset,
    sources: input.sources, source_url: input.source_url, attribution: input.attribution, usage_terms: input.usage_terms,
    crs: m.crs, origin: m.origin, origin_axis_units: originUnits, bounds: m.bounds, lod: m.lod,
    feature_count: m.features.length, polygon_count: m.polygonCount, footprint: p,
    terrain_inspection: { method: 'display_triangle_barycentric_5_points', shared_height_tolerance_m: 1e-6, samples },
  };
}

export function buildCityReport(input: ReportInput, generatedAt = new Date().toISOString()) {
  const snapshot = cityReportSnapshot(input, generatedAt);
  const p = snapshot.footprint, m = input.model, samples = snapshot.terrain_inspection.samples, originUnits = snapshot.origin_axis_units;
  generatedAt = snapshot.generated_at;
  const headers = ['point', 'east_m', 'north_m', 'status', 'elevation_m', 'height_candidates_m', 'feature_ids',
    'footprint_east_m', 'footprint_north_m', 'footprint_width_m', 'footprint_length_m', 'marker_elevation_m',
    'crs', 'lod', 'origin_a', 'origin_b', 'origin_height_m', 'origin_axis_units', 'data_kind', 'attribution', 'usage_terms', 'source_url', 'dataset_json', 'source_files_json', 'generated_at_utc', 'display_version',
    'numerical_solver_linked', 'whole_footprint_coverage_verified'];
  const csv = '\uFEFF' + [headers, ...samples.map(s => [s.label, s.east, s.north, s.status,
    s.status === 'unique' ? s.elevations[0] : '', JSON.stringify(s.elevations), s.features.join('; '),
    p.east, p.north, p.width, p.length, p.elevation, m.crs, m.lod, ...m.origin, JSON.stringify(originUnits), input.data_kind,
    input.attribution, input.usage_terms, input.source_url, JSON.stringify(input.dataset ?? null),
    JSON.stringify(input.sources), generatedAt, webPackage.version, 'false', 'false'])].map(row => row.map(cityCSVCell).join(',')).join('\r\n') + '\r\n';
  // A schematic of five inspection locations, not a map, terrain surface or
  // whole-area coverage overlay. Same horizontal scale in both directions.
  const scale = Math.min(420 / p.width, 260 / p.length, 1e6);
  const w = p.width * scale, h = p.length * scale;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 620 400" role="img" aria-label="施工範囲の5点確認配置図"><title>施工範囲の5点確認配置図</title><rect x="${310 - w / 2}" y="${200 - h / 2}" width="${w}" height="${h}" fill="#edf4ec" stroke="#346653" stroke-width="2"/>${samples.map(s => {
    const x = 310 + (s.east - p.east) * scale, y = 200 - (s.north - p.north) * scale;
    const label = `${s.label}: ${s.status === 'unique' ? s.elevations[0].toFixed(3) + ' m' : status[s.status]}`;
    return `<circle cx="${x}" cy="${y}" r="5" fill="${s.status === 'unique' ? '#346653' : '#aa532c'}"/><text x="${x}" y="${y - 13}" text-anchor="middle">${escape(label)}</text>`;
  }).join('')}<text x="310" y="365" text-anchor="middle">東西 ${escape(p.width)} m × 南北 ${escape(p.length)} m</text><path d="M565 70V25m-6 8 6-8 6 8" fill="none" stroke="#346653" stroke-width="2"/><text x="565" y="90" text-anchor="middle">北</text></svg>`;
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DobokuAI — 都市地形・施工範囲の確認資料</title><style>body{font:15px/1.7 system-ui,sans-serif;color:#243c33;background:#f5f7f3;margin:0}main{max-width:1050px;margin:32px auto;padding:32px;background:white}h1{font-size:26px}h2{margin-top:32px;font-size:20px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #ccd7cf;padding:9px;text-align:left;overflow-wrap:anywhere}th{background:#edf4ec}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f0f4ef;padding:16px;font-size:12px}svg{display:block;width:min(100%,620px);margin:auto}svg text{font:13px system-ui,sans-serif}.notice{padding:14px;background:#fff3de;border-left:4px solid #ad7831}.meta{overflow-wrap:anywhere}.download{display:inline-block;padding:8px 16px;color:#254a39;background:#edf4ec}@media print{body{background:white}main{margin:0;padding:12px}.download{display:none}tr{break-inside:avoid}}</style></head><body><main>
    <h1>都市地形・施工範囲の確認資料</h1><p>${escape(input.title)} / DobokuAI 表示機能 ${escape(webPackage.version)}</p>
    <p class="notice">表示モデルの地形5点確認です。5点とも高さが得られても、範囲全体の地形被覆・内部の穴・測量精度は保証しません。土量・水理・構造・建物干渉・施工可否は計算していません。</p>
    <p>作成日時（UTC）：${escape(generatedAt)}<br>モデル点検日時：${escape(input.inspected_at)}<br>データ種別：${escape(input.data_kind)}（${input.data_kind === 'public_city_model' ? '同梱モデルの原出典・利用条件を確認' : input.data_kind === 'synthetic' ? '合成例・実測ではありません' : '外部入力の出典・利用条件は未認証'}）</p>
    <h2>確認済み施工範囲と座標</h2><p>表示原点から東 ${escape(p.east)} m・北 ${escape(p.north)} m / 幅 ${escape(p.width)} m・長さ ${escape(p.length)} m / マーカー標高 ${escape(p.elevation)} m（原データ基準）</p>
    <p>CRS：${escape(m.crs)} / 表示原点：${escape(m.origin.join(', '))}（各軸単位 ${escape(originUnits.join(', '))}） / LOD ${m.lod}。水平は表示座標、標高は原データ基準です。EPSG:6697の水平表示はGRS80接平面の近似で、測量座標変換・標高基準変換ではありません。</p>
    <h2>5点の配置と地形高さ</h2><p>北を上にした配置模式図です。地形や建物の面を描いた地図ではありません。水平の縦横縮尺は共通です。</p>${svg}
    <table aria-label="地形5点の確認結果"><thead><tr><th>点</th><th>東 (m)</th><th>北 (m)</th><th>判定</th><th>地形標高 (m)</th><th>高さ候補 (m)</th><th>参照地物ID</th></tr></thead><tbody>${samples.map(s => `<tr><td>${escape(s.label)}</td><td>${escape(s.east)}</td><td>${escape(s.north)}</td><td>${status[s.status]}</td><td>${s.status === 'unique' ? escape(s.elevations[0]) : '—'}</td><td>${escape(JSON.stringify(s.elevations))}</td><td>${escape(s.features.join('; '))}</td></tr>`).join('')}</tbody></table>
    <p>地形の三角形内を重心座標補間し、欠損は外挿せず、複数高さ・鉛直面は一意に決めません。共有辺の高さは1µm以内で同一と扱います。マーカーは水平面であり、全面を地盤へ投影した形状ではありません。</p>
    <a class="download" download="doboku-city-terrain.csv" href="data:text/csv;charset=utf-8,${escape(encodeURIComponent(csv))}">この資料と同じ条件のCSVを保存</a>
    <h2>出典・利用条件と入力ファイル</h2><div class="meta"><p>原データURL：${escape(input.source_url || '未入力')}<br>出典：${escape(input.attribution || '未入力')}<br>利用条件：${escape(input.usage_terms || '未入力')}</p></div>
    <ul class="meta">${input.sources.map(s => `<li>${escape(s.name)} / ${s.bytes} bytes / SHA-256 ${escape(s.sha256)}</li>`).join('') || '<li>原ファイルのハッシュ記録なし（内蔵合成例等）</li>'}</ul>
    <h2>再確認用の条件JSON</h2><p>図は表示補助です。元CityGMLと、その加工記録・利用条件を別途保持してください。河川プロジェクトやRustエンジンの計算報告書ではありません。</p><pre id="city-report-snapshot">${escape(JSON.stringify(snapshot, null, 2))}</pre>
  </main></body></html>`;
  return { snapshot, csv, html };
}
