import { ShapeUtils, Vector2, Vector3 } from 'three';

export type CityLayer = 'building' | 'terrain' | 'road' | 'bridge' | 'water' | 'other';
export type Coordinate = [number, number, number];
export type CityFeature = { id: string; layer: CityLayer; positions: number[]; triangleCount: number };
export type CityModel = {
  crs: string; origin: Coordinate; features: CityFeature[];
  bounds: { min: Coordinate; max: Coordinate }; polygonCount: number; lod: number;
};
export const localCityCRS = 'urn:doboku:crs:local-metre';
const gmlNamespaces = ['http://www.opengis.net/gml', 'http://www.opengis.net/gml/3.2'];
const featureKinds: Record<string, CityLayer> = {
  Building: 'building', BuildingPart: 'building', ReliefFeature: 'terrain', TINRelief: 'terrain',
  Road: 'road', Bridge: 'bridge', BridgePart: 'bridge', WaterBody: 'water',
};
const allElements = (e: Element | Document) => Array.from(e.getElementsByTagName('*'));
const isGml = (e: Element, name: string) => e.localName === name && gmlNamespaces.includes(e.namespaceURI ?? '');
function inherited(e: Element, name: string): string | null {
  for (let n: Element | null = e; n; n = n.parentElement) {
    if (n.hasAttribute(name)) return n.getAttribute(name);
  }
  return null;
}
function surfaceLOD(e: Element): number | null {
  for (let n: Element | null = e; n; n = n.parentElement) {
    const match = /^lod([0-4])/.exec(n.localName);
    if (match) return Number(match[1]);
  }
  return null;
}
function featureOf(e: Element): { id: string; layer: CityLayer } {
  for (let n: Element | null = e; n; n = n.parentElement) {
    if (featureKinds[n.localName]) return {
      id: n.getAttributeNS('http://www.opengis.net/gml', 'id') ??
        n.getAttributeNS('http://www.opengis.net/gml/3.2', 'id') ?? n.localName,
      layer: featureKinds[n.localName],
    };
  }
  return { id: '未分類の地物', layer: 'other' };
}
function epsg(srs: string): string {
  if (srs === localCityCRS) return srs;
  if (/^(?:EPSG:6697|urn:ogc:def:crs:EPSG::6697|https?:\/\/www\.opengis\.net\/def\/crs\/EPSG\/0\/6697)$/.test(srs)) return 'EPSG:6697';
  throw new Error(`未対応の座標系 ${srs}。EPSG:6697（緯度・経度・高さ）に対応しています。座標系を推測・付け替えしません。`);
}
// Horizontal display tangent plane on GRS80. Source heights stay unchanged:
// this is neither a datum transformation nor a survey-quality projection.
function displayPoint(p: Coordinate, origin: Coordinate, crs: string): Coordinate {
  if (crs === localCityCRS) return [p[0] - origin[0], p[2] - origin[2], -(p[1] - origin[1])];
  const rad = Math.PI / 180, a = 6378137, f = 1 / 298.257222101, e2 = f * (2 - f);
  function earth(q: Coordinate) {
    const lat = q[0] * rad, lon = q[1] * rad;
    const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    return [n * Math.cos(lat) * Math.cos(lon), n * Math.cos(lat) * Math.sin(lon), n * (1 - e2) * Math.sin(lat)];
  }
  const v = earth(p), o = earth(origin), d = v.map((n, i) => n - o[i]);
  const lat = origin[0] * rad, lon = origin[1] * rad;
  const east = -Math.sin(lon) * d[0] + Math.cos(lon) * d[1];
  const north = -Math.sin(lat) * Math.cos(lon) * d[0] - Math.sin(lat) * Math.sin(lon) * d[1] + Math.cos(lat) * d[2];
  return [east, p[2] - origin[2], -north];
}
function triangulate(points: Coordinate[]): number[] {
  const normal = new Vector3();
  for (let i = 0; i < points.length; i++) {
    const p = points[i], q = points[(i + 1) % points.length];
    normal.x += (p[1] - q[1]) * (p[2] + q[2]);
    normal.y += (p[2] - q[2]) * (p[0] + q[0]);
    normal.z += (p[0] - q[0]) * (p[1] + q[1]);
  }
  if (normal.length() < 1e-8) throw new Error('面積ゼロの面は表示できません');
  normal.normalize();
  const base = new Vector3(...points[0]);
  if (points.some(p => Math.abs(new Vector3(...p).sub(base).dot(normal)) > .05)) throw new Error('平面から0.05m以上外れた面は三角形化できません');
  const drop = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)].indexOf(Math.max(Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)));
  const axes = [0, 1, 2].filter(i => i !== drop);
  const ring = points.map(p => new Vector2(p[axes[0]], p[axes[1]]));
  const cross = (a: Vector2, b: Vector2, c: Vector2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const on = (a: Vector2, b: Vector2, p: Vector2) => Math.abs(cross(a, b, p)) < 1e-8 &&
    p.x >= Math.min(a.x, b.x) - 1e-8 && p.x <= Math.max(a.x, b.x) + 1e-8 && p.y >= Math.min(a.y, b.y) - 1e-8 && p.y <= Math.max(a.y, b.y) + 1e-8;
  for (let i = 0; i < ring.length; i++) for (let j = i + 1; j < ring.length; j++) {
    if (j === i + 1 || (i === 0 && j === ring.length - 1)) continue;
    const a = ring[i], b = ring[(i + 1) % ring.length], c = ring[j], d = ring[(j + 1) % ring.length];
    if ((cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b))
      throw new Error('自己交差・接触する輪郭は表示できません');
  }
  const faces = ShapeUtils.triangulateShape(ring, []);
  const area = Math.abs(ShapeUtils.area(ring));
  const sum = faces.reduce((n, [a, b, c]) => n + Math.abs(cross(ring[a], ring[b], ring[c])) / 2, 0);
  if (area < 1e-8 || Math.abs(sum - area) > Math.max(1e-7, area * 1e-7)) throw new Error('面の三角形化に失敗しました');
  return faces.flatMap(face => face.flatMap(i => points[i]));
}

