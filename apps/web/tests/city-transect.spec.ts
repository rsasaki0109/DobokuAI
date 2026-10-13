import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import type { CityModel, CityFeature } from '../src/cityModel';
import { traceTerrainTransect, transectCoordinate } from '../src/cityTransect';
import { buildCityTransectReport } from '../src/cityTransectReport';

function patch(id: string, x0 = -100, x1 = 100, height = (e: number, n: number) => 100 + .1 * e + .2 * n): CityFeature {
  const v = (e: number, n: number) => [e, height(e, n) - 100, -n];
  return { id, layer: 'terrain', triangleCount: 2, positions: [v(x0, -100), v(x1, -100), v(x1, 100), v(x0, -100), v(x1, 100), v(x0, 100)].flat() };
}
const model = (features = [patch('plane')]): CityModel => ({ crs: 'urn:doboku:crs:local-metre', origin: [0, 0, 100], bounds: { min: [-100, -100, -100], max: [100, 100, 100] }, features, polygonCount: features.length * 2, lod: 1 });
const line = { start: { east: -3, north: -4 }, end: { east: 3, north: 4 } };
const input = (m = model()) => ({ title: '合成平面', model: m, footprint: { east: 0, north: 0, width: 40, length: 30, elevation: 100 }, sources: [{ name: 'plane.gml', bytes: 25, sha256: 'a'.repeat(64) }], inspected_at: '2026-10-13T00:00:00Z', source_url: '', attribution: '合成例', usage_terms: 'テスト用', data_kind: 'synthetic' as const, dataset: null });

test('arbitrary diagonal and reversed transects match the independent analytic plane without changing original geometry', () => {
  const m = model(), original = structuredClone(m);
  for (const l of [line, { start: line.end, end: line.start }, { start: { east: -20, north: 7 }, end: { east: 20, north: 7 } }]) {
    const result = traceTerrainTransect(m, l);
    expect(result.line).toEqual(l); expect(result.profile).not.toHaveProperty('axis');
    expect(result.profile.length).toBeCloseTo(Math.hypot(l.end.east - l.start.east, l.end.north - l.start.north), 12);
    expect(transectCoordinate(result, 0)).toEqual(l.start); expect(transectCoordinate(result, result.profile.length)).toEqual(l.end);
    expect(result.profile.intervals.every(v => v.status === 'unique')).toBe(true);
    for (const p of result.profile.points) { const c = transectCoordinate(result, p.distance); expect(p.status).toBe('unique'); expect(Math.abs(p.elevations[0] - (100 + .1 * c.east + .2 * c.north))).toBeLessThan(1e-10); }
    for (const v of result.profile.intervals) for (const [d, h] of [[v.from, v.curves[0].from], [v.to, v.curves[0].to]]) { const c = transectCoordinate(result, d); expect(Math.abs(h - (100 + .1 * c.east + .2 * c.north))).toBeLessThan(1e-10); }
  }
  expect(m).toEqual(original);
});

test('diagonal holes remain uncovered, overlapping heights and vertical faces remain unresolved, invalid lines and limits stop inspection', () => {
  const hole = traceTerrainTransect(model([patch('left', -100, .1, () => 100), patch('right', .10001, 100, () => 100)]), line);
  const gaps = hole.profile.intervals.filter(v => v.status === 'uncovered'); expect(gaps).toHaveLength(1);
  expect(Math.abs(gaps[0].from - (3.1 / .6))).toBeLessThan(1e-10); expect(Math.abs((gaps[0].to - gaps[0].from) - .00001 / .6)).toBeLessThan(1e-10);
  const overlap = traceTerrainTransect(model([patch('low', -100, 100, () => 99), patch('high', -100, 100, () => 101)]), line);
  expect(overlap.profile.intervals.every(v => v.status === 'ambiguous' && v.curves.length === 2)).toBe(true);
  const wall: CityFeature = { id: 'wall', layer: 'terrain', triangleCount: 1, positions: [0, 0, 10, 0, 10, 10, 0, 0, -10] };
  expect(traceTerrainTransect(model([patch('floor'), wall]), line).profile.points.some(p => p.status === 'ambiguous' && p.features.includes('wall'))).toBe(true);
  expect(traceTerrainTransect(model([]), line).profile.intervals[0].status).toBe('uncovered');
  for (const l of [{ start: line.start, end: line.start }, { start: line.start, end: { east: NaN, north: 0 } }, { start: line.start, end: { east: 101, north: 0 } }]) expect(() => traceTerrainTransect(model(), l)).toThrow();
  expect(() => traceTerrainTransect(model(Array.from({ length: 65 }, (_, i) => patch(String(i)))), line)).toThrow('64面');
  expect(() => transectCoordinate(hole, 11)).toThrow('範囲外');
});

