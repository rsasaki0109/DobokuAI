import { useEffect, useRef, useState } from 'react';
import { History as HistoryIcon, RefreshCw } from 'lucide-react';
import { api } from './types';
import type { HistoryPage, RunSummary } from './types';

export function History({
  projectId,
  revision,
  activeId,
  onOpen,
}: {
  projectId: string;
  revision: number;
  activeId: number | null;
  onOpen: (id: number) => void;
}) {
  const [items, setItems] = useState<RunSummary[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    let alive = true;
    generation.current += 1;
    setItems([]);
    setNextBefore(null);
    setBusy(true);
    setError('');
    api<HistoryPage>(`/projects/${encodeURIComponent(projectId)}/runs`)
      .then((page) => {
        if (alive) {
          setItems(page.items);
          setNextBefore(page.next_before);
        }
      })
      .catch((e) => {
        if (alive) setError((e as Error).message);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [projectId, revision, reload]);
  async function more() {
    const current = generation.current;
    setBusy(true);
    setError('');
    try {
      const page = await api<HistoryPage>(
        `/projects/${encodeURIComponent(projectId)}/runs?before=${nextBefore}`,
      );
      if (current !== generation.current) return;
      setItems((previous) => [...previous, ...page.items]);
      setNextBefore(page.next_before);
    } catch (e) {
      if (current === generation.current) setError((e as Error).message);
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  return (
    <section className="panel history-panel">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">SAVED CALCULATIONS</div>
          <h2>
            <HistoryIcon size={19} /> 計算履歴
          </h2>
        </div>
        <button className="secondary" disabled={busy} onClick={() => setReload((n) => n + 1)}>
          <RefreshCw size={15} />
          履歴を更新
        </button>
      </div>
      <p className="muted">
        「計算を実行」と確認済み AI
        操作の成功結果を保存します。開くと作業中の条件と施工案を復元します。プロジェクトの保存内容は変更しません。
      </p>
      {error && <p role="alert">履歴を取得できませんでした: {error}</p>}
      {!items.length && (
        <p className="empty">
          {busy ? '履歴を読み込んでいます…' : 'このプロジェクトの計算履歴はまだありません。'}
        </p>
      )}
      <div className="history-list">
        {items.map((r) => (
          <article className="history-item" key={r.id}>
            <div>
              <strong>
                Q = {r.discharge} m³/s · {r.station_count} 断面 · {r.scenario_count} 案
              </strong>
              <p>
                {r.project_name} · {r.staged ? '累積施工段階' : '独立比較案'}
              </p>
              <small>
                {new Date(r.executed_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} JST ·
                engine {r.engine_version} · #{r.id}
              </small>
            </div>
            <button
              className="secondary"
              disabled={busy}
              aria-label={`計算履歴 #${r.id} を開く`}
              onClick={() => onOpen(r.id)}
            >
              {activeId === r.id ? '表示中の保存結果' : '保存結果を開く'}
            </button>
          </article>
        ))}
      </div>
      {nextBefore !== null && (
        <button className="secondary" disabled={busy} onClick={more}>
          以前の計算を表示
        </button>
      )}
    </section>
  );
}
