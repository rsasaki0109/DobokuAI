import { useEffect, useRef, useState } from 'react';
import CityGradingComparisonView from './CityGradingComparisonView';
import { buildCityGradingComparisonReport } from './cityGradingComparison';
import { inspectCityGradingComparisonArchive, verifyCityGradingComparisonArchive } from './cityGradingComparisonRestore';
import { cityGradingFileLimit } from './cityGradingRestore';
import { requestCityGrading } from './cityGrading';
import { citySectionSnapshot } from './citySectionCSV';
import type { ReportInput } from './cityReport';
import type { TerrainSection } from './citySections';
import { saveBlob } from './types';

type Captured = { sections: TerrainSection[]; model: ReportInput['model']; footprint: ReportInput['footprint'];
  report: ReturnType<typeof buildCityGradingComparisonReport>; verifiedAt: { baseline: string; scenario: string } };
export default function CityGradingComparisonRestore({ input, sections, inspectedAt }: { input: ReportInput; sections: TerrainSection[]; inspectedAt: string }) {
  const [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [candidate, setCandidate] = useState<(Captured & { file: File }) | null>(null), [result, setResult] = useState<Captured | null>(null);
  const revision = useRef(0), controller = useRef<AbortController | null>(null);
  const cancel = () => { revision.current++; controller.current?.abort(); setBusy(false); setError(''); setCandidate(null); };
  useEffect(() => {
    cancel(); setResult(null);
    return () => { revision.current++; controller.current?.abort(); };
  }, [input.model, input.footprint, sections]);
  const matches = (captured: Captured | null) => captured?.sections === sections && captured.model === input.model && captured.footprint === input.footprint;
  const preview = matches(candidate) && candidate?.file === file ? candidate : null;
  const current = matches(result) ? result : null;
  const download = (format: 'html' | 'csv' | 'json') => {
    if (!current) return;
    const report = current.report;
    saveBlob(new Blob([format === 'json' ? JSON.stringify(report.snapshot, null, 2) : report[format]], { type: format === 'html' ? 'text/html;charset=utf-8' : format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' }), `doboku-city-grading-comparison.${format}`);
  };
  return <section className="city-review" role="region" aria-label="2案比較結果のJSON復元">
    <h3>保存した2案比較を開く</h3>
    <p>同じ都市モデル・施工範囲で断面を表示し、比較JSON（8MiBまで）を選択してください。元断面・出典・差分を点検し、両案をRustで照合します。表示中の計画標高・基準案・原地形は変更しません。計算APIが必要です。</p>
    <label className="field">2案比較の保存結果JSON<input type="file" accept=".json,application/json" aria-label="2案比較の保存結果JSON" onChange={e => { cancel(); setFile(e.target.files?.[0] ?? null); }} /></label>
    <button type="button" className="secondary" disabled={!file || busy} onClick={async () => {
      if (!file) return;
      cancel(); const version = revision.current, chosen = file, abort = new AbortController(); controller.current = abort; setBusy(true);
      try {
        if (chosen.size > cityGradingFileLimit) throw new Error('2案比較JSONは8MiB以内です');
        const value = JSON.parse(await chosen.text());
        if (version !== revision.current || abort.signal.aborted) return;
        const archive = inspectCityGradingComparisonArchive(value, citySectionSnapshot(input, sections, inspectedAt));
        const [a, b] = await Promise.all([requestCityGrading(archive.comparison.baseline.conditions, abort.signal), requestCityGrading(archive.comparison.scenario.conditions, abort.signal)]);
        const verified = verifyCityGradingComparisonArchive(archive, a, b), saved = verified.archive;
        const report = buildCityGradingComparisonReport(saved.source, saved.comparison.baseline, saved.comparison.scenario, saved.source.generated_at);
        if (version === revision.current) setCandidate({ sections, model: input.model, footprint: input.footprint, report, verifiedAt: verified.verifiedAt, file: chosen });
      } catch (e) { if (version === revision.current && !abort.signal.aborted) { setError((e as Error).message); abort.abort(); } }
      finally { if (version === revision.current) setBusy(false); }
    }}>{busy ? '保存した2案をRustで照合中…' : '比較JSONを点検・両案をRustで照合'}</button>
    {busy && <button type="button" className="secondary" onClick={cancel}>2案比較の点検を取消</button>}
    {error && <p role="alert">保存した比較を復元できません：{error}。表示中の条件・結果を保持しています。</p>}
    {preview && <div role="region" aria-label="2案比較結果の復元確認">
      <h4>保存した2案比較の復元候補</h4>
      <p>基準案 {preview.report.snapshot.comparison.baseline.conditions.target_elevation_m} m / 比較案 {preview.report.snapshot.comparison.scenario.conditions.target_elevation_m} m（原データ基準）。差は比較案−基準案です。</p>
      <p>保存資料の作成日時 {preview.report.snapshot.generated_at}<br />基準案計算日時 {preview.report.snapshot.comparison.baseline.executed_at}<br />比較案計算日時 {preview.report.snapshot.comparison.scenario.executed_at}<br />元断面点検日時 {preview.report.snapshot.sections_inspected_at}</p>
      <p>Rust照合日時：基準案 {preview.verifiedAt.baseline} / 比較案 {preview.verifiedAt.scenario} / エンジン {preview.report.snapshot.comparison.baseline.engine_version}</p>
      <p>{preview.report.snapshot.comparison.differences.map(d => `${d.axis === 'east_west' ? '東西' : '南北'}：全長の切土/盛土差 ${d.cut_area_delta_m2 ?? '未算定'} / ${d.fill_area_delta_m2 ?? '未算定'} m²、一意な区間の小計差 ${d.known_cut_area_delta_m2} / ${d.known_fill_area_delta_m2} m²`).join(' / ')}</p>
      <p>元断面・出典・両案の数値・差分が一致しました。確認後、保存時の日時で別の比較表示を開きます。河川条件・履歴へ書き込みません。</p>
      <button type="button" className="primary" onClick={() => { setResult({ sections: preview.sections, model: preview.model, footprint: preview.footprint, report: preview.report, verifiedAt: preview.verifiedAt }); cancel(); }}>確認して保存した2案比較を表示</button>
      <button type="button" className="secondary" onClick={cancel}>2案比較の復元を取消</button>
    </div>}
    <div className="city-actions">{(['html', 'csv', 'json'] as const).map(format => <button key={format} type="button" className="secondary" disabled={!current} onClick={() => download(format)}>復元した比較{format.toUpperCase()}を保存</button>)}</div>
    {current && <div role="region" aria-label="復元した2案比較の結果">
      <p role="status" aria-label="2案比較結果の復元状況">保存時の計算・点検・作成日時を保持しています。新しいRust照合日時：基準案 {current.verifiedAt.baseline} / 比較案 {current.verifiedAt.scenario}。</p>
      <p>保存資料の作成日時 {current.report.snapshot.generated_at} / 基準案 {current.report.snapshot.comparison.baseline.executed_at} / 比較案 {current.report.snapshot.comparison.scenario.executed_at}</p>
      <CityGradingComparisonView sections={sections} comparison={current.report.snapshot.comparison} />
      <button type="button" className="secondary" onClick={() => { cancel(); setResult(null); }}>復元した比較表示を閉じる</button>
    </div>}
    <p className="muted">欠損・未解決点を補完せず、未知の全長差は未算定のままです。土量・水理・施工可否・工期・費用は未算定。元CityGMLも保管してください。DB保存・自動復元・照合履歴の永続化は未対応です。</p>
  </section>;
}
