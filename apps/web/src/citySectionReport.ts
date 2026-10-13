import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CitySectionsView from './CitySectionsView';
import { cityHTMLEscape as escape } from './cityReport';
import type { ReportInput } from './cityReport';
import { citySectionSnapshot, citySectionCSVFromSnapshot } from './citySectionCSV';
import type { TerrainSection } from './citySections';

export function buildCitySectionReport(input: ReportInput, sections: TerrainSection[], inspectedAt: string, generatedAt = new Date().toISOString()) {
  const snapshot = citySectionSnapshot(input, sections, inspectedAt, generatedAt);
  const csv = citySectionCSVFromSnapshot(snapshot), p = snapshot.footprint;
  // Reuse the on-screen component: gaps, ambiguous spans, axes and scales must
  // have exactly the same geometry when this document is opened offline.
  const figures = renderToStaticMarkup(createElement(CitySectionsView, { sections: snapshot.terrain_sections.sections, expanded: true }));
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DobokuAI — 施工範囲の地形断面確認資料</title><style>body{font:15px/1.7 system-ui,sans-serif;color:#243c33;background:#f5f7f3;margin:0}main{max-width:1050px;margin:32px auto;padding:32px;background:white}h1{font-size:26px}h2{margin-top:32px;font-size:20px}h3{font-size:18px}.city-review{margin:24px 0;padding:16px;border:1px solid #ccd7cf}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccd7cf;padding:8px;text-align:left;overflow-wrap:anywhere}th{background:#edf4ec}details{margin-top:16px}summary{font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f0f4ef;padding:16px;font-size:12px}.notice{padding:14px;background:#fff3de;border-left:4px solid #ad7831}.meta{overflow-wrap:anywhere}.download{display:inline-block;padding:8px 16px;color:#254a39;background:#edf4ec}@media print{body{background:white}main{margin:0;padding:12px}.download{display:none}tr,svg{break-inside:avoid}}</style></head><body><main>
    <h1>施工範囲の地形断面確認資料</h1><p>${escape(snapshot.title)} / DobokuAI 表示機能 ${escape(snapshot.display_version)}</p>
    <p class="notice">表示地形の中心を通る東西・南北2線の確認です。2線で高さが得られても、範囲全体の地形被覆・内部の穴・測量精度を保証しません。河川測量断面・水面形ではなく、土量・水理・構造・建物干渉・施工可否は計算していません。</p>
    <p>作成日時（UTC）：${escape(snapshot.generated_at)}<br>断面点検日時（UTC）：${escape(snapshot.sections_inspected_at)}<br>モデル点検日時：${escape(snapshot.inspected_at)}<br>データ種別：${escape(snapshot.data_kind)}（${snapshot.data_kind === 'public_city_model' ? '同梱モデルの原出典・利用条件を確認' : snapshot.data_kind === 'synthetic' ? '合成例・実測ではありません' : '外部入力の出典・利用条件は未認証'}）</p>
    <h2>確認済み施工範囲と座標</h2><p>表示原点から東 ${escape(p.east)} m・北 ${escape(p.north)} m / 幅 ${escape(p.width)} m・長さ ${escape(p.length)} m / マーカー標高 ${escape(p.elevation)} m（原データ基準・地形高さとは別）</p>
    <p>CRS：${escape(snapshot.crs)} / 表示原点：${escape(snapshot.origin.join(', '))}（各軸単位 ${escape(snapshot.origin_axis_units.join(', '))}） / LOD ${snapshot.lod}。水平は表示座標、標高は原データ基準です。EPSG:6697の水平表示はGRS80接平面の近似で、測量座標変換・標高基準変換ではありません。</p>
    <h2>東西・南北の地形断面</h2>${figures}
    <p>地形三角形と中心線の交点で区間を分け、元の倍精度座標で高さを補間しています。建物・道路は参照しません。欠損の外挿・補完や複数候補からの選択をせず、鉛直面は一意に判定しません。共有高さの一致許容値は1µmです。縦横の図の縮尺は独立で、軸はmです。マーカー高さは断面に描いていません。</p>
    <a class="download" download="doboku-city-sections.csv" href="data:text/csv;charset=utf-8,${escape(encodeURIComponent(csv))}">この資料と同じ条件の断面CSVを保存</a>
    <h2>出典・利用条件と入力ファイル</h2><div class="meta"><p>原データURL：${escape(snapshot.source_url || '未入力')}<br>出典：${escape(snapshot.attribution || '未入力')}<br>利用条件：${escape(snapshot.usage_terms || '未入力')}</p><ul>${snapshot.sources.map(s => `<li>${escape(s.name)} / ${s.bytes} bytes / SHA-256 ${escape(s.sha256)}</li>`).join('') || '<li>原ファイルのハッシュ記録なし（内蔵合成例等）</li>'}</ul></div>
    <h2>再確認用の条件・断面JSON</h2><p>交点・区間の判定と高さ候補・参照IDを保持します。原CityGMLと加工記録・利用条件を別途保持してください。Rustエンジンの計算報告書ではありません。</p><pre id="city-section-report-snapshot">${escape(JSON.stringify(snapshot, null, 2))}</pre>
  </main></body></html>`;
  return { snapshot, csv, html };
}