test('transect HTML and independently parsed CSV retain original coordinates source hashes and unknown heights safely offline', async ({ page }) => {
  const i = input(model([patch('left', -100, .1), patch('right', .3, 100)]));
  i.title = '</pre><script>window.injected=true</script><img src="https://example.invalid/x">'; i.attribution = '=1+1';
  const report = buildCityTransectReport(i, line, '2026-10-13T01:00:00Z');
  const rows = JSON.parse(execFileSync('python3', ['-c', 'import csv,io,json,sys; print(json.dumps(list(csv.DictReader(io.StringIO(sys.stdin.read().lstrip("\\ufeff")), strict=True))))'], { input: report.csv, encoding: 'utf8' }));
  expect(rows[0]).toMatchObject({ east_from_m: '-3', north_from_m: '-4', numerical_solver_linked: 'false', attribution: "'=1+1" });
  const gap = rows.find((r: { kind: string; status: string }) => r.kind === 'interval' && r.status === 'uncovered'); expect(gap.height_candidates_m).toBe(''); expect(Number(gap.east_from_m)).toBeCloseTo(.1, 10);
  expect(JSON.parse(rows[0].source_files)[0].sha256).toBe('a'.repeat(64));
  expect(report.snapshot.terrain_transect.profile).not.toHaveProperty('axis'); expect(report.snapshot).not.toHaveProperty('terrain_inspection');
  i.sources[0].sha256 = 'b'.repeat(64); expect(report.snapshot.sources[0].sha256).toBe('a'.repeat(64));
  const requests: string[] = []; page.on('request', r => requests.push(r.url())); await page.setContent(report.html);
  await expect(page.locator('script,img,iframe')).toHaveCount(0); expect(await page.evaluate(() => 'injected' in window)).toBe(false);
  expect(JSON.parse((await page.locator('#city-transect-snapshot').textContent())!)).toEqual(report.snapshot);
  await expect(page.getByRole('img', { name: '指定線の地形断面', exact: true })).toContainText('始点 → 終点');
  const href = await page.getByRole('link', { name: 'この指定線のCSVを保存', exact: true }).getAttribute('href'); expect(decodeURIComponent(href!.split(',').slice(1).join(','))).toBe(report.csv); expect(requests).toEqual([]);
});

test('source vertical oblique faces cannot become unique ground through rotation roundoff', () => {
  const m: CityModel = { ...model(), bounds: { min: [-3000, -100, -3000], max: [3000, 200, 3000] }, features: [{ id: 'vertical-oblique', layer: 'terrain', triangleCount: 1, positions: [300, 0, -400, 600, 100, -800, 900, 0, -1200] }] };
  const l = { start: { east: 0, north: -10 }, end: { east: 1700, north: 2290 } };
  for (const direction of [l, { start: l.end, end: l.start }]) {
    const result = traceTerrainTransect(m, direction);
    expect(result.profile.points.some(p => p.features.includes('vertical-oblique'))).toBe(true);
    expect(result.profile.points.every(p => p.status !== 'unique')).toBe(true);
    expect(result.profile.intervals.every(v => v.status !== 'unique')).toBe(true);
    expect(result.profile.intervals.flatMap(v => v.curves)).toEqual([]);
  }
});

const xml = `<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:gml="http://www.opengis.net/gml" xmlns:dem="http://www.opengis.net/citygml/relief/2.0" srsName="urn:doboku:crs:local-metre" srsDimension="3"><core:cityObjectMember><dem:ReliefFeature gml:id="plane"><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>-100 -100 70 100 -100 90 100 100 130 -100 100 110 -100 -100 70</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></dem:ReliefFeature></core:cityObjectMember></core:CityModel>`;
async function download(page: Page, name: string) { const event = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); return readFile((await (await event).path())!, 'utf8'); }
async function setLine(page: Page, values: number[]) { for (const [i, label] of ['始点の東 (m)', '始点の北 (m)', '終点の東 (m)', '終点の北 (m)'].entries()) await page.getByLabel(`指定線 ${label}`, { exact: true }).fill(String(values[i])); }
async function inspect(page: Page) { await page.getByRole('button', { name: '指定線を点検・プレビュー', exact: true }).click(); }
async function confirm(page: Page) { await page.getByRole('button', { name: '確認して任意方向の断面を表示', exact: true }).click(); }

