import type { Project } from './types';
import { SectionChart } from './Charts';

const value = (n: number) => Number.isFinite(n)
  ? n.toLocaleString('ja-JP', { maximumFractionDigits: 8 }) : '未設定';

export function StationDeletionReview({ project, index, apply, cancel }: {
  project: Project;
  index: number;
  apply: () => void;
  cancel: () => void;
}) {
  const { river } = project;
  const removed = river.stations[index];
  const remaining = river.stations.filter((_, i) => i !== index);
  if (!removed || remaining.length < 2) return (
    <section className="panel" aria-label="断面削除の確認">
      <p role="alert">計算には最低2断面が必要です。この断面は削除できません。</p>
      <button type="button" className="secondary" onClick={cancel}>断面削除を取消</button>
    </section>
  );
  const downstream = river.boundary.regime === 'subcritical';
  const oldBoundary = river.stations[downstream ? river.stations.length - 1 : 0];
  const newBoundary = remaining[downstream ? remaining.length - 1 : 0];
  const boundaryChanged = oldBoundary === removed;
  const upstream = river.stations[index - 1];
  const next = river.stations[index + 1];
  return (
    <section className="panel" aria-label="断面削除の確認">
      <h2>断面削除の確認</h2>
      <p>削除対象: No.{index + 1} · 距離 {value(removed.chainage)} m · 河床 {value(removed.bed_elevation)} m · 粗度n {value(removed.roughness)}</p>
      <p>断面数: {river.stations.length} → {remaining.length}。残る測点の順序・距離・標高・粗度・形状を保持します。</p>
      <p>基準高: {project.reference.vertical_datum} · 水平座標: {project.reference.horizontal_reference}</p>
      <p role="status">
        境界: {downstream ? '常流・下流端' : '射流・上流端'}を{boundaryChanged ? '変更します' : '保持します'}。
        距離 {value(oldBoundary.chainage)} m → {value(newBoundary.chainage)} m。
        境界水深 {value(river.boundary.depth)} mを保持。
        境界水位: 現在 {value(oldBoundary.bed_elevation + river.boundary.depth)} m →
        削除後 {value(newBoundary.bed_elevation + river.boundary.depth)} m（河床＋水深）。
      </p>
      <p className="muted">
        {upstream && next
          ? `接続後の区間: ${value(upstream.chainage)} m → ${value(next.chainage)} m、間隔 ${value(next.chainage - upstream.chainage)} m。残る形状をそのままつなぎ、補間・平滑化しません。`
          : '端点の削除で対象区間が短くなります。境界位置と水深・水位を確認してください。'}
        断面間隔や遷移が変わるため、計算成立・適用範囲は再計算で確認してください。
      </p>
      <SectionChart station={removed} analysis={null} index={index} groundLabel="削除対象の地盤（現在の条件）" />
      <p className="muted">
        図は削除対象の地盤で、水面形は未計算です。流量・参照勾配・流況・境界水深・施工案を保持します。
        施工区間・土量も変わる場合があるため、施工比較は再計算してください。
        確認後に編集条件へ反映し、保存・計算は別操作です。元CSVの取込み記録と既存計算履歴は保持します。
      </p>
      <button type="button" className="primary" onClick={apply}>確認して断面を削除</button>
      <button type="button" className="secondary" onClick={cancel}>断面削除を取消</button>
    </section>
  );
}
