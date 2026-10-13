import type { TerrainSection } from './citySections';
import { citySectionColors } from './citySectionOverlay';
import { probeCitySection } from './citySectionProbe';
import type { GradingOverlay } from './cityGrading';

const defaultNames = { east_west: '東西', south_north: '南北' };
const labels = { unique: '高さが一意', uncovered: '地形なし', ambiguous: '高さが一意でない・鉛直面' };
export default function CitySectionsView({ sections, expanded = false, selection, onSelect, grading, comparisonTargets = [], names = defaultNames, directions, context = '反映済み範囲' }: {
  sections: TerrainSection[]; expanded?: boolean;
  selection?: { axis: TerrainSection['axis']; distance: number } | null;
  onSelect?: (selection: { axis: TerrainSection['axis']; distance: number } | null) => void;
  grading?: GradingOverlay;
  comparisonTargets?: number[];
  names?: Record<TerrainSection['axis'], string>;
  directions?: Record<TerrainSection['axis'], string>;
  context?: string;
}) {
  const name = names;
  const number = (value: number) => expanded ? String(value) : value.toFixed(6);
  return <div className="city-sections">{sections.map(s => {
    const color = citySectionColors[s.axis];
    const figureName = `${name[s.axis]}の${grading ? '切土・盛土断面' : '地形断面'}`;
    const distance = selection?.axis === s.axis ? selection.distance : undefined;
    const probe = distance === undefined ? null : probeCitySection(s, distance);
    const select = (distance: number) => onSelect?.({ axis: s.axis, distance });
    const elevations = [...s.points.flatMap(p => p.elevations), ...s.intervals.flatMap(v => v.curves.flatMap(c => [c.from, c.to]))];
    if (grading) elevations.push(grading.target_elevation_m);
    elevations.push(...comparisonTargets);
    let lo = Infinity, hi = -Infinity;
    for (const h of elevations) { lo = Math.min(lo, h); hi = Math.max(hi, h); }
    const padding = Math.max(.1, (hi - lo) * .05);
    const bottom = lo - padding, top = hi + padding;
    const x = (t: number) => 65 + 510 * t / s.length, y = (h: number) => 245 - 220 * (h - bottom) / (top - bottom);
    return <div key={s.axis} className="city-review" role="region" aria-label={`${name[s.axis]}の${grading ? '切土・盛土結果' : '断面結果'}`}>
      <h3>{name[s.axis]}の{grading ? '地形と計画標高' : '地形断面'}（{context}）</h3>
      <p>起点 東 {s.start.east.toFixed(3)}・北 {s.start.north.toFixed(3)} m → 終点 東 {s.end.east.toFixed(3)}・北 {s.end.north.toFixed(3)} m</p>
      <p>長さ {s.length} m / 地形なし {s.intervals.filter(v => v.status === 'uncovered').length} 区間 / 高さが一意でない {s.intervals.filter(v => v.status === 'ambiguous').length} 区間・{s.points.filter(p => p.status === 'ambiguous').length} 点</p>
      <p className="muted">{s.axis === 'east_west' ? '緑' : '青'}：一意な断面線 / 灰：欠損 / 橙：高さ候補を選べない区間 / 点線：判定点。縦横の縮尺は別です。</p>
      {grading && <p className="muted">赤の着色：切土 / 青の着色：盛土 / 紫の水平線：計画標高。断面積はRustの区分線形積分結果です。</p>}
      {onSelect && <>
        <div className="form-grid">
          <label className="field">{name[s.axis]}の照会距離 (m)<input aria-label={`${name[s.axis]}の照会距離 (m)`} type="number" min="0" max={s.length} step="any" value={distance ?? ''} onChange={e => e.target.value === '' ? onSelect(null) : select(Number(e.target.value))} /></label>
          <label className="field">{name[s.axis]}の交点を照会<select aria-label={`${name[s.axis]}の交点を照会`} value={probe?.kind === 'point' ? String(distance) : ''} onChange={e => e.target.value === '' ? onSelect(null) : select(Number(e.target.value))}><option value="">交点を選択</option>{s.points.map(p => <option key={p.distance} value={String(p.distance)}>{p.distance} m / {labels[p.status]}</option>)}</select></label>
        </div>
        <p className="muted">距離を入力、交点を選択、または図の中をクリックして照会できます。数値入力・交点選択はキーボードでも操作できます。</p>
        {distance !== undefined && !probe && <p role="alert">照会距離は0〜{s.length} mの有限値を指定してください。</p>}
        {probe && <div role="status" aria-label={`${name[s.axis]}の位置照会`}>
          <p>起点から {probe.distance} m / 東 {probe.east} m・北 {probe.north} m / {probe.kind === 'point' ? '交点の判定' : '区間内の判定'}：{labels[probe.status]}</p>
          <p>標高候補（原データ基準 m）：{probe.elevations.length ? JSON.stringify(probe.elevations) : 'なし'} / 参照地物ID：{JSON.stringify(probe.features)}</p>
          <p>{probe.status === 'unique' ? '一意な高さの位置を3Dの断面重ね表示で強調します。' : '高さを採用せず、3Dに位置の点を置きません。'}</p>
          <button type="button" className="secondary" onClick={() => onSelect(null)}>断面の位置照会を解除</button>
        </div>}
      </>}
      {elevations.length ? <svg viewBox="0 0 610 310" role="img" aria-label={figureName} data-section-height-range={`${bottom},${top}`} style={{ width: '100%', display: 'block' }} onClick={onSelect ? e => {
        const matrix = e.currentTarget.getScreenCTM(); if (!matrix) return;
        const p = e.currentTarget.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
        const local = p.matrixTransform(matrix.inverse());
        if (local.x >= 65 && local.x <= 575 && local.y >= 25 && local.y <= 245) select((local.x - 65) / 510 * s.length);
      } : undefined}>
        <title>{figureName}</title>
        {[0, .25, .5, .75, 1].map(f => <g key={f}><path d={`M65 ${25 + 220 * f}H575`} stroke="#cbd7d0" /><text x="60" y={29 + 220 * f} textAnchor="end" fontSize="11">{(top - (top - bottom) * f).toFixed(3)}</text></g>)}
        {grading && s.intervals.flatMap((v, i) => {
          if (v.status !== 'unique') return [];
          const row = grading[s.axis].spans[i], target = grading.target_elevation_m, c = v.curves[0];
          const vertices: [number, number][] = [[v.from, c.from]];
          if (row.crossing_distance_m !== null) vertices.push([row.crossing_distance_m, target]);
          vertices.push([v.to, c.to]);
          return vertices.slice(1).map((end, j) => {
            const start = vertices[j], cut = (start[1] + end[1]) / 2 > target;
            if (start[1] === target && end[1] === target) return null;
            return <path key={`${i}:${j}`} data-grading-area={cut ? 'cut' : 'fill'} d={`M${x(start[0])} ${y(target)}L${x(start[0])} ${y(start[1])}L${x(end[0])} ${y(end[1])}L${x(end[0])} ${y(target)}Z`} fill={cut ? '#d47b5f' : '#6aa7cd'} opacity=".5" />;
          });
        })}
        {s.intervals.map((v, i) => v.status === 'unique'
          ? <path key={i} data-terrain-line="true" d={`M${x(v.from)} ${y(v.curves[0].from)}L${x(v.to)} ${y(v.curves[0].to)}`} fill="none" stroke={color} strokeWidth="2" />
          : <rect key={i} data-section-status={v.status} x={x(v.from)} y="25" width={x(v.to) - x(v.from)} height="220" fill={v.status === 'uncovered' ? '#e0e5e1' : '#f1c8a0'} opacity=".7"><title>{`${labels[v.status]} / ${v.from}〜${v.to} m`}</title></rect>)}
        {s.points.map((p, i) => p.status === 'unique'
          ? <circle key={i} cx={x(p.distance)} cy={y(p.elevations[0])} r="2.5" fill={color} onClick={onSelect ? e => { e.stopPropagation(); select(p.distance); } : undefined}><title>{`${p.distance} m / 標高 ${p.elevations[0]} m`}</title></circle>
          : <path key={i} d={`M${x(p.distance)} 25V245`} stroke={p.status === 'ambiguous' ? '#ac652d' : '#8a9690'} strokeDasharray="3 3" onClick={onSelect ? e => { e.stopPropagation(); select(p.distance); } : undefined}><title>{`${labels[p.status]} / ${p.distance} m`}</title></path>)}
        {[0, .5, 1].map(f => <text key={f} x={x(s.length * f)} y="265" textAnchor="middle" fontSize="11">{(s.length * f).toFixed(3)}</text>)}
        <text x="320" y="291" textAnchor="middle" fontSize="12">起点からの距離 (m) · {directions?.[s.axis] ?? (s.axis === 'east_west' ? '西 → 東' : '南 → 北')}</text>
        <text x="65" y="15" fontSize="11">標高 (m / 原データ基準)</text>
        {grading && <path data-grading-target="true" d={`M65 ${y(grading.target_elevation_m)}H575`} stroke="#713e9c" strokeWidth="2" strokeDasharray="7 3"><title>{`計画標高 ${grading.target_elevation_m} m / 原データ基準`}</title></path>}
        {probe && <g data-section-probe={probe.status} pointerEvents="none">
          <path d={`M${x(probe.distance)} 25V245`} stroke="#713e9c" strokeWidth="2" strokeDasharray="5 3" />
          {probe.status === 'unique' && <circle cx={x(probe.distance)} cy={y(probe.elevations[0])} r="6" fill="#713e9c" stroke="white" strokeWidth="2" />}
        </g>}
      </svg> : <p>地形高さを表示できません。区間の判定を参照してください。</p>}
      <details open={expanded || undefined}><summary>断面の区間判定を確認（{s.intervals.length}区間）</summary><div style={{ overflowX: 'auto' }}><table aria-label={`${name[s.axis]}の区間判定`}><thead><tr><th>距離 (m)</th><th>判定</th><th>始点/終点の高さ候補 (m)</th>{expanded && <th>参照地物ID</th>}</tr></thead><tbody>{s.intervals.map((v, i) => <tr key={i}><td>{number(v.from)}〜{number(v.to)}</td><td>{labels[v.status]}</td><td>{v.curves.map(c => `${number(c.from)} → ${number(c.to)}`).join(' / ') || '—'}</td>{expanded && <td>{JSON.stringify(v.features)}</td>}</tr>)}</tbody></table></div></details>
      {expanded && <details open><summary>交点の判定（{s.points.length}点）</summary><div style={{ overflowX: 'auto' }}><table aria-label={`${name[s.axis]}の交点判定`}><thead><tr><th>距離 (m)</th><th>判定</th><th>標高候補 (m)</th><th>参照地物ID</th></tr></thead><tbody>{s.points.map((p, i) => <tr key={i}><td>{p.distance}</td><td>{labels[p.status]}</td><td>{JSON.stringify(p.elevations)}</td><td>{JSON.stringify(p.features)}</td></tr>)}</tbody></table></div></details>}
    </div>;
  })}</div>;
}
