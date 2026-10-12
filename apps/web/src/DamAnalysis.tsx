import { useEffect, useState } from 'react';
import { Download, Play, Waves, Shield, Pin, History, AlertCircle } from 'lucide-react';
import { NumberField } from './Editor';
import { api, saveBlob } from './types';
import type { DamConditions, DamHistory, DamRun, GravityDam, Spillway, Statics, StoredDam } from './damTypes';
import { contactLabels } from './damTypes';

const fmt = (v: number | null | undefined, digits = 2) => v == null ? '—' : v.toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const date = (v: string) => new Date(v).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
const damFields: [keyof GravityDam, string][] = [
  ['height_m', '堤高 (m)'], ['crest_width_m', '天端幅 (m)'], ['base_width_m', '底幅 (m)'],
  ['upstream_depth_m', '上流水深 (m)'], ['downstream_depth_m', '下流水深 (m)'],
  ['concrete_unit_weight_kn_m3', 'コンクリート単位体積重量 (kN/m³)'],
  ['water_unit_weight_kn_m3', '水単位体積重量 (kN/m³)'], ['friction_coefficient', '基礎摩擦係数'],
];
const spillFields: [keyof Spillway, string][] = [
  ['crest_elevation_m', '越流頂・基礎面から (m)'], ['effective_width_m', '有効越流幅 (m)'], ['coefficient_m_half_s', '越流係数 C (m^0.5/s)'],
];
const forceRows: [keyof Statics, string, string][] = [
  ['weight_kn_m', '堤体自重 W', 'kN/m'], ['upstream_horizontal_kn_m', '上流静水圧 Pu', 'kN/m'],
  ['downstream_horizontal_kn_m', '下流静水圧 Pd', 'kN/m'], ['downstream_vertical_kn_m', '下流斜面の鉛直力', 'kN/m'],
  ['uplift_kn_m', '揚圧力 U', 'kN/m'], ['effective_vertical_kn_m', '有効鉛直力 N', 'kN/m'],
  ['net_horizontal_kn_m', '水平力の差', 'kN/m'], ['resisting_moment_knm_m', '抵抗モーメント', 'kN·m/m'],
  ['overturning_moment_knm_m', '転倒モーメント', 'kN·m/m'], ['resultant_x_m', '合力位置・上流端から', 'm'],
  ['eccentricity_m', '偏心・下流側が正', 'm'], ['heel_pressure_kpa', '上流端の接触圧', 'kPa'], ['toe_pressure_kpa', '下流端の接触圧', 'kPa'],
];

