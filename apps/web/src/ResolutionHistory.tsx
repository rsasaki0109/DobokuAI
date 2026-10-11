import { useEffect, useRef, useState } from 'react';
import { History as HistoryIcon, RefreshCw } from 'lucide-react';
import { api } from './types';
type RunSummary = { id: number; project_name: string; executed_at: string; engine_version: string; case_count: number; failed_count: number };
type HistoryPage = { items: RunSummary[]; next_before: number | null };

export function ResolutionHistory({
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
    api<HistoryPage>(`/projects/${encodeURIComponent(projectId)}/resolution-runs`)
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
        `/projects/${encodeURIComponent(projectId)}/resolution-runs?before=${nextBefore}`,
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
    <div className="resolution-history">
      <div className="panel-heading">
        <div>
          <div className="eyebrow">SAVED STATION-SPACING STUDIES</div>
          <h2>
            <HistoryIcon size={19} /> 測点間隔比較の履歴
          </h2>
        </div>
        <button className="secondary" disabled={busy} onClick={() => setReload((n) => n + 1)}>
          <RefreshCw size={15} />
          測点間隔履歴を更新
        </button>
      </div>
      <p className="muted">測点間隔の保存結果を開くと当時の比較を表示します。作業中の基本条件は変更しません。再比較には作業中の基本条件を使い、補間の確認が必要です。</p>
      {error && <p role="alert">履歴を取得できませんでした: {error}</p>}
      {!items.length && (
        <p className="empty">
          {busy ? '履歴を読み込んでいます…' : 'このプロジェクトの測点間隔比較の履歴はまだありません。'}
        </p>
      )}
      <div className="history-list">
        {items.map((r) => (
          <article className="history-item" key={r.id}>
            <div>
              <strong>
                {r.project_name} · {r.case_count} 分割条件 · 失敗 {r.failed_count}
              </strong>
              <small>
                {new Date(r.executed_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} JST ·
                engine {r.engine_version} · #{r.id}
              </small>
            </div>
            <button
              className="secondary"
              disabled={busy}
              aria-label={`測点間隔履歴 #${r.id} を開く`}
              onClick={() => onOpen(r.id)}
            >
              {activeId === r.id ? '表示中の測点間隔結果' : '測点間隔の保存結果を開く'}
            </button>
          </article>
        ))}
      </div>
      {nextBefore !== null && (
        <button className="secondary" disabled={busy} onClick={more}>
          以前の測点間隔比較を表示
        </button>
      )}
    </div>
  );
}
