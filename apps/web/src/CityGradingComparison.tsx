import { useEffect, useRef, useState } from 'react';
import CityGradingComparisonView from './CityGradingComparisonView';
import { buildCityGradingComparisonReport } from './cityGradingComparison';
import { cityGradingConditions, requestCityGrading } from './cityGrading';
import type { GradingRun } from './cityGrading';
import type { citySectionSnapshot } from './citySectionCSV';
import { saveBlob } from './types';

export default function CityGradingComparison({ source, baseline }: { source: ReturnType<typeof citySectionSnapshot>; baseline: GradingRun }) {
  const initial = () => String(Math.max(-12000, baseline.conditions.target_elevation_m - 1));
  const [target, setTarget] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [result, setResult] = useState<{ source: typeof source; baseline: GradingRun; target: number; report: ReturnType<typeof buildCityGradingComparisonReport> } | null>(null);
  const revision = useRef(0), controller = useRef<AbortController | null>(null);
  useEffect(() => {
    revision.current++; controller.current?.abort(); setResult(null); setBusy(false); setError(''); setTarget(initial());
    return () => { revision.current++; controller.current?.abort(); };
  }, [source, baseline]);
  const height = target.trim() === '' ? NaN : Number(target), valid = Number.isFinite(height) && Math.abs(height) <= 12000;
  const current = result?.source === source && result.baseline === baseline && result.target === height ? result.report : null;
  const cancel = () => { revision.current++; controller.current?.abort(); setBusy(false); setResult(null); setError(''); };
  const download = (format: 'html' | 'csv' | 'json') => {
    if (!current) return;
    saveBlob(new Blob([format === 'json' ? JSON.stringify(current.snapshot, null, 2) : current[format]], { type: format === 'html' ? 'text/html;charset=utf-8' : format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' }), `doboku-city-grading-comparison.${format}`);
  };
  return <section className="city-review" role="region" aria-label="計画標高2案の比較">
    <h3>計画標高を変えた案と比較</h3><p>基準案は表示中の計算結果（計画標高 {baseline.conditions.target_elevation_m} m / {baseline.executed_at}）です。同じ原断面の水平計画面だけを変えてRustで計算します。</p>
    <label className="field">比較案の計画標高 (m / 原データ基準)<input aria-label="比較案の計画標高 (m / 原データ基準)" type="number" min="-12000" max="12000" step="any" value={target} onChange={e => { cancel(); setTarget(e.target.value); }} /></label>
    {!valid && <p role="alert">比較案の計画標高は有限値かつ±12000mで指定してください。</p>}
    <button type="button" className="primary" disabled={!valid || busy} onClick={async () => {
      cancel(); const version = revision.current, abort = new AbortController(); controller.current = abort; setBusy(true);
      try {
        const scenario = await requestCityGrading(cityGradingConditions(source.terrain_sections.sections, height), abort.signal);
        const report = buildCityGradingComparisonReport(source, baseline, scenario);
        if (version === revision.current) setResult({ source, baseline, target: height, report });
      } catch (e) { if (version === revision.current && !abort.signal.aborted) setError((e as Error).message); }
      finally { if (version === revision.current) setBusy(false); }
    }}>{busy ? 'Rustで比較案を計算中…' : '2案の条件を確認して断面積を比較'}</button>
    {busy && <button type="button" className="secondary" onClick={cancel}>断面積の比較を取消</button>}
    {error && <p role="alert">比較できません：{error}</p>}
    <div className="city-actions">{(['html', 'csv', 'json'] as const).map(format => <button key={format} type="button" className="secondary" disabled={!current} onClick={() => download(format)}>断面積の比較{format.toUpperCase()}を保存</button>)}</div>
    {current && <div role="region" aria-label="計画標高2案の比較結果"><CityGradingComparisonView sections={source.terrain_sections.sections} comparison={current.snapshot.comparison} />
      <p>比較案の計算日時 {current.snapshot.comparison.scenario.executed_at} / 比較資料の作成日時 {current.snapshot.generated_at}</p></div>}
    <p className="muted">元地形・施工範囲・基準案・河川条件は変更しません。欠損は補完せず、未知の全長差は未算定です。土量・施工可否・工期・費用は未算定。保存した比較は「保存した2案比較を開く」で照合して復元できます。DB保存・自動復元は未対応です。</p>
  </section>;
}
