import { cityGradingConditions, inspectGradingRun } from './cityGrading';
import type { GradingRun } from './cityGrading';
import type { citySectionSnapshot } from './citySectionCSV';
import { hasJSONKeys, sameJSON } from './jsonMatch';

export const cityGradingFileLimit = 8 * 1024 * 1024;
export type GradingArchive = { source: ReturnType<typeof citySectionSnapshot>; run: GradingRun };
function recordedTime(value: unknown): string {
  if (typeof value !== 'string') throw new Error('保存資料の日時が無効です');
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|\+00:00)$/.exec(value);
  if (!m || !Number.isFinite(Date.parse(value))) throw new Error('保存資料の日時が無効です');
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) throw new Error('保存資料の日時が無効です');
  // App exports use UTC. Preserve the original fractional precision and UTC
  // spelling instead of rounding an archived event to JavaScript milliseconds.
  return value;
}

// Validate every source/section field against current trusted metadata. Only
// recorded times and the proposed elevation may differ; no footprint or source
// values from the file are applied to the workspace.
export function inspectCityGradingArchive(value: unknown, current: ReturnType<typeof citySectionSnapshot>): GradingArchive {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('切土・盛土の計算JSONが必要です');
  const saved = value as Record<string, unknown>;
  const expected = { ...current, report_type: 'city_centerline_grading_areas', numerical_solver_linked: true,
    numerical_engine: 'doboku-earthwork', hydraulic_solver_linked: false, volume_calculated: false };
  if (!hasJSONKeys(saved, [...Object.keys(expected), 'grading']) || saved.schema_version !== 1 || saved.report_type !== expected.report_type) throw new Error('切土・盛土JSONの形式・項目が未対応です');
  const times = new Set(['generated_at', 'inspected_at', 'sections_inspected_at']);
  for (const key of Object.keys(expected)) if (!times.has(key) && !sameJSON(saved[key], expected[key as keyof typeof expected])) throw new Error('現在の施工範囲・元断面・出典・表示版が保存資料と一致しません');
  const source = { ...structuredClone(current), generated_at: recordedTime(saved.generated_at), inspected_at: recordedTime(saved.inspected_at), sections_inspected_at: recordedTime(saved.sections_inspected_at) };
  const incoming = saved.grading as GradingRun | undefined;
  if (!incoming?.conditions) throw new Error('保存資料の計算条件が無効です');
  recordedTime(incoming.executed_at);
  const conditions = cityGradingConditions(current.terrain_sections.sections, incoming.conditions.target_elevation_m);
  const run = inspectGradingRun(incoming, conditions);
  return { source, run };
}

// Recompute with Rust, then compare all inputs/versions and numeric results.
// Preserve the archived execution time; the new time is a verification event.
export function verifyCityGradingArchive(archive: GradingArchive, value: unknown): { archive: GradingArchive; verifiedAt: string } {
  const fresh = inspectGradingRun(value, archive.run.conditions);
  recordedTime(fresh.executed_at);
  const { executed_at: _oldTime, ...oldResult } = archive.run;
  const { executed_at: _newTime, ...newResult } = fresh;
  if (!sameJSON(oldResult, newResult)) throw new Error('保存された数値・エンジン版が現在のRust再計算と一致しません。復元していません');
  return { archive: structuredClone(archive), verifiedAt: fresh.executed_at };
}
