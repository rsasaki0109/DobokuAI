import { useState } from 'react';
import type { ReportInput } from './cityReport';
import type { TransectLine } from './cityTransect';
import { buildCityTransectReport } from './cityTransectReport';
import CityTransectView from './CityTransectView';

type Report = ReturnType<typeof buildCityTransectReport>;
export default function CityTransect({ input }: { input: ReportInput }) {
  const [coordinates, setCoordinates] = useState(() => {
    const p = input.footprint;
    return [p.east - p.width / 2, p.north, p.east + p.width / 2, p.north].map(String);
  });
  const [review, setReview] = useState<{ model: ReportInput['model']; footprint: ReportInput['footprint']; report: Report; confirmed: boolean } | null>(null);
  const [error, setError] = useState('');
  const current = review?.model === input.model && review.footprint === input.footprint ? review : null;
  const inspect = () => {
    setReview(null); setError('');
    try {
      if (coordinates.some(v => !v.trim())) throw new Error('指定線の4座標を入力してください');
      const [e0, n0, e1, n1] = coordinates.map(Number);
      const line: TransectLine = { start: { east: e0, north: n0 }, end: { east: e1, north: n1 } };
      const report = buildCityTransectReport(input, line);
      setReview({ model: input.model, footprint: input.footprint, report, confirmed: false });
    } catch (e) { setError((e as Error).message); }
  };
  const save = (format: 'csv' | 'html' | 'json') => {
    if (!current?.confirmed) return;
    const content = format === 'json' ? JSON.stringify(current.report.snapshot, null, 2) : current.report[format];
    const url = URL.createObjectURL(new Blob([content], { type: { csv: 'text/csv', html: 'text/html', json: 'application/json' }[format] + ';charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `doboku-city-transect.${format}`; a.click(); URL.revokeObjectURL(url);
  };
  return <section className="city-review" aria-label="任意方向の地形断面">
    <h3>任意方向の地形断面</h3><p>表示原点からの東・北（m）で2点を指定します。始点から終点へ距離を測り、地形だけを確認します。</p>
    <div className="form-grid">{['始点の東 (m)', '始点の北 (m)', '終点の東 (m)', '終点の北 (m)'].map((label, i) => <label className="field" key={label}>{label}<input aria-label={`指定線 ${label}`} type="number" step="any" value={coordinates[i]} onChange={e => { setCoordinates(coordinates.map((v, j) => i === j ? e.target.value : v)); setReview(null); setError(''); }} /></label>)}</div>
    <button type="button" className="secondary" onClick={inspect}>指定線を点検・プレビュー</button>
    {error && <p role="alert">指定線を作成できません：{error}</p>}
    {current && !current.confirmed && <div role="region" aria-label="指定線の確認プレビュー"><CityTransectView transect={current.report.snapshot.terrain_transect} />
      <button type="button" className="primary" onClick={() => setReview({ ...current, confirmed: true })}>確認して任意方向の断面を表示</button><button type="button" className="secondary" onClick={() => setReview(null)}>指定線のプレビューを取消</button></div>}
    {current?.confirmed && <div role="region" aria-label="任意方向の断面結果"><p>点検日時：{current.report.snapshot.transect_inspected_at}</p><CityTransectView transect={current.report.snapshot.terrain_transect} />
      <div className="city-actions">{(['csv', 'html', 'json'] as const).map(f => <button type="button" className="secondary" key={f} onClick={() => save(f)}>指定線の断面{f.toUpperCase()}を保存</button>)}</div></div>}
    <p className="muted">欠損・複数高さ・鉛直面を補完せずに記録します。河川測量断面としての採用、水理計算、切土・盛土や土量の計算には未連携です。入力・モデル・施工範囲を変更したら再点検してください。</p>
  </section>;
}
