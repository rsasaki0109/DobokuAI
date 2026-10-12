export type GravityDam = {
  height_m: number; crest_width_m: number; base_width_m: number;
  upstream_depth_m: number; downstream_depth_m: number;
  concrete_unit_weight_kn_m3: number; water_unit_weight_kn_m3: number;
  friction_coefficient: number;
};
export type Spillway = { effective_width_m: number; crest_elevation_m: number; coefficient_m_half_s: number };
export type DamConditions = { name: string; dam: GravityDam; spillway: Spillway };
export type Contact = 'full' | 'partial' | 'outside_base' | 'no_compression';
export type Statics = {
  area_m2: number; centroid_x_m: number; centroid_z_m: number;
  weight_kn_m: number; upstream_horizontal_kn_m: number; downstream_horizontal_kn_m: number;
  downstream_vertical_kn_m: number; uplift_kn_m: number; uplift_x_m: number | null;
  effective_vertical_kn_m: number; net_horizontal_kn_m: number;
  resisting_moment_knm_m: number; overturning_moment_knm_m: number;
  sliding_ratio: number | null; overturning_ratio: number | null;
  resultant_x_m: number | null; eccentricity_m: number | null;
  heel_pressure_kpa: number | null; toe_pressure_kpa: number | null;
  contact: Contact; warnings: string[];
};
export type DamRun = {
  engine_version: string; structural_model_version: string; hydraulic_model_version: string;
  executed_at: string; conditions: DamConditions; statics: Statics;
  overflow: { head_m: number; discharge_m3_s: number; warnings: string[] }; note: string;
};
export type StoredDam = { id: number; run: DamRun };
export type DamHistory = { items: { id: number; name: string; executed_at: string; upstream_depth_m: number }[]; next_before: number | null };
export const contactLabels: Record<Contact, string> = {
  full: '全幅接触', partial: '部分接触 · 接触圧は未計算',
  outside_base: '合力が基礎外 · 釣合い不成立', no_compression: '圧縮接触なし',
};
