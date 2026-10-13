import type { CityModel, CityLayer } from './cityModel';
import type { CityFootprint } from './cityReport';
import webPackage from '../package.json' with { type: 'json' };

export const cityDisplayVersion = webPackage.version;
export const cityDisplayFileLimit = 128 * 1024;
const layers: CityLayer[] = ['building', 'terrain', 'road', 'bridge', 'water', 'other'];
type Source = { name: string; bytes: number; sha256: string };
export type CityDisplayRestore = {
  exported_at: string; footprint: CityFootprint | null; visible_layers: CityLayer[];
  selected_feature: string | null; top: boolean; rotating: boolean; sunset: boolean;
};
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

export function validCityFootprint(value: unknown, m: CityModel): value is CityFootprint {
  if (!record(value)) return false;
  const { east, north, width, length, elevation } = value;
  if (![east, north, width, length, elevation].every(v => typeof v === 'number' && Number.isFinite(v))) return false;
  const p = value as CityFootprint;
  return p.width > 0 && p.length > 0 && p.width <= 5000 && p.length <= 5000 &&
    p.east - p.width / 2 >= m.bounds.min[0] && p.east + p.width / 2 <= m.bounds.max[0] &&
    -p.north - p.length / 2 >= m.bounds.min[2] && -p.north + p.length / 2 <= m.bounds.max[2] &&
    p.elevation >= m.origin[2] + m.bounds.min[1] && p.elevation <= m.origin[2] + m.bounds.max[1];
}

// Fingerprint the parsed double-precision display geometry, including its CRS,
// origin and feature ordering. Bounds/counts alone cannot identify a model.
export async function cityDisplayFingerprint(m: CityModel): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ fingerprint_version: 1, crs: m.crs, origin: m.origin, bounds: m.bounds,
    lod: m.lod, polygon_count: m.polygonCount,
    features: m.features.map(f => ({ id: f.id, layer: f.layer, triangle_count: f.triangleCount, positions: f.positions })) }));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}

export async function inspectCityDisplay(value: unknown, m: CityModel, sources: Source[]): Promise<CityDisplayRestore> {
  if (!record(value) || value.schema_version !== 2 || value.model_type !== 'citygml_display' || value.numerical_solver_linked !== false) throw new Error('表示条件JSONの形式が未対応です。現在の保存ボタンで作成したschema_version 2が必要です');
  if (value.display_version !== cityDisplayVersion) throw new Error('表示機能のバージョンが一致しません');
  if (typeof value.exported_at !== 'string' || !Number.isFinite(Date.parse(value.exported_at))) throw new Error('保存日時が無効です');
  if (value.crs !== m.crs || value.lod !== m.lod || value.feature_count !== m.features.length || value.polygon_count !== m.polygonCount ||
    JSON.stringify(value.origin) !== JSON.stringify(m.origin) || !record(value.bounds) ||
    JSON.stringify(value.bounds.min) !== JSON.stringify(m.bounds.min) || JSON.stringify(value.bounds.max) !== JSON.stringify(m.bounds.max)) throw new Error('表示中のモデルの座標・LOD・範囲が一致しません');
  if (!Array.isArray(value.sources) || value.sources.length !== sources.length || value.sources.some((s, i) => !record(s) ||
    s.name !== sources[i].name || s.bytes !== sources[i].bytes || s.sha256 !== sources[i].sha256)) throw new Error('表示中のモデルの原ファイル記録が一致しません');
  if (typeof value.model_fingerprint_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.model_fingerprint_sha256) ||
    value.model_fingerprint_sha256 !== await cityDisplayFingerprint(m)) throw new Error('表示中のモデルの地物・地形形状が一致しません');
  if (value.footprint !== null && !validCityFootprint(value.footprint, m)) throw new Error('施工範囲は有限値・正の幅と長さ・モデル範囲内の位置と標高が必要です');
  if (!Array.isArray(value.visible_layers) || value.visible_layers.length > layers.length || new Set(value.visible_layers).size !== value.visible_layers.length ||
    value.visible_layers.some(v => !layers.includes(v as CityLayer))) throw new Error('表示レイヤーが無効です');
  if (value.selected_feature !== null && (typeof value.selected_feature !== 'string' || !m.features.some(f => f.id === value.selected_feature))) throw new Error('選択地物がモデル内にありません');
  if (![value.top, value.rotating, value.sunset].every(v => typeof v === 'boolean')) throw new Error('視点・回転・夕景はtrue/falseで指定してください');
  const p = value.footprint as CityFootprint | null;
  // Whitelist only display settings. Imported provenance, samples and numerical
  // results are never trusted or applied; recompute inspection from this model.
  return { exported_at: new Date(value.exported_at).toISOString(),
    footprint: p ? { east: p.east, north: p.north, width: p.width, length: p.length, elevation: p.elevation } : null,
    visible_layers: [...value.visible_layers] as CityLayer[], selected_feature: value.selected_feature as string | null,
    top: value.top as boolean, rotating: value.rotating as boolean, sunset: value.sunset as boolean };
}
