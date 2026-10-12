import { useState } from 'react';
import { api, saveBlob, type Project, type River } from './types';

type Range = { lower: number; upper: number };
type Report = {
  river: River;
  engine_version: string;
  checked_at: string;
  can_attempt_profile: boolean;
  sections: { chainage: number; connected_depth_ranges: Range[]; selected_depth_range: Range | null; critical_depth: number | null; normal_depth: number | null; issues: string[] }[];
  transitions: { upstream_chainage: number; downstream_chainage: number; bed_slope: number | null; reference_depth: number | null; upstream_width: number | null; downstream_width: number | null; width_ratio: number | null; issues: string[] }[];
  boundary: { chainage: number; depth: number; water_surface: number | null; froude: number | null; issues: string[] };
  note: string;
};
const number = (value: number | null, digits = 4) => value === null ? '—' : value.toLocaleString('ja-JP', { maximumFractionDigits: digits });
const ranges = (values: Range[]) => values.length ? values.map(r => `(${number(r.lower)}, ${number(r.upper)})`).join(' ∪ ') : '—';
// Keep very small numerical margins visible instead of rounding them to zero.
const searchRange = (r: Range | null) => r ? `[${r.lower.toPrecision(9)}, ${r.upper.toPrecision(9)}]` : '—';

export function RiverDiagnostics({ project, task }: { project: Project; task: (fn: () => Promise<void>) => Promise<void> }) {
  const river = project.river;
  const source = { project_id: project.id, project_name: project.name, reference: project.reference };
  const inputKey = JSON.stringify({ river, ...source });
  const [snapshot, setSnapshot] = useState<{ inputKey: string; report: Report } | null>(null);
  const report = snapshot?.inputKey === inputKey ? snapshot.report : null;
  return <section className="panel river-diagnostics" aria-label="基本条件の事前診断">
    <div className="panel-heading"><div><div className="eyebrow">RIVER INPUT DIAGNOSTICS</div><h2>計算前の断面・境界診断</h2></div><span className="badge">条件を変更せず確認</span></div>
    <p className="muted">連続水面の水深範囲、限界・等流水深、幅急変の位置をRustエンジンで確認します。基本条件のみを対象とし、施工案や縦断水面形の計算は行いません。</p>
    <button className="secondary" onClick={() => void task(async () => {
      setSnapshot(null);
      const result = await api<Report>('/diagnostics/river', river);
      setSnapshot({ inputKey, report: result });
    })}>基本条件を診断</button>
    {snapshot && !report && <p role="status">条件が変わりました。事前診断を再実行してください。</p>}
    {report && <>
      <p role="status">{report.can_attempt_profile ? '事前診断を通過しました。縦断計算の収束は計算実行で確認してください。' : '事前診断で対象外・未成立の条件が見つかりました。位置と理由を確認してください。'}</p>
      <p className="muted">{report.note}</p>
      <h3>断面ごとの水深範囲</h3>
      <div className="table-scroll"><table><thead><tr><th>流下距離 m</th><th>連続水面の水深 m（端点除外）</th><th>選択探索区間 m</th><th>限界水深 m</th><th>等流水深 m</th><th>診断</th></tr></thead><tbody>
        {report.sections.map(s => <tr key={s.chainage}><td>{number(s.chainage)}</td><td>{ranges(s.connected_depth_ranges)}</td><td>{searchRange(s.selected_depth_range)}</td><td>{number(s.critical_depth)}</td><td>{number(s.normal_depth)}</td><td>{s.issues.join(' / ') || '通過'}</td></tr>)}
      </tbody></table></div>
      <h3>隣接断面の遷移</h3>
      <p className="muted">幅は共通の参照水深で評価。幅比は大きい幅 / 小さい幅。1.25超または河床勾配の絶対値0.1超を拒否する保守的な適用制限です。</p>
      <div className="table-scroll"><table><thead><tr><th>区間 m</th><th>河床勾配</th><th>参照水深 m</th><th>上流幅 m</th><th>下流幅 m</th><th>幅比</th><th>診断</th></tr></thead><tbody>
        {report.transitions.map(t => <tr key={t.upstream_chainage}><td>{number(t.upstream_chainage)} → {number(t.downstream_chainage)}</td><td>{number(t.bed_slope,6)}</td><td>{number(t.reference_depth)}</td><td>{number(t.upstream_width)}</td><td>{number(t.downstream_width)}</td><td>{number(t.width_ratio)}</td><td>{t.issues.join(' / ') || '通過'}</td></tr>)}
      </tbody></table></div>
      <h3>指定境界の確認</h3>
      <p className="muted">水位の標高基準: {project.reference.vertical_datum} · 水平座標: {project.reference.horizontal_reference}</p>
      <p>{river.boundary.regime === 'subcritical' ? '下流端' : '上流端'} {number(report.boundary.chainage)} m · 水深 {number(report.boundary.depth)} m · 水位 {number(report.boundary.water_surface)} m · Fr {number(report.boundary.froude)}</p>
      <p>{report.boundary.issues.join(' / ') || '境界の事前診断を通過'}</p>
      <p className="muted">診断日時 {report.checked_at} · engine {report.engine_version}。履歴DBには保存しません。JSONに入力条件と診断値を含めます。</p>
      <button className="secondary" onClick={() => saveBlob(new Blob([JSON.stringify({ ...report, ...source },null,2)],{type:'application/json'}),'doboku-river-diagnostics.json')}>事前診断JSONを保存</button>
    </>}
  </section>;
}
