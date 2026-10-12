import { useEffect, useRef, useState } from 'react';
import { api, saveBlob, type SpatialReference } from './types';

type StudySummary = {
  id: number; project_name: string; executed_at: string; engine_version: string;
  case_count: number; failed_count: number;
};
type StudyPage = { items: StudySummary[]; next_before: number | null };
type Selection = { run_id: number; sensitivity_id: number | null; resolution_id: number | null };
type Manifest = {
  format_version: string; builder_version: string; assembled_at: string;
  selection: Selection; project_id: string; project_name: string;
  conditions_sha256: string; baseline_profile_sha256: string;
  discharge_m3_s: number; station_count: number; scenario_count: number; staged: boolean;
  reference: SpatialReference;
  records: { kind: string; id: number; engine_version: string; executed_at: string; case_count: number; failed_count: number }[];
  files: { path: string; bytes: number; sha256: string }[];
  notes: string[];
};
const time = (iso: string) => new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

function StudyPicker({ projectId, kind, label, value, change }: {
  projectId: string; kind: 'sensitivity' | 'resolution'; label: string;
  value: number | null; change: (id: number | null) => void;
}) {
  const [items, setItems] = useState<StudySummary[]>([]);
  const [before, setBefore] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const path = `/projects/${encodeURIComponent(projectId)}/${kind}-runs`;
  useEffect(() => {
    const current = ++generation.current;
    setBusy(true); setError(''); setItems([]); setBefore(null);
    void api<StudyPage>(path).then(page => {
      if (generation.current === current) { setItems(page.items); setBefore(page.next_before); }
    }).catch(e => { if (generation.current === current) setError((e as Error).message); })
      .finally(() => { if (generation.current === current) setBusy(false); });
    return () => { generation.current++; };
  }, [path, revision]);
  async function more() {
    const current = generation.current;
    setBusy(true); setError('');
    try {
      const page = await api<StudyPage>(`${path}?before=${before}`);
      if (generation.current === current) { setItems(old => [...old, ...page.items]); setBefore(page.next_before); }
    } catch (e) { if (generation.current === current) setError((e as Error).message); }
    finally { if (generation.current === current) setBusy(false); }
  }
  return <div>
    <label className="field"><span>{label}を収録（任意）</span>
      <select aria-label={`${label}の収録履歴`} value={value ?? ''} disabled={busy} onChange={e => change(e.target.value ? Number(e.target.value) : null)}>
        <option value="">収録しない</option>
        {value !== null && !items.some(i => i.id === value) && <option value={value}>選択済み #{value}</option>}
        {items.map(i => <option key={i.id} value={i.id}>#{i.id} · {time(i.executed_at)} JST · 案{i.case_count} / 失敗{i.failed_count} · engine {i.engine_version}</option>)}
      </select>
    </label>
    <button className="text-button" disabled={busy} onClick={() => setRevision(n => n + 1)}>{label}の候補を更新</button>
    {before !== null && <button className="text-button" disabled={busy} onClick={() => void more()}>{label}の以前の履歴を読み込む</button>}
    {error && <p role="alert">履歴取得: {error}</p>}
  </div>;
}

export function ReviewPack({ projectId, runId, task }: {
  projectId: string; runId: number | null; task: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [sensitivityId, setSensitivityId] = useState<number | null>(null);
  const [resolutionId, setResolutionId] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ key: string; manifest: Manifest } | null>(null);
  const [error, setError] = useState('');
  const selection = { run_id: runId!, sensitivity_id: sensitivityId, resolution_id: resolutionId };
  const key = JSON.stringify(selection);
  const manifest = preview?.key === key ? preview.manifest : null;
  const names: Record<string, string> = { construction:'施工比較', sensitivity:'感度比較', resolution:'測点間隔比較' };
  return <section className="panel review-pack" aria-label="試行記録パック">
    <div className="panel-heading"><div><div className="eyebrow">SAVED RIVER EVIDENCE</div><h2>試行記録パック</h2></div><span className="badge">保存結果から出力</span></div>
    <p className="muted">施工比較と、同じ基本条件・基準高・エンジン版の比較履歴をまとめます。ZIPを展開してindex.htmlを開くと、図付きHTML・CSV・保存JSONを確認できます。</p>
    {runId === null ? <p>計算を実行するか、計算履歴を開くと記録パックを作れます。</p> : <>
      <p>基本の計算履歴 #{runId}。感度・測点間隔比較には施工案を適用していません。異なる条件の履歴は収録を拒否します。</p>
      <div className="form-grid">
        <StudyPicker projectId={projectId} kind="sensitivity" label="感度比較" value={sensitivityId} change={id => { setSensitivityId(id); setPreview(null); setError(''); }} />
        <StudyPicker projectId={projectId} kind="resolution" label="測点間隔比較" value={resolutionId} change={id => { setResolutionId(id); setPreview(null); setError(''); }} />
      </div>
      <button className="secondary" onClick={() => void task(async () => {
        setPreview(null); setError('');
        try { setPreview({ key, manifest: await api<Manifest>('/review-packs/preview', selection) }); }
        catch (e) { setError((e as Error).message); }
      })}>記録パックの内容を確認</button>
      {error && <p role="alert">記録パック: {error}</p>}
      {manifest && <>
        <p role="status">記録パック: {manifest.records.length} 種類の保存履歴 · {manifest.files.length + 1} ファイル。再計算は行っていません。</p>
        <p>{manifest.project_name} · Q {manifest.discharge_m3_s} m³/s · {manifest.station_count}断面 · {manifest.scenario_count}施工案</p>
        <p>保存時の標高系: {manifest.reference.vertical_datum} · {manifest.reference.horizontal_reference}</p>
        <div className="table-scroll"><table><thead><tr><th>保存履歴</th><th>元の計算日時</th><th>エンジン版</th><th>案数 / 失敗</th></tr></thead><tbody>
          {manifest.records.map(r => <tr key={r.kind}><td>{names[r.kind]} #{r.id}</td><td>{time(r.executed_at)} JST</td><td>{r.engine_version}</td><td>{r.case_count} / {r.failed_count}</td></tr>)}
        </tbody></table></div>
        {manifest.notes.map(note => <p className="muted" key={note}>{note}</p>)}
        <details><summary>収録ファイル・SHA-256</summary><p>条件 SHA-256: {manifest.conditions_sha256}</p>
          <div className="table-scroll"><table><thead><tr><th>ファイル</th><th>bytes</th><th>SHA-256</th></tr></thead><tbody>{manifest.files.map(f => <tr key={f.path}><td>{f.path}</td><td>{f.bytes}</td><td><code>{f.sha256}</code></td></tr>)}</tbody></table></div>
        </details>
        <button className="primary" onClick={() => void task(async () => {
          setError('');
          try {
            const response = await fetch('/api/review-packs/zip', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(selection) });
            if (!response.ok) { const text = await response.text(); let message = text; try { message = JSON.parse(text).error ?? text; } catch { /* Extraction errors are text. */ } throw new Error(message); }
            saveBlob(await response.blob(), `doboku-review-run-${runId}.zip`);
          } catch (e) { setError((e as Error).message); }
        })}>記録パックZIPを保存</button>
      </>}
    </>}
  </section>;
}
