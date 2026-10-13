import { gradingComparison } from './cityGradingComparison';
import type { GradingComparison } from './cityGradingComparison';
import type { citySectionSnapshot } from './citySectionCSV';
import { inspectCityGradingArchive, verifyCityGradingArchive } from './cityGradingRestore';
import { hasJSONKeys, sameJSON } from './jsonMatch';

export type GradingComparisonArchive = { source: ReturnType<typeof citySectionSnapshot>; comparison: GradingComparison };

export function inspectCityGradingComparisonArchive(value: unknown, current: ReturnType<typeof citySectionSnapshot>): GradingComparisonArchive {
  const expected = { ...current, report_type: 'city_centerline_grading_comparison', numerical_solver_linked: true,
    numerical_engine: 'doboku-earthwork', hydraulic_solver_linked: false, volume_calculated: false, difference_direction: 'scenario_minus_baseline' };
  if (!hasJSONKeys(value, [...Object.keys(expected), 'comparison']) || value.schema_version !== 1 || value.report_type !== expected.report_type || value.difference_direction !== expected.difference_direction) throw new Error('2案比較JSONの形式・項目・差の方向が未対応です');
  const comparison = value.comparison;
  if (!hasJSONKeys(comparison, ['baseline', 'scenario', 'differences'])) throw new Error('保存資料の2案・差分の項目が無効です');
  const { comparison: _comparison, difference_direction: _direction, ...meta } = value;
  // Reuse the strict source/time/run checks of the individual archive format.
  // These temporary objects are inspected, never applied to the workspace.
  const baseline = inspectCityGradingArchive({ ...meta, report_type: 'city_centerline_grading_areas', grading: comparison.baseline }, current);
  const scenario = inspectCityGradingArchive({ ...meta, report_type: 'city_centerline_grading_areas', grading: comparison.scenario }, current);
  const checked = gradingComparison(baseline.source, baseline.run, scenario.run);
  if (!sameJSON(comparison.differences, checked.differences)) throw new Error('保存された差分が両案の計算記録と一致しません');
  return { source: baseline.source, comparison: checked };
}

export function verifyCityGradingComparisonArchive(archive: GradingComparisonArchive, baseline: unknown, scenario: unknown) {
  const a = verifyCityGradingArchive({ source: archive.source, run: archive.comparison.baseline }, baseline);
  const b = verifyCityGradingArchive({ source: archive.source, run: archive.comparison.scenario }, scenario);
  return { archive: structuredClone(archive), verifiedAt: { baseline: a.verifiedAt, scenario: b.verifiedAt } };
}
