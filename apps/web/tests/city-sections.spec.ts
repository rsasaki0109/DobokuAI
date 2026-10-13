import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { terrainSections } from '../src/citySections';
import { citySectionCSV } from '../src/citySectionCSV';
import type { CityModel, CityFeature } from '../src/cityModel';

function patch(id: string, x0 = -100, x1 = 100, h = (east: number, north: number) => 100 + .1 * east + .2 * north): CityFeature {
  const point = (east: number, north: number) => [east, h(east, north) - 100, -north];
  return { id, layer: 'terrain', triangleCount: 2, positions: [point(x0, -100), point(x1, -100), point(x1, 100), point(x0, -100), point(x1, 100), point(x0, 100)].flat() };
}
const model = (features = [patch('plane')]): CityModel => ({ crs: 'urn:doboku:crs:local-metre', origin: [0, 0, 100], features, bounds: { min: [-100, -100, -100], max: [100, 100, 100] }, polygonCount: features.length * 2, lod: 1 });
const footprint = { east: 0, north: 0, width: 40, length: 30, elevation: 100 };

test('exact terrain sections match analytic plane heights, preserve shared edges and reverse winding', () => {
  for (const reverse of [false, true]) {
    const f = patch('plane');
    if (reverse) f.positions = [f.positions.slice(6, 9), f.positions.slice(3, 6), f.positions.slice(0, 3), f.positions.slice(15, 18), f.positions.slice(12, 15), f.positions.slice(9, 12)].flat();
    for (const s of terrainSections(model([f]), footprint)) {
      expect(s.intervals.every(v => v.status === 'unique')).toBe(true);
      expect(s.points.every(v => v.status === 'unique')).toBe(true);
      for (const v of s.intervals) for (const [d, height] of [[v.from, v.curves[0].from], [v.to, v.curves[0].to]]) {
        const east = s.start.east + (s.axis === 'east_west' ? d : 0), north = s.start.north + (s.axis === 'south_north' ? d : 0);
        expect(height).toBeCloseTo(100 + .1 * east + .2 * north, 9);
      }
      expect(s.intervals.reduce((sum, v) => sum + v.to - v.from, 0)).toBeCloseTo(s.length, 12);
    }
  }
});

test('terrain sections expose a narrow internal hole, crossing height functions, vertical projections and missing terrain', () => {
  const flat = () => 100;
  const hole = terrainSections(model([patch('left', -100, .1, flat), patch('right', .3, 100, flat)]), footprint)[0];
  const gap = hole.intervals.filter(v => v.status === 'uncovered');
  expect(gap).toHaveLength(1); expect(gap[0].from).toBeCloseTo(20.1, 12); expect(gap[0].to).toBeCloseTo(20.3, 12);
  expect(hole.intervals.some(v => v.status === 'unique' && v.from < 20.2 && v.to > 20.2)).toBe(false);
  const crossing = terrainSections(model([patch('up', -100, 100, e => 100 + e), patch('down', -100, 100, e => 100 - e)]), footprint)[0];
  expect(crossing.intervals.every(v => v.status === 'ambiguous')).toBe(true);
  expect(crossing.points.find(p => p.distance === 20)).toMatchObject({ status: 'unique', elevations: [100] });
  const wall: CityFeature = { id: 'vertical', layer: 'terrain', triangleCount: 1, positions: [0, 0, 10, 0, 10, 10, 0, 0, -10] };
  const vertical = terrainSections(model([patch('floor', -100, 100, flat), wall]), footprint);
  expect(vertical[0].points.find(p => p.distance === 20)?.status).toBe('ambiguous');
  expect(vertical[1].intervals.some(v => v.status === 'ambiguous')).toBe(true);
  expect(terrainSections(model([]), footprint).every(s => s.intervals.length === 1 && s.intervals[0].status === 'uncovered')).toBe(true);
  expect(() => terrainSections(model(), { ...footprint, width: NaN })).toThrow('断面長');
  expect(() => terrainSections(model(Array.from({ length: 65 }, (_, i) => patch(`overlap-${i}`))), footprint)).toThrow('64面');
});