function Section({ conditions, run, baseline }: { conditions: DamConditions; run: DamRun | null; baseline: DamRun | null }) {
  const d = conditions.dam;
  if (![d.height_m, d.base_width_m, d.crest_width_m, d.upstream_depth_m, d.downstream_depth_m].every(Number.isFinite) || d.height_m <= 0 || d.base_width_m <= 0 || d.crest_width_m > d.base_width_m) return <p className="muted">有限の寸法・水深を入力すると断面を表示します。</p>;
  const maxH = Math.max(d.height_m, baseline?.conditions.dam.height_m ?? 0);
  const maxB = Math.max(d.base_width_m, baseline?.conditions.dam.base_width_m ?? 0);
  const scale = Math.min(450 / maxB, 265 / maxH);
  const x = (v: number) => 135 + v * scale;
  const y = (v: number) => 325 - v * scale;
  const path = (v: GravityDam) => `M${x(0)} ${y(0)} L${x(v.base_width_m)} ${y(0)} L${x(v.crest_width_m)} ${y(v.height_m)} L${x(0)} ${y(v.height_m)} Z`;
  const downstreamX = d.base_width_m - (d.base_width_m - d.crest_width_m) * d.downstream_depth_m / d.height_m;
  const slope = (d.base_width_m - d.crest_width_m) / d.height_m;
  const tailX = x(d.base_width_m - slope * d.downstream_depth_m / 3);
  const tailY = y(d.downstream_depth_m / 3);
  const norm = Math.hypot(1, slope);
  return <svg className="dam-section" viewBox="0 0 760 425" role="img" aria-label="重力式ダムの断面と荷重図">
    <defs><marker id="dam-force" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="#cf714b" /></marker></defs>
    {[0, .25, .5, .75, 1].map(r => <g key={r}><line x1="45" x2="705" y1={y(maxH*r)} y2={y(maxH*r)} stroke="#e5edf1" /><text x="12" y={y(maxH*r)+4} fill="#7e8b97" fontSize="11">{fmt(maxH*r, 1)}</text></g>)}
    <path d={`M65 ${y(0)} H${x(0)} V${y(d.upstream_depth_m)} H65 Z`} fill="#b9e3ee" />
    <path d={`M${x(d.base_width_m)} ${y(0)} H700 V${y(d.downstream_depth_m)} H${x(downstreamX)} Z`} fill="#d1eaf1" />
    <path d={path(d)} fill="#a5b2bb" stroke="#546776" strokeWidth="2" />
    {baseline && <><path d={path(baseline.conditions.dam)} fill="none" stroke="#d09b48" strokeDasharray="6 4" strokeWidth="2" /><path d={`M65 ${y(baseline.conditions.dam.upstream_depth_m)} H${x(0)}`} fill="none" stroke="#d09b48" strokeDasharray="6 4" strokeWidth="2" /></>}
    <line x1="65" x2={x(0)} y1={y(d.upstream_depth_m)} y2={y(d.upstream_depth_m)} stroke="#208daf" strokeWidth="3" />
    <line x1={x(downstreamX)} x2="700" y1={y(d.downstream_depth_m)} y2={y(d.downstream_depth_m)} stroke="#208daf" strokeWidth="3" />
    <line x1={x(0)} x2={x(d.crest_width_m)} y1={y(conditions.spillway.crest_elevation_m)} y2={y(conditions.spillway.crest_elevation_m)} stroke="#5875a3" strokeDasharray="4 3" />
    {run && <g stroke="#cf714b" strokeWidth="2" markerEnd="url(#dam-force)">
      <line x1={x(run.statics.centroid_x_m)} x2={x(run.statics.centroid_x_m)} y1={y(run.statics.centroid_z_m)+5} y2={y(run.statics.centroid_z_m)+45} />
      {d.upstream_depth_m > 0 && <line x1={x(0)-55} x2={x(0)-4} y1={y(d.upstream_depth_m/3)} y2={y(d.upstream_depth_m/3)} />}
      {d.downstream_depth_m > 0 && <line x1={tailX+50/norm} x2={tailX+4/norm} y1={tailY-50*slope/norm} y2={tailY-4*slope/norm} />}
      {run.statics.uplift_x_m != null && <line x1={x(run.statics.uplift_x_m)} x2={x(run.statics.uplift_x_m)} y1={y(0)+45} y2={y(0)+5} />}
    </g>}
    {run?.statics.resultant_x_m != null && run.statics.resultant_x_m >= 0 && run.statics.resultant_x_m <= d.base_width_m && <circle cx={x(run.statics.resultant_x_m)} cy={y(0)} r="5" fill="#bc6544" />}
    <line x1="45" x2="715" y1={y(0)} y2={y(0)} stroke="#304959" strokeWidth="2" />
    <text x="65" y="32" fill="#208daf" fontSize="12">上流 {fmt(d.upstream_depth_m)} m</text><text x="500" y="32" fill="#208daf" fontSize="12">下流 {fmt(d.downstream_depth_m)} m</text>
    <text x="130" y="402" fontSize="12" fill="#546776">x=0 · 上流端</text><text x="485" y="402" fontSize="12" fill="#546776">基礎面 z=0 · 底幅 {fmt(d.base_width_m)} m</text>
  </svg>;
}

