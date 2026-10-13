import type { TerrainSection } from './citySections';

const name = { east_west: '東西', south_north: '南北' };
const labels = { unique: '高さが一意', uncovered: '地形なし', ambiguous: '高さが一意でない・鉛直面' };
export default function CitySectionsView({ sections }: { sections: TerrainSection[] }) {
  return <div className="city-sections">{sections.map(s => {
    const elevations = [...s.points.flatMap(p => p.elevations), ...s.intervals.flatMap(v => v.curves.flatMap(c => [c.from, c.to]))];
    let lo = Infinity, hi = -Infinity;
    for (const h of elevations) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
    const padding = Math.max(.1, (hi - lo) * .05);
    const bottom = lo - padding, top = hi + padding;
    const x = (t: number) => 65 + 510 * t / s.length, y = (h: number) => 245 - 220 * (h - bottom) / (top - bottom);
    return <div key={s.axis} className="city-review" role="region" aria-label={`${name[s.axis]}の断面結果`}>
      <h3>{name[s.axis]}の地形断面（反映済み範囲）</h3>
      <p>起点 東 {s.start.east.toFixed(3)}・北 {s.start.north.toFixed(3)} m → 終点 東 {s.end.east.toFixed(3)}・北 {s.end.north.toFixed(3)} m</p>
      <p>長さ {s.length} m / 地形なし {s.intervals.filter(v => v.status === 'uncovered').length} 区間 / 高さが一意でない {s.intervals.filter(v => v.status === 'ambiguous').length} 区間・{s.points.filter(p => p.status === 'ambiguous').length} 点</p>
      <p className="muted">緑：一意な断面線 / 灰：欠損 / 橙：高さ候補を選べない区間 / 点線：判定点。縦横の縮尺は別です。</p>
      {elevations.length ? <svg viewBox="0 0 610 310" role="img" aria-label={`${name[s.axis]}の地形断面`} style={{ width: '100%', display: 'block' }}>
        <title>{name[s.axis]}の地形断面</title>
        {[0, .25, .5, .75, 1].map(f => <g key={f}><path d={`M65 ${25 + 220 * f}H575`} stroke="#cbd7d0" /><text x="60" y={29 + 220 * f} textAnchor="end" fontSize="11">{(top - (top - bottom) * f).toFixed(3)}</text></g>)}
        {s.intervals.map((v, i) => v.status === 'unique'
          ? <path key={i} data-terrain-line="true" d={`M${x(v.from)} ${y(v.curves[0].from)}L${x(v.to)} ${y(v.curves[0].to)}`} fill="none" stroke="#346653" strokeWidth="2" />
          : <rect key={i} data-section-status={v.status} x={x(v.from)} y="25" width={x(v.to) - x(v.from)} height="220" fill={v.status === 'uncovered' ? '#e0e5e1' : '#f1c8a0'} opacity=".7"><title>{labels[v.status]} / {v.from}〜{v.to} m</title></rect>)}
        {s.points.map((p, i) => p.status === 'unique'
          ? <circle key={i} cx={x(p.distance)} cy={y(p.elevations[0])} r="2.5" fill="#346653"><title>{p.distance} m / 標高 {p.elevations[0]} m</title></circle>
          : <path key={i} d={`M${x(p.distance)} 25V245`} stroke={p.status === 'ambiguous' ? '#ac652d' : '#8a9690'} strokeDasharray="3 3"><title>{labels[p.status]} / {p.distance} m</title></path>)}
        {[0, .5, 1].map(f => <text key={f} x={x(s.length * f)} y="265" textAnchor="middle" fontSize="11">{(s.length * f).toFixed(3)}</text>)}
        <text x="320" y="291" textAnchor="middle" fontSize="12">起点からの距離 (m) · {s.axis === 'east_west' ? '西 → 東' : '南 → 北'}</text>
        <text x="65" y="15" fontSize="11">標高 (m / 原データ基準)</text>
      </svg> : <p>地形高さを表示できません。区間の判定を参照してください。</p>}
      <details><summary>断面の区間判定を確認（{s.intervals.length}区間）</summary><div style={{ overflowX: 'auto' }}><table><thead><tr><th>距離 (m)</th><th>判定</th><th>始点/終点の高さ候補 (m)</th></tr></thead><tbody>{s.intervals.map((v, i) => <tr key={i}><td>{v.from.toFixed(6)}〜{v.to.toFixed(6)}</td><td>{labels[v.status]}</td><td>{v.curves.map(c => `${c.from.toFixed(6)} → ${c.to.toFixed(6)}`).join(' / ') || '—'}</td></tr>)}</tbody></table></div></details>
    </div>;
  })}</div>;
}