test('section CSV retains interval and point states, provenance, raw precision and independent CSV parsing', () => {
  const m = model([patch('left', -100, .1, () => 100), patch('right', .3, 100, () => 100)]);
  const csv = citySectionCSV({ title: '合成例', model: m, footprint, sources: [{ name: 'fixture.gml', bytes: 25, sha256: 'a'.repeat(64) }],
    inspected_at: '2026-10-13T00:00:00Z', source_url: 'https://example.invalid/synthetic', attribution: '合成例', usage_terms: 'テスト用', data_kind: 'synthetic', dataset: null }, terrainSections(m, footprint), '2026-10-13T00:01:00Z');
  const rows = JSON.parse(execFileSync('python3', ['-c', 'import csv,io,json,sys; print(json.dumps(list(csv.DictReader(io.StringIO(sys.stdin.read().lstrip("\\ufeff")), strict=True))))'], { input: csv, encoding: 'utf8' }));
  expect(rows.every((r: object) => !('null' in r))).toBe(true);
  const gap = rows.find((r: { axis: string; row_type: string; status: string }) => r.axis === 'east_west' && r.row_type === 'interval' && r.status === 'uncovered');
  expect(Number(gap.start_distance_m)).toBeCloseTo(20.1, 12); expect(gap.start_elevation_m).toBe(''); expect(gap.end_elevation_m).toBe('');
  expect(gap.attribution).toBe('合成例'); expect(gap.whole_footprint_coverage_verified).toBe('false');
  expect(gap.numerical_solver_linked).toBe('false'); expect(JSON.parse(gap.source_files_json)[0].sha256).toBe('a'.repeat(64));
});

const xml = `<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:gml="http://www.opengis.net/gml" xmlns:dem="http://www.opengis.net/citygml/relief/2.0" srsName="urn:doboku:crs:local-metre" srsDimension="3"><core:cityObjectMember><dem:ReliefFeature gml:id="plane"><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>-100 -100 70 100 -100 90 100 100 130 -100 100 110 -100 -100 70</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></dem:ReliefFeature></core:cityObjectMember></core:CityModel>`;

test('terrain section views and CSV use confirmed geometry and invalidate after confirmation or model replacement', async ({ page }) => {
  await page.route('**/api/**', r => r.abort()); await page.goto('/?view=city');
  await page.getByRole('button', { name: '合成都市デモを表示', exact: true }).click();
  await page.getByLabel('CityGMLファイル', { exact: true }).setInputFiles({ name: 'plane.gml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.getByRole('button', { name: 'CityGMLを点検・プレビュー', exact: true }).click();
  await page.getByRole('button', { name: '確認して都市モデルを表示', exact: true }).click();
  const show = page.getByRole('button', { name: '反映済み範囲の地形断面を表示', exact: true }), csv = page.getByRole('button', { name: '施工範囲の地形断面CSVを保存', exact: true });
  await expect(show).toBeDisabled(); await expect(csv).toBeDisabled();
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click(); await show.click();
  await expect(page.getByRole('img', { name: '東西の地形断面', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: '南北の地形断面', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '東西の断面結果' })).toContainText('長さ 40 m');
  await page.getByLabel('施工範囲の幅 (m)', { exact: true }).fill('55');
  await expect(page.getByRole('region', { name: '東西の断面結果' })).toContainText('長さ 40 m');
  const event = page.waitForEvent('download'); await csv.click();
  const data = await readFile((await (await event).path())!, 'utf8'); expect(data).toContain('"40","30","100"');
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  await expect(csv).toBeDisabled(); await expect(page.getByRole('img', { name: '東西の地形断面', exact: true })).toHaveCount(0);
  await show.click(); await expect(page.getByRole('region', { name: '東西の断面結果' })).toContainText('長さ 55 m');
  await page.getByRole('button', { name: '合成都市デモを表示', exact: true }).click(); await expect(csv).toBeDisabled();
});

test('public Yokohama centerline sections export licensed provenance without API writes', async ({ page }) => {
  const posts: string[] = []; page.on('request', r => { if (r.method() === 'POST') posts.push(r.url()); });
  await page.route('**/api/**', r => r.abort()); await page.goto('/?view=city');
  await expect(page.getByRole('heading', { name: '横浜・みなとみらい（PLATEAU 2024）', exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  await page.getByRole('button', { name: '反映済み範囲の地形断面を表示', exact: true }).click();
  await expect(page.getByRole('img', { name: '東西の地形断面', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: '南北の地形断面', exact: true })).toBeVisible();
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: '施工範囲の地形断面CSVを保存', exact: true }).click();
  const data = await readFile((await (await event).path())!, 'utf8');
  expect(data).toContain('国土交通省'); expect(data).toContain('CC BY 4.0'); expect(data).toContain('https://creativecommons.org/licenses/by/4.0/');
  expect(data).toContain('"east_west","interval"'); expect(data).toContain('"south_north","interval"');
  expect(posts).toEqual([]);
  await page.getByRole('region', { name: '東西の断面結果' }).screenshot({ path: '../../.local/city-sections-yokohama-20261013.png' });
});
