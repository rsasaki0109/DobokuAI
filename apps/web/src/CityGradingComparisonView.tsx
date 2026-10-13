import CitySectionsView from './CitySectionsView';
import type { TerrainSection } from './citySections';
import type { GradingComparison } from './cityGradingComparison';

export default function CityGradingComparisonView({ sections, comparison }: { sections: TerrainSection[]; comparison: GradingComparison }) {
  const targets = [comparison.baseline.conditions.target_elevation_m, comparison.scenario.conditions.target_elevation_m];
  return <div>
    <p>基準案 {targets[0]} m → 比較案 {targets[1]} m（原データ基準）。差は比較案−基準案。同じ軸の図は座標・距離・縦軸範囲を揃えています。東西と南北は合算しません。</p>
    <table aria-label="計画標高2案の断面積差"><thead><tr><th>軸</th><th>全長の切土差 (m²)</th><th>全長の盛土差 (m²)</th><th>一意な区間の切土小計差 (m²)</th><th>一意な区間の盛土小計差 (m²)</th><th>一意/欠損/曖昧な長さ (m)・未解決点</th></tr></thead><tbody>{comparison.differences.map(d => {
      const q = comparison.baseline[d.axis];
      return <tr key={d.axis} data-comparison-axis={d.axis}><th>{d.axis === 'east_west' ? '東西' : '南北'}</th><td>{d.cut_area_delta_m2 ?? '未算定'}</td><td>{d.fill_area_delta_m2 ?? '未算定'}</td><td>{d.known_cut_area_delta_m2}</td><td>{d.known_fill_area_delta_m2}</td><td>{q.known_length_m} / {q.uncovered_length_m} / {q.ambiguous_length_m}・{q.unresolved_point_count}点</td></tr>;
    })}</tbody></table>
    {(['baseline', 'scenario'] as const).map(key => {
      const run = comparison[key];
      return <div key={key} role="region" aria-label={key === 'baseline' ? '比較図の基準案' : '比較図の比較案'}><h4>{key === 'baseline' ? '基準案' : '比較案'}：計画標高 {run.conditions.target_elevation_m} m</h4>
        <CitySectionsView sections={sections} comparisonTargets={targets} grading={{ target_elevation_m: run.conditions.target_elevation_m, east_west: run.east_west, south_north: run.south_north }} /></div>;
    })}
  </div>;
}
