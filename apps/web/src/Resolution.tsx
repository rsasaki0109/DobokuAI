import { useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, colors, saveBlob, type Project, type River, type Profile } from './types';

type Difference = { chainage: number; water_change: number; depth_change: number; velocity_change: number };
type Outcome =
  | { status: 'ok'; subdivisions: number; river: River; profile: Profile; differences: Difference[];
      max_abs_water_change: number; previous_max_abs_water_change: number | null }
  | { status: 'failed'; subdivisions: number; error: string };
export type ResolutionResult = {
  project: Project; engine_version: string; executed_at: string; note: string;
  study: { baseline: Profile; cases: Outcome[] };
};
function csv(result: ResolutionResult) {
  // Text cells are quoted and formula-protected; signed numerical values stay numbers.
  const text = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`;
  const prefix = [result.engine_version, result.executed_at, result.project.name, result.project.reference.vertical_datum].map(text);
  const suffix = [JSON.stringify(result.project), result.note].map(text);
  const lines = ['engine_version,study_executed_at,project,vertical_datum,subdivisions,status,error,chainage_m,water_elevation_m,water_change_m,depth_change_m,velocity_change_m,conditions_json,project_json,note'];
  const add = (factor: number, profile: Profile | null, river: River | null, differences: Difference[], error = '') => {
    if (!profile) {
      lines.push([...prefix, factor, 'failed', text(error), '', '', '', '', '', '', ...suffix].join(','));
      return;
    }
    result.study.baseline.rows.forEach((_, i) => {
      const row = profile.rows[i * factor];
      const d = differences[i];
      lines.push([...prefix, factor, 'ok', text(''), row.chainage, row.water_elevation,
        d?.water_change ?? 0, d?.depth_change ?? 0, d?.velocity_change ?? 0,
        text(JSON.stringify(river)), ...suffix].join(','));
    });
  };
  add(1, result.study.baseline, result.project.river, []);
  for (const outcome of result.study.cases) {
    if (outcome.status === 'ok') add(outcome.subdivisions, outcome.profile, outcome.river, outcome.differences);
    else add(outcome.subdivisions, null, null, [], outcome.error);
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

export function Resolution({ project, task }: {
  project: Project; task: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<ResolutionResult | null>(null);
  const successful = result?.study.cases.filter((c): c is Extract<Outcome, {status: 'ok'}> => c.status === 'ok') ?? [];
  const rows = result?.study.baseline.rows.map((row, i) => ({
    chainage: row.chainage,
    ...Object.fromEntries(successful.map(c => [`case${c.subdivisions}`, c.differences[i].water_change])),
  }));
  return (
    <section className="panel resolution-panel">
      <div className="panel-heading">
        <div><div className="eyebrow">STATION SPACING / INTERPOLATED MODEL</div><h2>測点間隔による結果差</h2></div>
        <span className="badge">元の条件を保持</span>
      </div>
      <p className="muted">
        各区間を2分割・4分割して、同じ元測点の水位・水深・流速の差を比較します。
        河床標高・粗度、矩形/台形の寸法は線形補間します。測量断面は点数・横断x・最低点の位置の一致が必要です。
        異なる断面形式の間は補間しません。各計算は200断面・間隔0.1 m以上に制限します。
      </p>
      <p className="muted">
        流量・境界水深・流況を固定し、施工案は適用しません。補間点は追加の測量ではありません。
        結果差が小さくても実河川の精度や収束を保証しません。
      </p>
      <label className="check">
        <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
        測点間を線形補間する前提を確認しました
      </label>
      <button className="secondary" disabled={!confirmed} onClick={() => void task(async () => {
        setResult(null);
        setResult(await api<ResolutionResult>('/resolution', {project, confirmed_interpolation: true}));
      })}>基本条件を保持して測点間隔を比較</button>
      {result && <>
        <p role="status">測点間隔の比較完了: 成功 {successful.length} / 失敗 {result.study.cases.length - successful.length}。基本条件は変更していません。</p>
        <p className="muted">{result.note}</p>
        <p className="muted">比較日時 {result.executed_at} · engine {result.engine_version} · 元の断面数 {result.project.river.stations.length}</p>
        {successful.length > 0 && <div className="chart" aria-label="測点細分化による元測点の水位差">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{top:15,right:20,bottom:12,left:8}}>
              <CartesianGrid strokeDasharray="3 5" />
              <XAxis dataKey="chainage" type="number" domain={['dataMin','dataMax']} label={{value:'流下距離 (m)',position:'insideBottom',offset:-8}} />
              <YAxis domain={['auto','auto']} tickFormatter={v => Number(v).toExponential(1)} label={{value:'元の計算からの水位差 (m)',angle:-90,position:'insideLeft'}} width={100} />
              <Tooltip formatter={v => `${Number(v).toExponential(6)} m`} />
              <Legend wrapperStyle={{paddingTop:15}} />
              {successful.map((c,i) => <Line key={c.subdivisions} dataKey={`case${c.subdivisions}`} name={`${c.subdivisions}分割 − 元の計算`} stroke={colors[i]} dot={false} isAnimationActive={false} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>}
        <div className="table-scroll"><table><thead><tr><th>分割</th><th>断面数</th><th>判定</th><th>元の計算からの最大絶対水位差 m</th><th>直前の分割からの最大絶対水位差 m / 診断</th></tr></thead>
          <tbody>{result.study.cases.map(c => <tr key={c.subdivisions}>
            <td>{c.subdivisions}分割</td><td>{c.status === 'ok' ? c.river.stations.length : '—'}</td><td>{c.status === 'ok' ? '成功' : '失敗'}</td>
            <td>{c.status === 'ok' ? c.max_abs_water_change.toExponential(6) : '—'}</td>
            <td>{c.status === 'ok' ? c.previous_max_abs_water_change?.toExponential(6) ?? '前の分割が失敗したため未比較' : c.error}</td>
          </tr>)}</tbody>
        </table></div>
        <p className="muted">2分割の直前は元の計算、4分割の直前は2分割です。すべて元測点で比較します。SQLite履歴には保存しません。再計算せず、この表示結果を出力します。</p>
        <button className="secondary" onClick={() => saveBlob(new Blob([JSON.stringify(result,null,2)],{type:'application/json'}),'doboku-resolution.json')}>測点間隔比較JSONを保存</button>
        <button className="secondary" onClick={() => saveBlob(new Blob([csv(result)],{type:'text/csv;charset=utf-8'}),'doboku-resolution.csv')}>測点間隔比較CSVを保存</button>
      </>}
    </section>
  );
}
