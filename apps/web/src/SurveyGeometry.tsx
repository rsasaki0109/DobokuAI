import { useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ground, type Station } from './types';
import { SectionChart } from './Charts';

type Range = { lower: number; upper: number };
export type GeometryPreview = {
  sections: {
    id: string;
    line: number | null;
    station: Station;
    connected_depth_ranges: Range[];
  }[];
  transitions: {
    upstream_chainage: number;
    downstream_chainage: number;
    bed_slope: number | null;
    reference_depth: number | null;
    upstream_width: number | null;
    downstream_width: number | null;
    width_ratio: number | null;
    issues: string[];
  }[];
  can_import: boolean;
  note: string;
};
const f = (n: number | null, digits = 4) => n === null ? '—' : n.toLocaleString('ja-JP', { maximumFractionDigits: digits });

export function SurveyGeometry({ geometry, verticalDatum }: { geometry: GeometryPreview; verticalDatum: string }) {
  const [index, setIndex] = useState(0);
  const selected = geometry.sections[index];
  const plot = useMemo(() => {
    const points = geometry.sections.flatMap(s => ground(s.station.section, s.station.bed_elevation));
    const rows = geometry.sections.map(({ id, station }) => {
      const g = ground(station.section, station.bed_elevation);
      return { id, x: station.chainage, bed: station.bed_elevation, left: g[0].z, right: g.at(-1)!.z };
    });
    const bounds = {
        xmin: Math.min(...points.map(p => p.x)),
        xmax: Math.max(...points.map(p => p.x)),
        ymin: Math.min(...points.map(p => p.z)) - 0.5,
        ymax: Math.max(...points.map(p => p.z)) + 0.5,
    };
    const spans = [bounds.xmax - bounds.xmin, bounds.ymax - bounds.ymin, rows.at(-1)!.x - rows[0].x];
    return { rows, bounds, drawable: spans.every(n => Number.isFinite(n) && n > 0) };
  }, [geometry]);
  return <section aria-label="取込み前の幾何点検" className="survey-geometry">
    <h3>全断面・遷移の幾何点検</h3>
    <p className="muted">{geometry.note}</p>
    <p>標高基準: {verticalDatum}。横断図の軸範囲は全断面で共通です。横断xは入力値を保持し、中心合わせは行いません。</p>
    <div className="table-scroll"><table>
      <thead><tr><th>断面ID / CSV行</th><th>流下距離 m</th><th>河床標高 m</th><th>粗度 n</th><th>元の点数</th><th>連続水面の水深 m（端点除外）</th></tr></thead>
      <tbody>{geometry.sections.map(s => <tr key={s.id}>
        <td>{s.id} / {s.line ?? '—'}</td><td>{f(s.station.chainage)}</td><td>{f(s.station.bed_elevation)}</td><td>{s.station.roughness}</td>
        <td>{s.station.section.kind === 'survey' ? s.station.section.points.length : '—'}</td>
        <td>{s.connected_depth_ranges.map(r => `(${f(r.lower)}, ${f(r.upper)})`).join(' ∪ ') || '—'}</td>
      </tr>)}</tbody>
    </table></div>
    <label className="field">
      <span>取込みプレビューの断面</span>
      <select value={index} onChange={e => setIndex(Number(e.target.value))}>
        {geometry.sections.map((s, i) => <option key={s.id} value={i}>{s.id} · {f(s.station.chainage)} m</option>)}
      </select>
    </label>
    <p role="status">表示断面: {selected.id} · {f(selected.station.chainage)} m · 元点列を保持</p>
    {plot.drawable ? <SectionChart station={selected.station} analysis={null} index={index} bounds={plot.bounds} groundLabel="CSV入力地盤" /> : <p role="alert">座標範囲を図に表示できません。入力値を確認してください。点検JSONは保存できます。</p>}
    <h3>取込み地盤の縦断図</h3>
    <p className="muted">水位は未計算です。河床標高と入力横断の両端高を表示します。両端高が現地の堤防天端であるとは判定しません。</p>
    {plot.drawable && <div className="chart" aria-label="取込み地盤の縦断図（未計算）">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={plot.rows} margin={{ top: 15, right: 20, bottom: 12, left: 8 }}>
          <CartesianGrid strokeDasharray="3 5" stroke="#e6eae7" />
          <XAxis type="number" dataKey="x" domain={['dataMin', 'dataMax']} label={{ value: '上流 → 下流 / 距離 (m)', position: 'insideBottom', offset: -8 }} />
          <YAxis domain={[plot.bounds.ymin, plot.bounds.ymax]} width={70} label={{ value: '標高 (m)', angle: -90, position: 'insideLeft' }} />
          <Tooltip formatter={value => f(Number(value))} labelFormatter={value => `流下距離 ${value} m`} />
          <Legend wrapperStyle={{ paddingTop: 15 }} />
          <Line dataKey="bed" name="入力河床" stroke="#879077" strokeWidth={2.5} isAnimationActive={false} />
          <Line dataKey="left" name="横断の左端" stroke="#a7865d" strokeDasharray="5 4" isAnimationActive={false} />
          <Line dataKey="right" name="横断の右端" stroke="#7a91a4" strokeDasharray="5 4" isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>}
    <h3>全隣接区間の適用制限</h3>
    <div className="table-scroll"><table>
      <thead><tr><th>区間</th><th>河床勾配</th><th>幅評価水深 m</th><th>上流幅 m</th><th>下流幅 m</th><th>幅比</th><th>診断・断面確認</th></tr></thead>
      <tbody>{geometry.transitions.map((t, i) => <tr key={t.upstream_chainage}>
        <td>{geometry.sections[i].id} → {geometry.sections[i + 1].id}<br />{f(t.upstream_chainage)} → {f(t.downstream_chainage)} m</td>
        <td>{f(t.bed_slope, 6)}</td><td>{f(t.reference_depth)}</td><td>{f(t.upstream_width)}</td><td>{f(t.downstream_width)}</td><td>{f(t.width_ratio)}</td>
        <td>{t.issues.join(' / ') || '通過'}<br /><button type="button" className="text-button" onClick={() => setIndex(i + 1)}>下流断面を表示: {geometry.sections[i + 1].id}</button></td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}
