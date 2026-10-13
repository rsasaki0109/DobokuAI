import type { GradingSweep } from './cityGradingSweep';

export default function CityGradingSweepView({ sweep, onSelect }: { sweep: GradingSweep; onSelect?: (target:number)=>void }) {
  return <div>
    <p>基準案 {sweep.baseline.conditions.target_elevation_m} m / 計算成功 {sweep.outcomes.filter(v=>v.status==='calculated').length}・失敗 {sweep.outcomes.filter(v=>v.status==='failed').length} / 指定 {sweep.targets.length} 標高。差は各案−基準案です。</p>
    <div className="city-sections">{(['east_west','south_north'] as const).map(axis=>{
      const name=axis==='east_west'?'東西':'南北',complete=sweep.baseline[axis].complete;
      const values=sweep.outcomes.flatMap(o=>o.status==='calculated'?[{target:o.target_elevation_m,cut:complete?o.run[axis].cut_area_m2!:o.run[axis].known_cut_area_m2,fill:complete?o.run[axis].fill_area_m2!:o.run[axis].known_fill_area_m2}]:[]);
      const lo=Math.min(...sweep.targets),hi=Math.max(...sweep.targets),maximum=Math.max(1,...values.flatMap(v=>[v.cut,v.fill]));
      const x=(h:number)=>lo===hi?320:65+510*(h-lo)/(hi-lo),y=(area:number)=>245-220*(area/maximum);
      return <div key={axis} className="city-review"><h4>{name}：{complete?'全長の断面積':'一意な区間の小計（全長は未算定）'}</h4>
        <p>赤：切土 / 青：盛土。計算した点だけを示し、点の間を補間しません。</p>
        {values.length?<svg viewBox="0 0 610 310" role="img" aria-label={`${name}の標高と断面積の比較`} data-area-kind={complete?'complete':'known_subtotal'} style={{width:'100%',display:'block'}}>
          <title>{`${name}の標高と断面積の比較`}</title>
          {[0,.25,.5,.75,1].map(f=><g key={f}><path d={`M65 ${y(maximum*f)}H575`} stroke="#cbd7d0"/><text x="60" y={y(maximum*f)+4} textAnchor="end" fontSize="11">{(maximum*f).toPrecision(4)}</text></g>)}
          {[...sweep.targets].sort((a,b)=>a-b).map(h=><text key={h} x={x(h)} y="265" textAnchor="middle" fontSize="10">{h}</text>)}
          {values.map(v=><g key={v.target}>{(['cut','fill'] as const).map(kind=><circle key={kind} data-sweep-target={v.target} data-sweep-area={kind} cx={x(v.target)} cy={y(v[kind])} r={kind==='cut'?6:4} fill={kind==='cut'?'#ba5d40':'#397ea7'} stroke="white" onClick={onSelect?()=>onSelect(v.target):undefined}><title>{`${v.target} m / ${kind==='cut'?'切土':'盛土'} ${v[kind]} m² / ${complete?'全長':'一意な区間の小計'}`}</title></circle>)}</g>)}
          <text x="65" y="15" fontSize="11">{complete?'全長面積':'一意な区間の小計'} (m²)</text><text x="320" y="291" textAnchor="middle" fontSize="12">計画標高 (m / 原データ基準)</text>
        </svg>:<p>成功した計算がなく、面積の点を表示できません。</p>}
      </div>;
    })}</div>
    <div style={{overflowX:'auto'}}><table aria-label="複数標高の断面積一覧"><thead><tr><th>標高 (m)</th><th>軸</th><th>状態</th><th>全長切土/盛土 (m²)</th><th>一意な区間の小計 (m²)</th><th>全長切土/盛土差 (m²)</th><th>一意な区間の小計差 (m²)</th><th>一意/欠損/曖昧な長さ (m)・未解決点</th><th>計算日時・理由</th>{onSelect&&<th>断面図</th>}</tr></thead><tbody>{sweep.outcomes.flatMap(o=>(['east_west','south_north'] as const).map((axis,i)=>{
      const q=o.status==='calculated'?o.run[axis]:null,d=o.status==='calculated'?o.differences[i]:null;
      return <tr key={`${o.target_elevation_m}:${axis}`} data-sweep-row={`${o.target_elevation_m}:${axis}`}><th>{o.target_elevation_m}</th><td>{axis==='east_west'?'東西':'南北'}</td><td>{q?'計算済み':'計算失敗'}</td><td>{q?(q.complete?`${q.cut_area_m2} / ${q.fill_area_m2}`:'未算定'):'—'}</td><td>{q?`${q.known_cut_area_m2} / ${q.known_fill_area_m2}`:'—'}</td><td>{d?(d.complete?`${d.cut_area_delta_m2} / ${d.fill_area_delta_m2}`:'未算定'):'—'}</td><td>{d?`${d.known_cut_area_delta_m2} / ${d.known_fill_area_delta_m2}`:'—'}</td><td>{q?`${q.known_length_m} / ${q.uncovered_length_m} / ${q.ambiguous_length_m}・${q.unresolved_point_count}点`:'—'}</td><td>{o.status==='calculated'?o.run.executed_at:o.error}</td>{onSelect&&<td>{i===0&&<button type="button" className="secondary" disabled={o.status==='failed'} onClick={()=>onSelect(o.target_elevation_m)}>標高{o.target_elevation_m}mの断面比較を表示</button>}</td>}</tr>;
    }))}</tbody></table></div>
  </div>;
}
