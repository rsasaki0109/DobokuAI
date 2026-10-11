import { useEffect, useRef, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, colors, saveBlob, type Project, type Run } from './types';
type Change = { parameter: 'discharge' | 'roughness'; value: number };
type Outcome =
  | { status: 'ok'; change: Change; run: Run; max_water_change: number }
  | { status: 'failed'; change: Change; error: string };
type Result = { project: Project; baseline: Run; cases: Outcome[]; note: string };
type Stored = { id: number; comparison: Result };
type Summary = {
  id: number;
  project_name: string;
  executed_at: string;
  engine_version: string;
  case_count: number;
  failed_count: number;
};
type Page = { items: Summary[]; next_before: number | null };
const label = (c: Change) =>
  `${c.parameter === 'discharge' ? '流量 Q' : '全断面粗度 n'} = ${c.value}${c.parameter === 'discharge' ? ' m³/s' : ''}`;
export function Sensitivity({
  project,
  task,
}: {
  project: Project;
  task: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [parameter, setParameter] = useState<Change['parameter']>('discharge');
  const [values, setValues] = useState('80, 100, 120');
  const [result, setResult] = useState<Result | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);
  const [history, setHistory] = useState<Page>({ items: [], next_before: null });
  const [revision, setRevision] = useState(0);
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(true);
  const historyGeneration = useRef(0);
  useEffect(() => {
    let alive = true;
    historyGeneration.current += 1;
    setHistoryError('');
    setHistoryLoading(true);
    api<Page>(`/projects/${encodeURIComponent(project.id)}/sensitivity-runs`)
      .then((page) => { if (alive) setHistory(page); })
      .catch((e) => { if (alive) setHistoryError((e as Error).message); })
      .finally(() => { if (alive) setHistoryLoading(false); });
    return () => { alive = false; historyGeneration.current += 1; };
  }, [project.id, revision]);
  async function exportReport(kind: 'html' | 'csv') {
    if (savedId === null) return;
    const response = await fetch(`/api/sensitivity/runs/${savedId}/reports/${kind}`);
    if (!response.ok) throw new Error(await response.text());
    saveBlob(await response.blob(), `doboku-sensitivity.${kind}`);
  }
  const valid =
    result?.cases.filter((c): c is Extract<Outcome, { status: 'ok' }> => c.status === 'ok') ?? [];
  const rows = result?.baseline.profile.rows.map((r, i) =>
    Object.fromEntries([
      ['chainage', r.chainage],
      ['baseline', r.water_elevation],
      ...valid.map((c, j) => [`case${j}`, c.run.profile.rows[i].water_elevation]),
    ]),
  );
  return (
    <section className="panel sensitivity-panel">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">SENSITIVITY / FIXED BOUNDARY</div>
          <h2>流量・粗度の感度比較</h2>
        </div>
      </div>
      <p className="muted">
        基本条件を保持して各案を独立計算。境界水深を固定し、粗度は全断面を置換します。施工案は適用しません。
      </p>
      <div className="form-grid">
        <label>
          感度比較パラメータ
          <select
            aria-label="感度比較パラメータ"
            value={parameter}
            onChange={(e) => {
              setParameter(e.target.value as Change['parameter']);
              setValues(e.target.value === 'discharge' ? '80, 100, 120' : '0.025, 0.03, 0.035');
              setResult(null);
              setSavedId(null);
            }}
          >
            <option value="discharge">流量 Q (m³/s)</option>
            <option value="roughness">全断面の粗度 n</option>
          </select>
        </label>
        <label>
          比較する値（カンマ区切り・最大8件）
          <input
            aria-label="感度比較の値"
            value={values}
            onChange={(e) => {
              setValues(e.target.value);
              setResult(null);
              setSavedId(null);
            }}
          />
        </label>
      </div>
      <button
        className="secondary"
        onClick={() =>
          void task(async () => {
            setResult(null);
            setSavedId(null);
            const tokens = values.split(',').map((s) => s.trim());
            if (
              tokens.length < 1 ||
              tokens.length > 8 ||
              tokens.some((s) => !s || !Number.isFinite(Number(s)))
            )
              throw new Error('比較値は有限の数値を1〜8件、カンマ区切りで入力してください');
            const stored = await api<Stored>('/sensitivity/runs', {
                project,
                cases: tokens.map((s) => ({ parameter, value: Number(s) })),
              });
            setResult(stored.comparison);
            setSavedId(stored.id);
            setRevision((n) => n + 1);
          })
        }
      >
        基本条件を保持して感度比較
      </button>
      {result && (
        <>
          <p role="status">
            感度比較完了: 成功 {valid.length} / 失敗 {result.cases.length - valid.length}
            。基本条件は変更していません。
          </p>
          <p className="muted">{result.note}</p>
          <p className="muted">
            感度比較の保存結果 #{savedId} · {result.project.name} · 基本計算日時{' '}
            {result.baseline.executed_at} · engine {result.baseline.engine_version}
            <br />
            保存時の標高系: {result.project.reference.vertical_datum} / 水平座標: {result.project.reference.horizontal_reference}
          </p>
          <div className="chart profile-chart" aria-label="感度比較の縦断水面形">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows}>
                <CartesianGrid strokeDasharray="3 5" />
                <XAxis
                  dataKey="chainage"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  label={{ value: '流下距離 (m)', position: 'insideBottom', offset: -8 }}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  label={{ value: '水位 (m)', angle: -90, position: 'insideLeft' }}
                />
                <Tooltip />
                <Legend />
                <Line
                  dataKey="baseline"
                  name="基本条件"
                  stroke="#258dc0"
                  dot={false}
                  isAnimationActive={false}
                />
                {valid.map((c, j) => (
                  <Line
                    key={j}
                    dataKey={`case${j}`}
                    name={label(c.change)}
                    stroke={colors[j % colors.length]}
                    dot={false}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>変更条件</th>
                  <th>判定</th>
                  <th>最大絶対変化地点の水位差 m / 診断</th>
                </tr>
              </thead>
              <tbody>
                {result.cases.map((c, i) => (
                  <tr key={i}>
                    <td>{label(c.change)}</td>
                    <td>{c.status === 'ok' ? '成功' : '失敗'}</td>
                    <td>{c.status === 'ok' ? c.max_water_change.toFixed(5) : c.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted">
            条件・基準高・各計算版・日時・失敗理由を保存しています。成果出力は保存結果を使用し、再計算しません。
          </p>
          <button
            className="secondary"
            onClick={() =>
              saveBlob(
                new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }),
                'doboku-sensitivity.json',
              )
            }
          >
            感度比較JSONを保存
          </button>
          <button className="secondary" onClick={() => void task(() => exportReport('csv'))}>
            感度比較CSVを保存
          </button>
          <button className="secondary" onClick={() => void task(() => exportReport('html'))}>
            感度比較HTMLを保存
          </button>
        </>
      )}
      <h3>感度比較の履歴</h3>
      <p className="muted">
        保存結果を開くと当時の比較を表示します。作業中の基本条件は変更しません。
        再比較は作業中の基本条件と上の比較値を使います。
      </p>
      <button className="secondary" disabled={historyLoading} onClick={() => setRevision((n) => n + 1)}>感度履歴を更新</button>
      {historyError && <p role="alert">感度履歴を取得できませんでした: {historyError}</p>}
      {!history.items.length && <p className="muted">{historyLoading ? '感度履歴を読み込んでいます…' : 'このプロジェクトの感度比較履歴はまだありません。'}</p>}
      <div className="history-list">
        {history.items.map((r) => (
          <article className="history-item" key={r.id}>
            <div>
              <strong>{r.project_name} · {r.case_count} 条件 · 失敗 {r.failed_count}</strong>
              <p>{r.executed_at} · engine {r.engine_version} · #{r.id}</p>
            </div>
            <button className="secondary" aria-label={`感度履歴 #${r.id} を開く`}
              onClick={() => void task(async () => {
                const stored = await api<Stored>(`/sensitivity/runs/${r.id}`);
                setResult(stored.comparison);
                setSavedId(stored.id);
              })}>
              {savedId === r.id ? '表示中の感度結果' : '感度の保存結果を開く'}
            </button>
          </article>
        ))}
      </div>
      {history.next_before !== null && (
        <button className="secondary" disabled={historyLoading} onClick={() => void task(async () => {
          const generation = historyGeneration.current;
          setHistoryLoading(true);
          try {
            const page = await api<Page>(`/projects/${encodeURIComponent(project.id)}/sensitivity-runs?before=${history.next_before}`);
            if (generation === historyGeneration.current)
              setHistory((previous) => ({ items: [...previous.items, ...page.items], next_before: page.next_before }));
          } finally {
            if (generation === historyGeneration.current) setHistoryLoading(false);
          }
        })}>以前の感度比較を表示</button>
      )}
    </section>
  );
}