function Pressure({ run, baseline }: { run: DamRun; baseline: DamRun | null }) {
  const cases = [{ name: '現在', run, color: '#2885a0' }, ...(baseline ? [{ name: '基準', run: baseline, color: '#d09b48' }] : [])];
  const valid = cases.filter(c => c.run.statics.contact === 'full');
  if (!valid.length) return <p className="muted">全幅接触を成立させられないため接触圧分布は表示しません。</p>;
  const maxB = Math.max(...cases.map(c => c.run.conditions.dam.base_width_m));
  const maxP = Math.max(1, ...valid.flatMap(c => [c.run.statics.heel_pressure_kpa!, c.run.statics.toe_pressure_kpa!]));
  return <svg viewBox="0 0 760 200" role="img" aria-label="基礎の接触圧分布">
    <line x1="65" y1="150" x2="700" y2="150" stroke="#aab6bf" />
    <text x="12" y="30" fontSize="12" fill="#667987">kPa</text><text x="65" y="182" fontSize="12" fill="#667987">上流端 x=0</text><text x="620" y="182" fontSize="12" fill="#667987">x (m)</text>
    {valid.map(c => { const end = 65+600*c.run.conditions.dam.base_width_m/maxB; const heel = 150-110*c.run.statics.heel_pressure_kpa!/maxP; const toe = 150-110*c.run.statics.toe_pressure_kpa!/maxP; return <g key={c.name}><path d={`M65 150 V${heel} L${end} ${toe} V150 Z`} fill={c.color} fillOpacity=".1" stroke={c.color} strokeWidth="2" /><text x={100+cases.indexOf(c)*220} y="20" fontSize="12" fill={c.color}>{c.name} {fmt(c.run.statics.heel_pressure_kpa)} → {fmt(c.run.statics.toe_pressure_kpa)} kPa</text></g>; })}
  </svg>;
}

