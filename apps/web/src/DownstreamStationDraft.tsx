import { useState } from 'react';
import type { Project, Station } from './types';
import { NumberField } from './NumberField';
import { SectionChart } from './Charts';

const value = (n: number) => Number.isFinite(n)
  ? n.toLocaleString('ja-JP', { maximumFractionDigits: 8 }) : '未入力';

export function DownstreamStationDraft({ project, apply, cancel }: {
  project: Project;
  apply: (station: Station) => void;
  cancel: () => void;
}) {
  const last = project.river.stations.at(-1)!;
  const [station, setStation] = useState<Station>(() => ({
    ...structuredClone(last), chainage: last.chainage + 100, bed_elevation: NaN,
  }));
  const downstream = project.river.boundary.regime === 'subcritical';
  const originalBoundary = project.river.stations[downstream ? project.river.stations.length - 1 : 0];
  const newBoundary = downstream ? station : originalBoundary;
  const valid = [station.chainage, station.bed_elevation, station.roughness].every(Number.isFinite)
    && Number.isFinite(station.chainage - last.chainage) && station.chainage - last.chainage >= 0.1
    && station.roughness >= 0.005 && station.roughness <= 0.2;
  const update = (patch: Partial<Station>) => setStation(s => ({ ...s, ...patch }));
  return (
    <section className="panel" aria-label="下流断面の追加候補">
      <h2>下流断面の追加候補</h2>
      <p className="muted">
        距離の初期値は最下流から100mです。断面形状と粗度は最下流の複製で、実測値を生成したものではありません。
        河床標高は推定しません。確認した測量値または設計条件を入力してください。
      </p>
      <div className="form-grid">
        <NumberField label="追加断面の縦断距離 (m)" value={station.chainage} onChange={chainage => update({ chainage })} />
        <NumberField label="追加断面の河床標高 (m / 共通基準高)" value={station.bed_elevation} onChange={bed_elevation => update({ bed_elevation })} />
        <NumberField label="追加断面の粗度係数 n" value={station.roughness} onChange={roughness => update({ roughness })} />
      </div>
      <p>基準高: {project.reference.vertical_datum} · 水平座標: {project.reference.horizontal_reference}</p>
      <p>複製元: No.{project.river.stations.length} · 距離 {value(last.chainage)} m · 河床 {value(last.bed_elevation)} m</p>
      <p role="status">
        境界: {downstream ? '常流・下流端が追加断面に変わります' : '射流・上流端を保持します'}。
        境界水深 {value(project.river.boundary.depth)} mを保持。
        境界水位: 現在 {value(originalBoundary.bed_elevation + project.river.boundary.depth)} m →
        追加後 {value(newBoundary.bed_elevation + project.river.boundary.depth)} m（河床＋水深）。
      </p>
      {Number.isFinite(station.bed_elevation) && (
        <SectionChart station={station} analysis={null} index={0} groundLabel="追加候補の地盤（複製形状）" />
      )}
      {!valid && <p className="inline-error" role="alert">有限な標高・距離・粗度を入力してください。最下流からの間隔は0.1m以上、粗度nは0.005〜0.2です。</p>}
      <p className="muted">
        候補の図は地盤だけで、水面形は未計算です。1断面を追加し、既存の測点・流量・参照勾配・施工案を保持します。
        確認後に編集条件へ反映し、保存・計算は別操作です。元CSVの取込み記録は元ファイルの記録のままです。
      </p>
      <button type="button" className="primary" disabled={!valid} onClick={() => apply(station)}>確認して下流断面を追加</button>
      <button type="button" className="secondary" onClick={cancel}>下流断面の追加を取消</button>
    </section>
  );
}
