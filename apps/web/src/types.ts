export type Point = { x: number; z: number };
export type Section =
  | { kind: 'rectangle'; width: number; bank_height: number }
  | { kind: 'trapezoid'; bottom_width: number; side_slope: number; bank_height: number }
  | { kind: 'survey'; points: Point[] };
export type Station = {
  chainage: number;
  bed_elevation: number;
  roughness: number;
  section: Section;
};
export type River = {
  discharge: number;
  normal_slope: number;
  boundary: { regime: 'subcritical' | 'supercritical'; depth: number };
  stations: Station[];
};
export type Project = {
  id: string;
  name: string;
  river: River;
  scenarios: Scenario[];
  staged: boolean;
  reference: SpatialReference;
};
export type SpatialReference = {
  vertical_datum: string;
  horizontal_reference: string;
  import: null | {
    file_name: string;
    sha256: string;
    imported_at: string;
    elevation_mode: string;
    unit: string;
  };
};
export type Row = {
  chainage: number;
  bed_elevation: number;
  water_elevation: number;
  depth: number;
  velocity: number;
  area: number;
  froude: number;
  friction_slope: number;
  critical_depth: number;
  normal_depth: number;
  energy_residual: number;
};
export type Profile = { rows: Row[]; warnings: string[] };
export type Run = { engine_version: string; executed_at: string; river: River; profile: Profile };
export type Modification =
  | { kind: 'excavate'; depth: number }
  | { kind: 'roughness'; value: number }
  | { kind: 'cofferdam'; blocked_width: number }
  | { kind: 'replace_section'; section: Section };
export type Scenario = { name: string; modification: Modification };
export type Comparison = {
  scenario: Scenario;
  river: River;
  profile: Profile;
  cut_areas: number[] | null;
  cut_volume: number | null;
  fill_volume: number | null;
  max_water_change: number;
  volume_note: string;
};
export type Analysis = { project: Project; run: Run; comparisons: Comparison[]; staged: boolean };
export type StoredAnalysis = { id: number; analysis: Analysis };
export type RunSummary = {
  id: number;
  project_id: string;
  project_name: string;
  executed_at: string;
  engine_version: string;
  discharge: number;
  station_count: number;
  scenario_count: number;
  staged: boolean;
};
export type HistoryPage = { items: RunSummary[]; next_before: number | null };
export type Action =
  | { tool: 'set_discharge'; value: number }
  | { tool: 'compare_roughness'; value: number }
  | { tool: 'compare_excavation'; depth: number }
  | { tool: 'create_report' };
export type Proposal = { actions: Action[]; explanation: string };
export type AnalysisRequest = { project: Project; scenarios: Scenario[]; staged: boolean };

export const initialScenarios: Scenario[] = [
  { name: '河道掘削 1.0 m', modification: { kind: 'excavate', depth: 1 } },
];
export const colors = ['#e5974a', '#8669c5', '#d6607e', '#328b8d', '#8c8c3d', '#566fa9'];
export function ground(s: Section, bed: number): Point[] {
  if (s.kind === 'survey') return s.points.map((p) => ({ x: p.x, z: p.z + bed }));
  const b = s.kind === 'rectangle' ? s.width : s.bottom_width;
  const side = s.kind === 'trapezoid' ? s.side_slope * s.bank_height : 0;
  return [
    { x: -b / 2 - side, z: bed + s.bank_height },
    { x: -b / 2, z: bed },
    { x: b / 2, z: bed },
    { x: b / 2 + side, z: bed + s.bank_height },
  ];
}
export function waterExtent(points: Point[], stage: number): [number, number] {
  const xs: number[] = [];
  points.slice(1).forEach((p, i) => {
    const a = points[i];
    if (a.z <= stage) xs.push(a.x);
    if (p.z <= stage) xs.push(p.x);
    if ((a.z - stage) * (p.z - stage) < 0)
      xs.push(a.x + ((p.x - a.x) * (stage - a.z)) / (p.z - a.z));
  });
  return [Math.min(...xs), Math.max(...xs)];
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(
    `/api${path}`,
    body === undefined
      ? undefined
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      message = JSON.parse(text).error ?? text;
    } catch {
      /* Axum extraction errors are text. */
    }
    throw new Error(message || `HTTP ${res.status}`);
  }
  return JSON.parse(text) as T;
}
export async function download(
  path: string,
  body: AnalysisRequest,
  filename: string,
  historyId?: number | null,
) {
  const res = historyId
    ? await fetch(`/api/runs/${historyId}/reports/${path}`)
    : await fetch(`/api/reports/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
  if (!res.ok) {
    const message = await res.text();
    throw new Error(message);
  }
  saveBlob(await res.blob(), filename);
}
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