export default function DamAnalysis() {
  const [conditions, setConditions] = useState<DamConditions | null>(null);
  const [saved, setSaved] = useState<StoredDam | null>(null);
  const [baseline, setBaseline] = useState<StoredDam | null>(null);
  const [history, setHistory] = useState<DamHistory>({ items: [], next_before: null });
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { let alive = true; Promise.all([api<DamConditions>('/dams/sample'), api<DamHistory>('/dams/runs')]).then(([input, past]) => { if (alive) { setConditions(input); setHistory(past); } }).catch(e => { if (alive) setError((e as Error).message); }); return () => { alive = false; }; }, []);
  async function task(fn: () => Promise<void>) { setBusy(true); setError(''); setNotice(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  function edit(input: DamConditions) { setConditions(input); setSaved(null); setConfirmed(false); setError(''); setNotice('条件を変更しました。確認して再計算してください。'); }
  const run = saved?.run ?? null;
  const base = baseline?.run ?? null;
  const finite = conditions && [...Object.values(conditions.dam), ...Object.values(conditions.spillway)].every(Number.isFinite);
  async function exportRun(kind: 'csv' | 'html' | 'json') {
    if (!saved) return;
    await task(async () => {
      if (kind === 'json') { saveBlob(new Blob([JSON.stringify(saved, null, 2)], { type: 'application/json' }), `doboku-dam-${saved.id}.json`); }
      else { const response = await fetch(`/api/dams/runs/${saved.id}/reports/${kind}`); if (!response.ok) throw new Error(await response.text()); saveBlob(await response.blob(), `doboku-dam-${saved.id}.${kind}`); }
      setNotice('保存結果・元の実行日時で出力しました。');
    });
  }
  return <div className="dam-workspace">
    <div className="dam-scope"><Shield size={20} /><div><strong>重力式ダム · 静力学と自由越流の予備照査</strong><p>上流面鉛直の台形剛体・堤軸方向1 m。自重、静水圧、全幅線形揚圧、摩擦のみ。地震・FEM・アーチ・材料強度・設計基準の安全判定は未対応。3D施設ギャラリーとは別条件です。</p></div></div>
    {error && <div role="alert" className="alert error"><AlertCircle size={18} />{error}</div>}
    {notice && <p role="status" className="dam-notice">{notice}</p>}
    {!conditions ? <section className="panel">{error ? 'API接続後にページを再読み込みしてください。' : 'ダムのサンプル条件を読み込んでいます…'}</section> : <div className="dam-layout">
      <section className="panel dam-inputs"><div className="panel-heading"><h2>計算条件</h2><span className="badge">SI / 基礎面 z=0</span></div>
        <label className="field"><span>照査名</span><input value={conditions.name} disabled={busy} onChange={e => edit({ ...conditions, name: e.target.value })} /></label>
        <fieldset disabled={busy}><legend>非越流部の構造断面</legend><div className="dam-fields">{damFields.map(([key, label]) => <NumberField key={key} label={label} value={conditions.dam[key]} onChange={v => edit({ ...conditions, dam: { ...conditions.dam, [key]: v } })} />)}</div></fieldset>
        <fieldset disabled={busy}><legend><Waves size={15} /> 自由越流の容量条件</legend><div className="dam-fields">{spillFields.map(([key, label]) => <NumberField key={key} label={label} value={conditions.spillway[key]} onChange={v => edit({ ...conditions, spillway: { ...conditions.spillway, [key]: v } })} />)}</div></fieldset>
        <p className="muted">係数・摩擦係数は合成サンプルの例示値です。条件に応じた根拠を確認して指定してください。揚圧は排水による低減なし、粘着力は0です。</p>
        <label className="dam-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} /><span>条件と適用範囲を確認しました</span></label>
        <button className="primary" disabled={!confirmed || !finite || busy} onClick={() => task(async () => {
          setSaved(null); const result = await api<StoredDam>('/dams/runs', { conditions, confirmed: true }); setSaved(result); setHistory(await api<DamHistory>('/dams/runs')); setNotice(`ダム照査 #${result.id} を計算・保存しました。設計基準の適合判定は行っていません。`);
        })}><Play size={15} />{busy ? '処理中…' : '条件を確認して計算'}</button>
      </section>
      <div className="dam-results">
        <section className="panel"><div className="panel-heading"><h2>断面・荷重</h2><span className="badge">{run ? 'Rust 計算結果' : '条件のプレビュー'}</span></div><Section conditions={conditions} run={run} baseline={base} />
          <p className="muted">水平・鉛直は同じ縮尺。矢印は自重・水圧合力・揚圧の方向で、長さは大きさを表しません。下流水圧は斜面に垂直で下向き成分を含みます。橙の破線は基準条件です。</p>
        </section>
        {run && <>
          <div className="dam-metrics">
            <div><span>自由越流容量</span><strong data-testid="dam-discharge">{fmt(run.overflow.discharge_m3_s)}</strong><small>m³/s · 水頭 {fmt(run.overflow.head_m)} m</small></div>
            <div><span>滑動比 μN / ΔP</span><strong data-testid="dam-sliding">{fmt(run.statics.sliding_ratio, 3)}</strong><small>摩擦のみ · 判定基準なし</small></div>
            <div><span>転倒比 Mr / Mo</span><strong>{fmt(run.statics.overturning_ratio, 3)}</strong><small>下流端まわり · 判定基準なし</small></div>
          </div>
          <section className="panel"><div className="panel-heading"><h2>基礎の接触</h2><span className={`badge ${run.statics.contact !== 'full' ? 'dam-diagnostic' : ''}`}>{contactLabels[run.statics.contact]}</span></div><Pressure run={run} baseline={base} /><p className="muted">中央1/3を外れる場合、全幅線形接触圧は適用範囲外です。部分接触の圧は計算していません。</p></section>
          <section className="panel"><div className="panel-heading"><h2>数値結果 {base ? '・基準との比較' : ''}</h2><button className="secondary" disabled={busy} onClick={() => { setBaseline(structuredClone(saved)); setNotice('保存結果を比較の基準に固定しました。'); }}><Pin size={14} />基準に固定</button></div>
            {baseline && <p className="dam-baseline">基準 #{baseline.id} · {baseline.run.conditions.name} · {date(baseline.run.executed_at)} JST <button className="text-button" onClick={() => setBaseline(null)}>基準を解除</button></p>}
            <div className="table-scroll"><table className="dam-table"><thead><tr><th>項目</th><th>単位</th>{base && <th>基準</th>}<th>現在</th>{base && <th>差・現在−基準</th>}</tr></thead><tbody>
              {([['自由越流容量', 'm³/s', run.overflow.discharge_m3_s, base?.overflow.discharge_m3_s], ['滑動比', '1', run.statics.sliding_ratio, base?.statics.sliding_ratio], ['転倒比', '1', run.statics.overturning_ratio, base?.statics.overturning_ratio]] as [string, string, number | null, number | null | undefined][]).map(([label, unit, current, previous]) => <tr key={label}><td>{label}</td><td>{unit}</td>{base && <td>{fmt(previous, 3)}</td>}<td>{fmt(current, 3)}</td>{base && <td>{current != null && previous != null ? fmt(current-previous, 3) : '—'}</td>}</tr>)}
              {forceRows.map(([key, label, unit]) => { const current = run.statics[key] as number | null; const previous = base?.statics[key] as number | null | undefined; return <tr key={key}><td>{label}</td><td>{unit}</td>{base && <td>{fmt(previous, 3)}</td>}<td>{fmt(current, 3)}</td>{base && <td>{current != null && previous != null ? fmt(current-previous, 3) : '—'}</td>}</tr>; })}
            </tbody></table></div>
            <div className="dam-exports">{(['json', 'csv', 'html'] as const).map(kind => <button className="secondary" key={kind} disabled={busy} onClick={() => exportRun(kind)}><Download size={14} />{kind.toUpperCase()}を保存</button>)}</div>
            {base && <p className="muted">CSV/HTML/JSONは現在の1件の保存結果を出力します。比較表の差は画面上の表示です。基準の成果は履歴から個別に出力できます。</p>}
            <p className="muted">#{saved!.id} · {date(run.executed_at)} JST · engine {run.engine_version} / {run.structural_model_version} / {run.hydraulic_model_version}</p>
          </section>
          <section className="panel dam-notes"><h2>計算の適用範囲・診断</h2><p>{run.note}</p>{[...run.statics.warnings, ...run.overflow.warnings].map(w => <p key={w}>{w}</p>)}</section>
        </>}
        {!run && baseline && <p className="dam-baseline">基準 #{baseline.id} の条件・結果は固定されています。変更した条件を計算すると比較を表示します。</p>}
      </div>
    </div>}
    <section className="panel dam-history"><div className="panel-heading"><h2><History size={17} /> ダム照査の保存履歴</h2><span className="badge">再計算せず復元</span></div>
      {!history.items.length && <p className="muted">確認して計算すると、条件・結果・版・日時をSQLiteに保存します。</p>}
      <div className="dam-history-items">{history.items.map(item => <button key={item.id} className="secondary" disabled={busy} onClick={() => task(async () => { const snapshot = await api<StoredDam>(`/dams/runs/${item.id}`); setConditions(snapshot.run.conditions); setSaved(snapshot); setConfirmed(false); setNotice(`履歴 #${item.id} の条件・保存結果を復元しました。再計算していません。`); })}><strong>#{item.id} · {item.name}</strong><span>上流水深 {item.upstream_depth_m} m · {date(item.executed_at)} JST</span></button>)}</div>
      {history.next_before && <button className="secondary" disabled={busy} onClick={() => task(async () => { const past = await api<DamHistory>(`/dams/runs?before=${history.next_before}`); setHistory({ items: [...history.items, ...past.items], next_before: past.next_before }); })}>以前の履歴を表示</button>}
    </section>
  </div>;
}