test('reviewed diagonal works without API and editing reconfirmation hide and source replacement invalidate results', async ({ page }) => {
  await page.route('**/api/**', r => r.abort()); await page.goto('/?view=city');
  await page.getByLabel('CityGMLファイル', { exact: true }).setInputFiles({ name: 'plane.gml', mimeType: 'application/xml', buffer: Buffer.from(xml) }); await page.getByRole('button', { name: 'CityGMLを点検・プレビュー', exact: true }).click(); await page.getByRole('button', { name: '確認して都市モデルを表示', exact: true }).click();
  await expect(page.getByRole('region', { name: '任意方向の地形断面', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click(); await setLine(page, [-3, -4, 3, 4]); await inspect(page);
  await expect(page.getByRole('region', { name: '指定線の確認プレビュー', exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: '指定線の断面JSONを保存', exact: true })).toHaveCount(0);
  await confirm(page); const saved = JSON.parse(await download(page, '指定線の断面JSONを保存')); expect(saved.terrain_transect.line).toEqual(line); expect(saved.terrain_transect.profile.length).toBe(10);
  for (const p of saved.terrain_transect.profile.points) expect(Math.abs(p.elevations[0] - (98.9 + .22 * p.distance))).toBeLessThan(1e-10);
  const html = await download(page, '指定線の断面HTMLを保存'), other = await page.context().newPage(); await other.route('**/*', r => r.abort()); await other.setContent(html);
  expect(await other.getByRole('img', { name: '指定線の地形断面', exact: true }).innerHTML()).toBe(await page.getByRole('img', { name: '指定線の地形断面', exact: true }).innerHTML()); await other.close();
  await page.getByLabel('指定線 終点の北 (m)', { exact: true }).fill('5'); await expect(page.getByRole('region', { name: '任意方向の断面結果', exact: true })).toHaveCount(0);
  await inspect(page); await page.getByRole('button', { name: '指定線のプレビューを取消', exact: true }).click(); await expect(page.getByRole('region', { name: '指定線の確認プレビュー', exact: true })).toHaveCount(0);
  await inspect(page); await confirm(page); await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click(); await expect(page.getByRole('region', { name: '任意方向の断面結果', exact: true })).toHaveCount(0);
  await inspect(page); await confirm(page); await page.getByRole('button', { name: '施工範囲を非表示', exact: true }).click(); await expect(page.getByRole('region', { name: '任意方向の地形断面', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click(); await inspect(page); await confirm(page); await page.getByRole('button', { name: '合成都市デモを表示', exact: true }).click(); await expect(page.getByRole('region', { name: '任意方向の断面結果', exact: true })).toHaveCount(0);
});

test('public Yokohama diagonal retains CC BY source hashes and source heights without changing river project or history', async ({ page, request }) => {
  const project = await (await request.get('/api/projects/sample-river')).json(), history = await (await request.get('/api/projects/sample-river/runs')).json();
  await page.goto('/?view=city'); await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click(); await setLine(page, [-100, -100, 100, 100]); await inspect(page); await confirm(page);
  const saved = JSON.parse(await download(page, '指定線の断面JSONを保存')); expect(saved.terrain_transect.line).toEqual({ start: { east: -100, north: -100 }, end: { east: 100, north: 100 } });
  expect(saved.attribution).toContain('PLATEAU'); expect(saved.usage_terms).toContain('CC BY'); expect(saved.sources).toHaveLength(2); expect(saved.sources.every((s: { sha256: string }) => s.sha256.length === 64)).toBe(true);
  expect(saved.terrain_transect.profile.points.some((p: { elevations: number[] }) => p.elevations.some(h => h < 0))).toBe(true);
  expect(saved).toMatchObject({ numerical_solver_linked: false, hydraulic_solver_linked: false, volume_calculated: false });
  expect(await (await request.get('/api/projects/sample-river')).json()).toEqual(project); expect(await (await request.get('/api/projects/sample-river/runs')).json()).toEqual(history);
});
