import type { Project, SpatialReference, Station } from './types';

const number = (value: number) => Number.isFinite(value)
  ? value.toLocaleString('ja-JP', { maximumFractionDigits: 8 }) : '未設定';
const roughness = (stations: Station[]) => {
  const values = stations.map(s => s.roughness);
  if (!values.length || values.some(n => !Number.isFinite(n))) return '未設定';
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? number(min) : `${number(min)}〜${number(max)}`;
};

export function SurveyConditionReview({ project, stations, reference }: {
  project: Project;
  stations: Station[];
  reference: SpatialReference;
}) {
  const { river } = project;
  const downstream = river.boundary.regime === 'subcritical';
  const boundary = (sections: Station[]) => sections[downstream ? sections.length - 1 : 0];
  const before = boundary(river.stations);
  const after = boundary(stations);
  const rows = [
    ['測点数', String(river.stations.length), String(stations.length), '全測点をCSVで置換'],
    ['粗度係数 n（範囲）', roughness(river.stations), roughness(stations), '各測点のCSV値で置換'],
    ['流量 Q (m³/s)', number(river.discharge), number(river.discharge), '保持'],
    ['等流水深用の参照勾配', number(river.normal_slope), number(river.normal_slope), '保持'],
    ['境界流況', downstream ? '常流・下流端' : '射流・上流端', downstream ? '常流・下流端' : '射流・上流端', '保持'],
    ['境界水深 (m / 河床から)', number(river.boundary.depth), number(river.boundary.depth), '保持'],
    ['境界測点の距離 (m)', before ? number(before.chainage) : '未設定', after ? number(after.chainage) : '未設定', '新しい端点を使用'],
    ['境界河床標高 (m)', before ? number(before.bed_elevation) : '未設定', after ? number(after.bed_elevation) : '未設定', 'CSV値で置換'],
    ['境界水位 (m / 各標高系)', before ? number(before.bed_elevation + river.boundary.depth) : '未設定', after ? number(after.bed_elevation + river.boundary.depth) : '未設定', '河床標高＋保持した水深'],
    ['標高系', project.reference.vertical_datum, reference.vertical_datum, '取込み時の指定で置換'],
    ['水平座標', project.reference.horizontal_reference, reference.horizontal_reference, '取込み時の指定で置換'],
    ['施工案', String(project.scenarios.length), '0', '全案をクリア・累積をオフ'],
  ];
  return (
    <section className="import-condition-review" aria-label="取込み条件の確認">
      <h3>反映前の条件確認</h3>
      <div className="table-scroll">
        <table aria-label="CSV取込みの条件変更">
          <thead><tr><th>項目</th><th>現在の条件</th><th>反映後の条件</th><th>扱い</th></tr></thead>
          <tbody>{rows.map(([label, current, candidate, action]) => (
            <tr key={label}><th scope="row">{label}</th><td>{current}</td><td>{candidate}</td><td>{action}</td></tr>
          ))}</tbody>
        </table>
      </div>
      <p className="muted">
        粗度は既存値を引き継がず、CSVの各測点の値を使います。各値は断面の点検表で確認してください。
        流量・参照勾配・流況・境界水深は既存条件です。新しい区間に適した根拠を確認してください。
        境界水位は水深を保持して新しい河床から定まり、取込み前の水位を固定する操作ではありません。
      </p>
      <p className="muted" role="status">
        {project.reference.vertical_datum !== reference.vertical_datum
          ? '標高系の表記が変わります。標高基準の変換は行わず、取込み前後の水位差は算定しません。'
          : '標高系の表記は同じです。原資料の標高基準の一致は自動検証していません。'}
        表の水位は境界条件の表示です。流下方向の水面形は反映後に計算してください。
      </p>
    </section>
  );
}
