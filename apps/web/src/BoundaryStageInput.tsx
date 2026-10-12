import type { Project } from './types';
import { NumberField } from './Editor';

export function BoundaryStageInput({ project, edit }: {
  project: Project;
  edit: (project: Project) => void;
}) {
  const river = project.river;
  const downstream = river.boundary.regime === 'subcritical';
  const station = river.stations[downstream ? river.stations.length - 1 : 0];
  if (!station) return <p role="alert">境界断面がありません。断面条件を確認してください。</p>;
  const stage = station.bed_elevation + river.boundary.depth;
  const valid = Number.isFinite(stage) && Number.isFinite(river.boundary.depth) && river.boundary.depth > 0;
  return (
    <div className="field">
      <NumberField
        label="境界水位 (m / 共通基準高)"
        value={stage}
        onChange={waterSurface => edit({
          ...project,
          river: { ...river, boundary: { ...river.boundary, depth: waterSurface - station.bed_elevation } },
        })}
      />
      <p className="muted" role="status">
        {downstream ? '下流端（常流）' : '上流端（射流）'} · 距離 {station.chainage} m · 河床標高 {station.bed_elevation} m
        <br />
        基準高: {project.reference.vertical_datum}
      </p>
      {!valid && <p role="alert">境界水位と水深は有限値、水深は0より大きい値が必要です。河床以下の水位は計算できません。</p>}
    </div>
  );
}
