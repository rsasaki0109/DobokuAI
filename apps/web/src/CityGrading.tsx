import { useEffect, useRef, useState } from 'react';
import CitySectionsView from './CitySectionsView';
import { cityGradingConditions, requestCityGrading } from './cityGrading';
import { cityGradingFileLimit, inspectCityGradingArchive, verifyCityGradingArchive } from './cityGradingRestore';
import { buildCityGradingReport } from './cityGradingReport';
import { citySectionSnapshot } from './citySectionCSV';
import type { GradingRun } from './cityGrading';
import type { ReportInput } from './cityReport';
import type { TerrainSection } from './citySections';
import { saveBlob } from './types';

type Captured = { sections: TerrainSection[]; footprint: ReportInput['footprint']; model: ReportInput['model'];
  source: ReturnType<typeof citySectionSnapshot>; run: GradingRun; verifiedAt?: string };
export default function CityGrading({ input, sections, inspectedAt }: { input: ReportInput; sections: TerrainSection[]; inspectedAt: string }) {
  const [target, setTarget] = useState(String(input.footprint.elevation));
  const [result, setResult] = useState<Captured | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(0), controller = useRef<AbortController | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreCandidate, setRestoreCandidate] = useState<(Captured & { file: File; verifiedAt: string }) | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false), [restoreError, setRestoreError] = useState('');
  const restoreRevision = useRef(0), restoreController = useRef<AbortController | null>(null);
  const clearRestore = () => { restoreRevision.current++; restoreController.current?.abort(); setRestoreCandidate(null); setRestoreBusy(false); setRestoreError(''); };
  useEffect(() => {
    revision.current++; controller.current?.abort(); setResult(null); setBusy(false); setError(''); setTarget(String(input.footprint.elevation));
    clearRestore();
    return () => { revision.current++; controller.current?.abort(); restoreRevision.current++; restoreController.current?.abort(); };
  }, [sections, input.model, input.footprint]);
  const targetHeight = target.trim() === '' ? NaN : Number(target);
  const valid = Number.isFinite(targetHeight) && Math.abs(targetHeight) <= 12000;
  const current = result?.sections === sections && result.model === input.model && result.footprint === input.footprint && result.run.conditions.target_elevation_m === targetHeight ? result : null;
  const candidate = restoreCandidate?.sections === sections && restoreCandidate.model === input.model && restoreCandidate.footprint === input.footprint && restoreCandidate.file === restoreFile ? restoreCandidate : null;
  const exportResult = (format: 'html' | 'csv' | 'json') => {
    if (!current) return;
    try {
      const report = buildCityGradingReport(current.source, current.run);
      saveBlob(new Blob([format === 'json' ? JSON.stringify(report.snapshot, null, 2) : report[format]],
        { type: format === 'html' ? 'text/html;charset=utf-8' : format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' }), `doboku-city-grading.${format}`);
    } catch (e) { setError((e as Error).message); }
  };
  return <section className="city-review" role="region" aria-label="地形断面の切土・盛土計算">
    <div className="eyebrow">RUST EARTHWORK / SECTION AREAS</div><h3>計画標高と切土・盛土の断面積</h3>
    <p>反映済み範囲：東 {input.footprint.east} m・北 {input.footprint.north} m / 東西 {sections[0].length} m・南北 {sections[1].length} m。中心を通る2線の地形を水平な計画面と比較します。</p>
    <label className="field">計画標高 (m / 原データ基準)<input type="number" aria-label="断面積計算の計画標高 (m / 原データ基準)" min="-12000" max="12000" step="any" value={target} onChange={e => {
      revision.current++; controller.current?.abort(); clearRestore(); setBusy(false); setResult(null); setError(''); setTarget(e.target.value);
    }} /></label>
    {!valid && <p role="alert">計画標高は有限値かつ±12000mで指定してください。</p>}
    <p className="muted">切土・盛土は相殺しません。欠損・複数高さ・未解決点のある軸は全長の面積を未算定とし、一意な区間の小計を示します。2線の面積を足したり、範囲幅を掛けて土量へ換算しません。範囲全体の地形被覆・施工可否は未確認です。</p>
    <button type="button" className="primary" disabled={!valid || busy || restoreBusy} onClick={async () => {
      clearRestore();
      const version = ++revision.current, abort = new AbortController(); controller.current?.abort(); controller.current = abort;
      setBusy(true); setError(''); setResult(null);
      try {
        const conditions = cityGradingConditions(sections, targetHeight);
        // Capture provenance and exact confirmed geometry before awaiting the API.
        const source = citySectionSnapshot(input, sections, inspectedAt);
        const run = await requestCityGrading(conditions, abort.signal);
        if (version === revision.current) setResult({ sections, footprint: input.footprint, model: input.model,
          source: { ...source, generated_at: new Date(run.executed_at).toISOString() }, run });
      } catch (e) { if (version === revision.current && !abort.signal.aborted) setError((e as Error).message); }
      finally { if (version === revision.current) setBusy(false); }
    }}>{busy ? 'Rustで断面積を計算中…' : '条件を確認して断面の切土・盛土を計算'}</button>
    {busy && <button type="button" className="secondary" onClick={() => { revision.current++; controller.current?.abort(); setBusy(false); setError('計算を取り消しました'); }}>断面積の計算を取消</button>}
    {error && <p role="alert">{error}。河川条件・施工範囲・原地形は変更していません。</p>}
    <div className="city-actions">
      <button type="button" className="secondary" disabled={!current} onClick={() => exportResult('html')}>切土・盛土の確認資料HTMLを保存</button>
      <button type="button" className="secondary" disabled={!current} onClick={() => exportResult('csv')}>切土・盛土の断面積CSVを保存</button>
      <button type="button" className="secondary" disabled={!current} onClick={() => exportResult('json')}>切土・盛土の計算JSONを保存</button>
    </div>
    <div className="city-review" role="region" aria-label="切土・盛土結果のJSON復元">
      <h4>保存した切土・盛土結果を開く</h4>
      <p className="muted">先に同じ都市モデル・施工範囲で断面を表示し、計算JSON（8MiBまで）を選択してください。元断面・出典・条件を照合し、Rustで数値を再確認してから復元候補を表示します。計算APIが必要です。</p>
      <label className="field">切土・盛土の保存結果JSON<input type="file" accept=".json,application/json" aria-label="切土・盛土の保存結果JSON" onChange={e => { clearRestore(); setRestoreFile(e.target.files?.[0] ?? null); }} /></label>
      <button type="button" className="secondary" disabled={!restoreFile || restoreBusy || busy} onClick={async () => {
        if (!restoreFile) return;
        clearRestore(); setError(''); const version = restoreRevision.current, file = restoreFile, abort = new AbortController(); restoreController.current = abort; setRestoreBusy(true);
        try {
          if (file.size > cityGradingFileLimit) throw new Error('切土・盛土JSONは8MiB以内です');
          const value = JSON.parse(await file.text());
          if (version !== restoreRevision.current || abort.signal.aborted) return;
          const archive = inspectCityGradingArchive(value, citySectionSnapshot(input, sections, inspectedAt));
          const verified = verifyCityGradingArchive(archive, await requestCityGrading(archive.run.conditions, abort.signal));
          if (version === restoreRevision.current) setRestoreCandidate({ sections, footprint: input.footprint, model: input.model,
            source: verified.archive.source, run: verified.archive.run, verifiedAt: verified.verifiedAt, file });
        } catch (e) { if (version === restoreRevision.current && !abort.signal.aborted) setRestoreError((e as Error).message); }
        finally { if (version === restoreRevision.current) setRestoreBusy(false); }
      }}>{restoreBusy ? '保存条件とRust結果を照合中…' : '切土・盛土JSONを点検・Rustで照合'}</button>
      {restoreBusy && <button type="button" className="secondary" onClick={clearRestore}>保存結果の点検を取消</button>}
      {restoreError && <p role="alert">保存結果を復元できません：{restoreError}。表示中の条件・結果を保持しています。</p>}
      {candidate && <div role="region" aria-label="切土・盛土結果の復元確認">
        <h4>保存結果の復元候補</h4>
        <p>表示中の計画標高 {valid ? `${targetHeight} m` : '未指定・無効'} → 復元する計画標高 {candidate.run.conditions.target_elevation_m} m（原データ基準）。施工範囲・原地形は変更しません。</p>
        <p>保存資料の計算日時：{candidate.run.executed_at} / 元の断面点検日時：{candidate.source.sections_inspected_at}<br />Rust照合日時：{candidate.verifiedAt} / エンジン {candidate.run.engine_version} / {candidate.run.model_version}</p>
        <p>{(['east_west', 'south_north'] as const).map(axis => { const q = candidate.run[axis]; return `${axis === 'east_west' ? '東西' : '南北'}：全長 ${q.complete ? `切土 ${q.cut_area_m2} / 盛土 ${q.fill_area_m2} m²` : '未算定'}、一意な区間の小計 ${q.known_cut_area_m2} / ${q.known_fill_area_m2} m²`; }).join(' / ')}</p>
        <p className="muted">元断面・出典とRustの数値結果が一致しました。確認すると表示中の計画標高と結果を置き換えます。保存時の日時を保持し、河川条件・履歴には書き込みません。</p>
        <button type="button" className="primary" onClick={() => {
          revision.current++; controller.current?.abort(); setBusy(false); setError(''); setTarget(String(candidate.run.conditions.target_elevation_m));
          setResult({ sections: candidate.sections, footprint: candidate.footprint, model: candidate.model, source: candidate.source, run: candidate.run, verifiedAt: candidate.verifiedAt }); clearRestore();
        }}>確認して保存した切土・盛土結果を表示</button>
        <button type="button" className="secondary" onClick={clearRestore}>保存結果の復元を取消</button>
      </div>}
    </div>
    {current && <div role="region" aria-label="切土・盛土の計算結果">
      {current.verifiedAt && <p role="status" aria-label="切土・盛土結果の復元状況">保存結果を表示中。保存資料の計算日時を保持し、{current.verifiedAt}にRust再計算との一致を確認しました。</p>}
      <p>Rust doboku-earthwork {current.run.engine_version} / {current.run.model_version} / 計算日時 {current.run.executed_at}</p>
      <table aria-label="切土・盛土の断面積一覧"><thead><tr><th>断面</th><th>全長の切土/盛土 (m²)</th><th>一意な区間の小計 (m²)</th><th>一意/欠損/曖昧な長さ (m)</th><th>未解決点</th></tr></thead><tbody>{(['east_west', 'south_north'] as const).map(axis => {
        const q = current.run[axis]; return <tr key={axis} data-grading-summary={axis}><th>{axis === 'east_west' ? '東西' : '南北'}</th><td>{q.complete ? `${q.cut_area_m2} / ${q.fill_area_m2}` : '未算定'}</td><td>{q.known_cut_area_m2} / {q.known_fill_area_m2}</td><td>{q.known_length_m} / {q.uncovered_length_m} / {q.ambiguous_length_m}</td><td>{q.unresolved_point_count}</td></tr>;
      })}</tbody></table>
      <CitySectionsView sections={sections} grading={{ target_elevation_m: current.run.conditions.target_elevation_m, east_west: current.run.east_west, south_north: current.run.south_north }} />
      <p className="muted">区分線形の高さ差を交点で分割して積分した断面積です。計画面の標高と原地形を同じ基準で比較しています。体積は未算定。地形・マーカー・河川条件は変更せず、結果はダウンロードで保存できます。DB保存・自動復元は未対応です。</p>
    </div>}
    <p className="muted">計画標高の編集・断面再表示・範囲変更の確認・モデル置換では以前の結果を出力しません。計算にはRust APIが必要です。断面の表示・照会・表示用資料はAPIなしでも動作します。</p>
  </section>;
}