export function parseCityFiles(files: { name: string; xml: string }[], lod: number): CityModel {
  if (![0, 1, 2].includes(lod)) throw new Error('LODは0・1・2を選択してください');
  if (!files.length || files.length > 8) throw new Error('CityGMLは1〜8ファイルを選択してください');
  if (new Set(files.map(f => f.name)).size !== files.length) throw new Error('同名ファイルを重複して取り込めません');
  let bytes = 0, vertices = 0;
  let crs: string | null = null;
  const surfaces: { feature: { id: string; layer: CityLayer }; points: Coordinate[] }[] = [];
  for (const file of files) {
    const size = new TextEncoder().encode(file.xml).byteLength; bytes += size;
    if (size > 8 * 1024 * 1024 || bytes > 24 * 1024 * 1024) throw new Error('1ファイル8MiB、合計24MiB以内の小範囲CityGMLを選択してください');
    if (/<!DOCTYPE|<!ENTITY/i.test(file.xml)) throw new Error('DOCTYPE・ENTITY宣言には対応していません');
    const doc = new DOMParser().parseFromString(file.xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error(`${file.name}: XMLを解析できません`);
    const root = doc.documentElement;
    if (root.localName !== 'CityModel' || !['http://www.opengis.net/citygml/2.0', 'http://www.opengis.net/citygml/3.0'].includes(root.namespaceURI ?? '')) throw new Error('CityGML 2.0/3.0のCityModelが必要です');
    const elements = allElements(doc);
    const ids = new Set(elements.map(e => e.getAttributeNS('http://www.opengis.net/gml', 'id') ?? e.getAttributeNS('http://www.opengis.net/gml/3.2', 'id')).filter(Boolean));
    for (const e of elements) {
      const ref = e.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
      if (ref && (!ref.startsWith('#') || !ids.has(ref.slice(1)))) throw new Error('外部ファイル・未解決のxlink参照には対応していません');
    }
    for (const e of elements.filter(e => isGml(e, 'Polygon') || isGml(e, 'Triangle'))) {
      const level = surfaceLOD(e);
      if (level !== null && level !== lod) continue;
      const descendants = allElements(e);
      if (descendants.some(n => isGml(n, 'interior'))) throw new Error('穴を持つ面には未対応です。穴を埋めて表示しません');
      const lists = descendants.filter(n => isGml(n, 'posList'));
      if (lists.length !== 1) throw new Error('各面に1つの閉じた外周posListが必要です');
      const list = lists[0];
      const srs = inherited(list, 'srsName') ?? elements.find(n => isGml(n, 'Envelope'))?.getAttribute('srsName');
      if (!srs) throw new Error('srsNameによる座標系の明示が必要です');
      const current = epsg(srs);
      if (crs && current !== crs) throw new Error('異なる座標系を同じビューへ混在させません');
      crs = current;
      const dim = inherited(list, 'srsDimension') ?? elements.find(n => isGml(n, 'Envelope'))?.getAttribute('srsDimension');
      if (dim !== '3') throw new Error('srsDimension=3の座標が必要です');
      const values = (list.textContent ?? '').trim().split(/\s+/).map(Number);
      if (values.length < 12 || values.length % 3 || values.some(v => !Number.isFinite(v))) throw new Error('有限値の3次元座標と閉じた輪郭が必要です');
      const points: Coordinate[] = [];
      for (let i = 0; i < values.length; i += 3) {
        const p: Coordinate = [values[i], values[i + 1], values[i + 2]];
        if (current === 'EPSG:6697' && (p[0] < 20 || p[0] > 50 || p[1] < 120 || p[1] > 155)) throw new Error('EPSG:6697は緯度・経度・高さの順序で、日本の小範囲を指定してください');
        if (Math.abs(p[2]) > 12000 || p.some(v => Math.abs(v) > 1e7)) throw new Error('座標・高さが表示範囲外です');
        points.push(p);
      }
      if (points[0].some((v, i) => v !== points.at(-1)![i])) throw new Error('外周は同じ座標で閉じてください。閉点を自動追加しません');
      points.pop();
      if (points.length > 128 || new Set(points.map(p => p.join(','))).size !== points.length) throw new Error('外周は重複のない3〜128点で指定してください');
      vertices += points.length;
      if (vertices > 100000 || surfaces.length >= 20000) throw new Error('表示上限（10万点・2万面）を超えています');
      const feature = featureOf(e);
      surfaces.push({ feature: { ...feature, id: `${file.name} / ${feature.id}` }, points });
    }
  }
  if (!surfaces.length || !crs) throw new Error('選択LODに対応する埋込みPolygon/Triangleがありません');
  const min: Coordinate = [Infinity, Infinity, Infinity], max: Coordinate = [-Infinity, -Infinity, -Infinity];
  for (const s of surfaces) for (const p of s.points) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); }
  const origin: Coordinate = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, min[2]];
  const displayMin: Coordinate = [Infinity, Infinity, Infinity], displayMax: Coordinate = [-Infinity, -Infinity, -Infinity];
  const features = new Map<string, CityFeature>();
  for (const s of surfaces) {
    const points = s.points.map(p => displayPoint(p, origin, crs!));
    for (const p of points) for (let i = 0; i < 3; i++) { displayMin[i] = Math.min(displayMin[i], p[i]); displayMax[i] = Math.max(displayMax[i], p[i]); }
    const positions = triangulate(points);
    const key = `${s.feature.layer}:${s.feature.id}`;
    const feature = features.get(key) ?? { ...s.feature, positions: [], triangleCount: 0 };
    feature.positions.push(...positions); feature.triangleCount += positions.length / 9; features.set(key, feature);
  }
  if (Math.hypot(displayMax[0] - displayMin[0], displayMax[2] - displayMin[2]) > 5000) throw new Error('対角5km以内の小範囲を選択してください');
  return { crs, origin, features: [...features.values()], bounds: { min: displayMin, max: displayMax }, polygonCount: surfaces.length, lod };
}

