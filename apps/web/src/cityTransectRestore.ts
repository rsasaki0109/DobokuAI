import { hasJSONKeys, sameJSON } from './jsonMatch';
import { cityTransectSnapshot } from './cityTransectReport';
import type { TransectSnapshot } from './cityTransectReport';
import type { ReportInput } from './cityReport';
import type { TransectLine } from './cityTransect';

export const cityTransectFileLimit = 8 * 1024 * 1024;
export type TransectArchive = { snapshot: TransectSnapshot; verifiedAt: string };
function recordedTime(value: unknown): string {
  if (typeof value !== 'string') throw new Error('保存断面のUTC日時が無効です');
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|\+00:00)$/.exec(value);
  if (!m || !Number.isFinite(Date.parse(value))) throw new Error('保存断面のUTC日時が無効です');
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) throw new Error('保存断面のUTC日時が無効です');
  return value;
}
function isJSON(value: unknown, depth = 0, budget = { remaining: 1_000_000 }): boolean {
  if (depth > 64 || --budget.remaining < 0) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) if (!Object.hasOwn(value, i) || !isJSON(value[i], depth + 1, budget)) return false;
    return true;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  return Reflect.ownKeys(value).every(k => typeof k === 'string' && isJSON((value as Record<string, unknown>)[k], depth + 1, budget));
}

// Never apply imported metadata or elevations. Recut the proposed line in the
// current model and compare every field, allowing only recorded UTC times to differ.
export function inspectCityTransectArchive(value: unknown, input: ReportInput): TransectArchive {
  if (!isJSON(value) || !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('有効な指定線の断面JSONが必要です');
  const saved = value as Record<string, unknown>;
  if (saved.schema_version !== 1 || saved.report_type !== 'city_terrain_transect_inspection') throw new Error('指定線JSONの形式・版が未対応です');
  const t = saved.terrain_transect;
  if (!hasJSONKeys(t, ['method', 'shared_height_tolerance_m', 'line', 'unit_direction', 'profile']) || !hasJSONKeys(t.line, ['start', 'end'])) throw new Error('指定線JSONの項目が未対応です');
  for (const p of [t.line.start, t.line.end]) if (!hasJSONKeys(p, ['east', 'north']) || typeof p.east !== 'number' || typeof p.north !== 'number' || !Number.isFinite(p.east) || !Number.isFinite(p.north)) throw new Error('保存指定線の座標が無効です');
  const verifiedAt = new Date().toISOString();
  const fresh = cityTransectSnapshot(input, t.line as TransectLine, verifiedAt);
  if (!hasJSONKeys(saved, Object.keys(fresh))) throw new Error('指定線JSONの項目が未対応です');
  const times = new Set(['generated_at', 'inspected_at', 'transect_inspected_at']);
  for (const key of Object.keys(fresh)) if (!times.has(key) && !sameJSON(saved[key], fresh[key as keyof typeof fresh])) throw new Error('現在の施工範囲・元地形・出典・再切断結果が保存断面と一致しません');
  const snapshot = { ...fresh, generated_at: recordedTime(saved.generated_at), inspected_at: recordedTime(saved.inspected_at), transect_inspected_at: recordedTime(saved.transect_inspected_at) };
  return { snapshot, verifiedAt };
}
