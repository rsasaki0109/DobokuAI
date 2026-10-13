import { useEffect, useRef, useState } from 'react';
import type { ReportInput } from './cityReport';
import type { TransectLine, TerrainTransect } from './cityTransect';
import { buildCityTransectReport, buildCityTransectReportFromSnapshot } from './cityTransectReport';
import { cityTransectFileLimit, inspectCityTransectArchive } from './cityTransectRestore';
import type { TransectArchive } from './cityTransectRestore';
import CityTransectView from './CityTransectView';

type Report = ReturnType<typeof buildCityTransectReport>;
export default function CityTransect({ input, onResult }: { input: ReportInput; onResult?: (transect: TerrainTransect | null, distance: number | null) => void }) {
  const [coordinates, setCoordinates] = useState(() => {
    const p = input.footprint;
    return [p.east - p.width / 2, p.north, p.east + p.width / 2, p.north].map(String);
  });
  const [review, setReview] = useState<{ model: ReportInput['model']; footprint: ReportInput['footprint']; report: Report; confirmed: boolean; verifiedAt?: string } | null>(null);
  const [error, setError] = useState('');
  const [selection, setSelection] = useState<{ transect: TerrainTransect; distance: number } | null>(null);
  const current = review?.model === input.model && review.footprint === input.footprint ? review : null;
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreError, setRestoreError] = useState(''), [restoreBusy, setRestoreBusy] = useState(false);
  const [candidate, setCandidate] = useState<{ model: ReportInput['model']; footprint: ReportInput['footprint']; file: File; archive: TransectArchive } | null>(null);
  const revision = useRef(0), source = useRef(input); source.current = input;
  const resetRestore = () => { revision.current++; setCandidate(null); setRestoreError(''); setRestoreBusy(false); };
  useEffect(() => {
    revision.current++; setCandidate(null); setRestoreError(''); setRestoreBusy(false);
    return () => { revision.current++; };
  }, [input.model, input.footprint]);
  const restoreCandidate = candidate?.model === input.model && candidate.footprint === input.footprint && candidate.file === restoreFile ? candidate : null;
  const inspect = () => {
    resetRestore(); setReview(null); setError(''); setSelection(null); onResult?.(null, null);
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
    <div className="form-grid">{['始点の東 (m)', '始点の北 (m)', '終点の東 (m)', '終点の北 (m)'].map((label, i) => <label className="field" key={label}>{label}<input aria-label={`指定線 ${label}`} type="number" step="any" value={coordinates[i]} onChange={e => { resetRestore(); setCoordinates(coordinates.map((v, j) => i === j ? e.target.value : v)); setReview(null); setError(''); setSelection(null); onResult?.(null, null); }} /></label>)}</div>
    <button type="button" className="secondary" onClick={inspect}>指定線を点検・プレビュー</button>
    {error && <p role="alert">指定線を作成できません：{error}</p>}
    {current && !current.confirmed && <div role="region" aria-label="指定線の確認プレビュー"><CityTransectView transect={current.report.snapshot.terrain_transect} />
      <button type="button" className="primary" onClick={() => { resetRestore(); setReview({ ...current, confirmed: true }); setSelection(null); onResult?.(current.report.snapshot.terrain_transect, null); }}>確認して任意方向の断面を表示</button><button type="button" className="secondary" onClick={() => { resetRestore(); setReview(null); onResult?.(null, null); }}>指定線のプレビューを取消</button></div>}
    {current?.confirmed && <div role="region" aria-label="任意方向の断面結果"><p>点検日時：{current.report.snapshot.transect_inspected_at}</p><CityTransectView transect={current.report.snapshot.terrain_transect}
      distance={selection?.transect === current.report.snapshot.terrain_transect ? selection.distance : undefined}
      onSelect={d => { const transect = current.report.snapshot.terrain_transect; setSelection(d === null ? null : { transect, distance: d }); onResult?.(transect, d); }} />
      {current.verifiedAt && <p role="status" aria-label="保存指定線の照合日時">保存断面を再切断して照合した日時：{current.verifiedAt} / 元の資料・点検日時を保持しています。</p>}
      <div className="city-actions">{(['csv', 'html', 'json'] as const).map(f => <button type="button" className="secondary" key={f} onClick={() => save(f)}>指定線の断面{f.toUpperCase()}を保存</button>)}</div></div>}
    <div className="city-review" role="region" aria-label="保存指定線の断面を復元">
      <h4>保存した指定線の断面を開く</h4><p>同じモデル・施工範囲で元地形を再切断し、全交点・区間・出典を照合します。確認後に保存した指定線を表示し、元の日時を保持します。</p>
      <label className="field">指定線の保存断面JSON<input aria-label="指定線の保存断面JSON" type="file" accept=".json,application/json" onChange={e => { resetRestore(); setRestoreFile(e.target.files?.[0] ?? null); }} /></label>
      <button type="button" className="secondary" disabled={!restoreFile || restoreBusy} onClick={async () => {
        if (!restoreFile) return;
        const token = ++revision.current, context = input, file = restoreFile;
        setCandidate(null); setRestoreError(''); setRestoreBusy(true);
        try {
          if (file.size > cityTransectFileLimit) throw new Error('保存断面JSONは8MiB以内です');
          const value = JSON.parse(await file.text());
          if (token !== revision.current || source.current.model !== context.model || source.current.footprint !== context.footprint) return;
          const archive = inspectCityTransectArchive(value, context);
          setCandidate({ model: context.model, footprint: context.footprint, file, archive });
        } catch (e) { if (token === revision.current && source.current.model === context.model && source.current.footprint === context.footprint) setRestoreError((e as Error).message); }
        finally { if (token === revision.current) setRestoreBusy(false); }
      }}>保存断面を点検・元地形と照合</button>
      {(restoreBusy || restoreCandidate) && <button type="button" className="secondary" onClick={resetRestore}>保存断面の点検を取消</button>}
      {restoreError && <p role="alert">保存断面を開けません：{restoreError}</p>}
      {restoreCandidate && <div role="region" aria-label="保存指定線の確認プレビュー">
        <p>元の資料作成日時：{restoreCandidate.archive.snapshot.generated_at} / 元の断面点検日時：{restoreCandidate.archive.snapshot.transect_inspected_at} / 今回の照合日時：{restoreCandidate.archive.verifiedAt}</p>
        <CityTransectView transect={restoreCandidate.archive.snapshot.terrain_transect} />
        <button type="button" className="primary" onClick={() => {
          const { snapshot, verifiedAt } = restoreCandidate.archive, report = buildCityTransectReportFromSnapshot(snapshot), line = snapshot.terrain_transect.line;
          setCoordinates([line.start.east, line.start.north, line.end.east, line.end.north].map(String));
          setReview({ model: input.model, footprint: input.footprint, report, confirmed: true, verifiedAt }); setError(''); setSelection(null); resetRestore(); onResult?.(report.snapshot.terrain_transect, null);
        }}>確認して保存指定線の断面を表示</button>
      </div>}
    </div>
    <p className="muted">欠損・複数高さ・鉛直面を補完せずに記録します。河川測量断面としての採用、水理計算、切土・盛土や土量の計算には未連携です。入力・モデル・施工範囲を変更したら再点検してください。</p>
  </section>;
}