export function syntheticCityXML(): string {
  let content = '', serial = 0;
  const polygon = (p: Coordinate[]) => `<gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>${[...p, p[0]].flat().join(' ')}</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon>`;
  const member = (tag: string, surfaces: Coordinate[][], level = true) => {
    const id = `demo-${serial++}`, prefix = tag.split(':')[0];
    const geometry = level
      ? `<${prefix}:lod1MultiSurface><gml:MultiSurface>${surfaces.map(p => `<gml:surfaceMember>${polygon(p)}</gml:surfaceMember>`).join('')}</gml:MultiSurface></${prefix}:lod1MultiSurface>`
      : `<dem:lod>1</dem:lod><dem:reliefComponent><dem:TINRelief gml:id="${id}-tin"><dem:lod>1</dem:lod><dem:tin><gml:TriangulatedSurface><gml:trianglePatches>${surfaces.map(p => polygon(p).replaceAll('gml:Polygon', 'gml:Triangle')).join('')}</gml:trianglePatches></gml:TriangulatedSurface></dem:tin></dem:TINRelief></dem:reliefComponent>`;
    return `<core:cityObjectMember><${tag} gml:id="${id}">${geometry}</${tag}></core:cityObjectMember>`;
  };
  const z = (x: number, y: number) => 100 + .025 * y + 5 * Math.exp(-((x + 90) ** 2 + (y - 55) ** 2) / 7500);
  const terrain: Coordinate[][] = [];
  for (let x = -160; x < 160; x += 20) for (let y = -120; y < 120; y += 20) {
    const a: Coordinate = [x, y, z(x, y)], b: Coordinate = [x + 20, y, z(x + 20, y)], c: Coordinate = [x + 20, y + 20, z(x + 20, y + 20)], d: Coordinate = [x, y + 20, z(x, y + 20)];
    terrain.push([a, b, c], [a, c, d]);
  }
  content += member('dem:ReliefFeature', terrain, false);
  for (let x = -125; x <= 125; x += 50) for (let y = -80; y <= 80; y += 80) {
    const h = 12 + ((x + 125) / 50 % 3) * 9, b = z(x, y) + .3;
    const a: Coordinate = [x - 13, y - 14, b], c: Coordinate = [x + 13, y - 14, b], d: Coordinate = [x + 13, y + 14, b], e: Coordinate = [x - 13, y + 14, b];
    const roof = [a, c, d, e].map(p => [p[0], p[1], b + h] as Coordinate);
    content += member('bldg:Building', [roof, ...[a, c, d, e].map((p, i, base) => [p, base[(i + 1) % 4], roof[(i + 1) % 4], roof[i]])]);
  }
  content += member('tran:Road', [[[-155,-20,101], [155,-20,101], [155,-8,101], [-155,-8,101]]]);
  content += member('wtr:WaterBody', [[[30,-115,101], [48,-115,101], [48,115,101], [30,115,101]]]);
  content += member('brid:Bridge', [[[12,-22,104], [65,-22,104], [65,-6,104], [12,-6,104]]]);
  return `<?xml version="1.0"?><core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:gml="http://www.opengis.net/gml" xmlns:bldg="http://www.opengis.net/citygml/building/2.0" xmlns:dem="http://www.opengis.net/citygml/relief/2.0" xmlns:tran="http://www.opengis.net/citygml/transportation/2.0" xmlns:wtr="http://www.opengis.net/citygml/waterbody/2.0" xmlns:brid="http://www.opengis.net/citygml/bridge/2.0" srsName="${localCityCRS}" srsDimension="3">${content}</core:CityModel>`;
}
