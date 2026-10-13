import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { CityModel, CityFeature } from '../src/cityModel';
import { buildCityTransectReport, buildCityTransectReportFromSnapshot } from '../src/cityTransectReport';
import { inspectCityTransectArchive, cityTransectFileLimit } from '../src/cityTransectRestore';

function patch(id: string, x0 = -100, x1 = 100, h = (e: number, n: number) => 100 + .1 * e + .2 * n): CityFeature {
  const v = (e: number, n: number) => [e, h(e, n) - 100, -n];
  return { id, layer: 'terrain', triangleCount: 2, positions: [v(x0, -100), v(x1, -100), v(x1, 100), v(x0, -100), v(x1, 100), v(x0, 100)].flat() };
}
const model = (features = [patch('plane')]): CityModel => ({ crs: 'urn:doboku:crs:local-metre', origin: [0, 0, 100], bounds: { min: [-100, -100, -100], max: [100, 100, 100] }, features, polygonCount: features.length * 2, lod: 1 });
const line = { start: { east: -3, north: -4 }, end: { east: 3, north: 4 } };
const input = (m = model()) => ({ title: '合成平面', model: m, footprint: { east: 0, north: 0, width: 40, length: 30, elevation: 100 }, sources: [{ name: 'plane.gml', bytes: 25, sha256: 'a'.repeat(64) }], inspected_at: '2026-10-13T00:00:00Z', source_url: '', attribution: '合成例', usage_terms: 'テスト用', data_kind: 'synthetic' as const, dataset: null });

test('archived arbitrary lines recut exactly, ignore object key order and retain historical UTC precision in all exports', async ({ page }) => {
  const i = input(), original = buildCityTransectReport(i, line).snapshot;
  original.generated_at = '2024-01-02T03:04:05.123456789+00:00'; original.inspected_at = '2024-01-01T01:00:00.999999Z'; original.transect_inspected_at = '2024-01-02T03:00:00Z';
  const reorder = (v: unknown): unknown => Array.isArray(v) ? v.map(reorder) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reorder(x)])) : v;
  const restored = inspectCityTransectArchive(reorder(original), { ...i, inspected_at: '2026-10-13T01:00:00Z' }); expect(restored.snapshot).toEqual(original); expect(restored.verifiedAt).not.toBe(original.generated_at);
  const report = buildCityTransectReportFromSnapshot(restored.snapshot); expect(report.snapshot).toEqual(original); expect(report.csv).toContain(original.generated_at);
  await page.setContent(report.html); expect(JSON.parse((await page.locator('#city-transect-snapshot').textContent())!)).toEqual(original); await expect(page.locator('[data-section-probe]')).toHaveCount(0);
  original.sources[0].sha256 = 'b'.repeat(64); expect(restored.snapshot.sources[0].sha256).toBe('a'.repeat(64));
  const reverse = buildCityTransectReport(i, { start: line.end, end: line.start }).snapshot; expect(inspectCityTransectArchive(reverse, i).snapshot).toEqual(reverse);
});

test('archive rejects altered geometry metadata units methods flags versions timestamps and sparse or deeply nested values', () => {
  const i = input(), s = buildCityTransectReport(i, line).snapshot;
  const changes: ((v: typeof s) => void)[] = [v => { v.schema_version = 2; }, v => { v.report_type = 'other'; }, v => { v.numerical_solver_linked = true; }, v => { v.sources[0].sha256 = 'b'.repeat(64); }, v => { v.origin[2]++; }, v => { v.origin_axis_units[2] = 'ft'; }, v => { v.footprint.width++; }, v => { v.terrain_transect.unit_direction.east = 1; }, v => { v.terrain_transect.profile.points[0].elevations[0]++; }, v => { v.terrain_transect.profile.intervals[0].curves[0].from++; }, v => { v.terrain_transect.profile.points.reverse(); }, v => { v.terrain_transect.shared_height_tolerance_m = .1; }, v => { v.terrain_transect.method = 'other'; }, v => { v.terrain_transect.line.end.east = 101; }, v => { v.generated_at = '2024-02-30T00:00:00Z'; }, v => { v.inspected_at = '2024-01-01T00:00:00+09:00'; }, v => { v.transect_inspected_at = 'invalid'; }];
  for (const change of changes) { const v = structuredClone(s); change(v); expect(() => inspectCityTransectArchive(v, i)).toThrow(); }
  expect(() => inspectCityTransectArchive({ ...s, extra: true }, i)).toThrow(); expect(() => inspectCityTransectArchive({ ...s, terrain_transect: { ...s.terrain_transect, profile: { ...s.terrain_transect.profile, axis: 'east_west' } } }, i)).toThrow();
  const sparse = structuredClone(s); delete sparse.terrain_transect.profile.points[0]; expect(() => inspectCityTransectArchive(sparse, i)).toThrow();
  for (const value of [null, [], { ...s, generated_at: NaN }, { ...s, sources: new Date() }, { ...s, extra: Array.from({ length: 70 }).reduce<unknown>(v => [v], null) }]) expect(() => inspectCityTransectArchive(value, i)).toThrow();
});

test('restored holes and multiple heights remain uncomputed and filling them in an archive cannot pass recutting', () => {
  for (const m of [model([patch('left', -100, .1), patch('right', .3, 100)]), model([patch('low', -100, 100, () => 99), patch('high', -100, 100, () => 101)])]) {
    const i = input(m), original = buildCityTransectReport(i, line).snapshot;
    expect(inspectCityTransectArchive(original, i).snapshot).toEqual(original);
    const tampered = structuredClone(original);
    for (const p of tampered.terrain_transect.profile.points) { p.status = 'unique'; p.elevations = [100]; }
    for (const v of tampered.terrain_transect.profile.intervals) { v.status = 'unique'; v.curves = [{ from: 100, to: 100 }]; }
    expect(() => inspectCityTransectArchive(tampered, i)).toThrow('再切断');
  }
});

const inspectName = '保存断面を点検・元地形と照合', confirmName = '確認して保存指定線の断面を表示';
async function download(page: Page, name = '指定線の断面JSONを保存') { const event = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); return readFile((await (await event).path())!, 'utf8'); }
async function file(page: Page, value: unknown, name = 'saved.json') { await page.getByLabel('指定線の保存断面JSON', { exact: true }).setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)) }); }
async function create(page: Page) { await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click(); for (const [i, label] of ['始点の東 (m)', '始点の北 (m)', '終点の東 (m)', '終点の北 (m)'].entries()) await page.getByLabel(`指定線 ${label}`, { exact: true }).fill(String([-3, -4, 3, 4][i])); await page.getByRole('button', { name: '指定線を点検・プレビュー', exact: true }).click(); await page.getByRole('button', { name: '確認して任意方向の断面を表示', exact: true }).click(); }

test('public Yokohama archive reopens after reload with review, old timestamps and source heights while preserving river storage', async ({ page, request }) => {
  const project = await (await request.get('/api/projects/sample-river')).json(), history = await (await request.get('/api/projects/sample-river/runs')).json();
  await page.goto('/?view=city'); await create(page); const original = JSON.parse(await download(page)); original.generated_at = '2024-01-02T03:04:05.123456789+00:00'; original.transect_inspected_at = '2024-01-02T03:00:00Z';
  await page.reload(); await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click(); await file(page, original); await page.getByRole('button', { name: inspectName, exact: true }).click();
  const preview = page.getByRole('region', { name: '保存指定線の確認プレビュー', exact: true }); await expect(preview).toBeVisible(); await expect(page.getByRole('status', { name: '指定線の3D表示', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: '指定線の断面JSONを保存', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: confirmName, exact: true }).click(); expect(JSON.parse(await download(page))).toEqual(original); await expect(page.getByRole('status', { name: '保存指定線の照合日時', exact: true })).toBeVisible(); await expect(page.getByRole('status', { name: '指定線の3D表示', exact: true })).toBeVisible();
  await page.getByRole('spinbutton', { name: '指定線の照会距離 (m)', exact: true }).fill('2.5'); await expect(page.getByRole('status', { name: '指定線照会位置の3D表示', exact: true })).toBeVisible();
  const html = await download(page, '指定線の断面HTMLを保存'), other = await page.context().newPage(); await other.route('**/*', r => r.abort()); await other.setContent(html); expect(JSON.parse((await other.locator('#city-transect-snapshot').textContent())!)).toEqual(original); await other.close();
  expect(original.attribution).toContain('PLATEAU'); expect(original.usage_terms).toContain('CC BY'); expect(await (await request.get('/api/projects/sample-river')).json()).toEqual(project); expect(await (await request.get('/api/projects/sample-river/runs')).json()).toEqual(history);
});

test('invalid files, changed source and cancelled review preserve existing results and API-free restoration works', async ({ page }) => {
  await page.route('**/api/**', r => r.abort()); await page.goto('/?view=city'); await create(page); const original = JSON.parse(await download(page)), active = page.getByRole('region', { name: '任意方向の断面結果', exact: true });
  for (const value of ['{', { ...original, attribution: 'foreign' }, { ...original, schema_version: 99 }]) { await file(page, value); await page.getByRole('button', { name: inspectName, exact: true }).click(); await expect(page.getByRole('region', { name: '保存指定線の断面を復元', exact: true }).getByRole('alert')).toBeVisible(); await expect(active).toBeVisible(); expect(JSON.parse(await download(page))).toEqual(original); }
  await page.getByLabel('指定線の保存断面JSON', { exact: true }).setInputFiles({ name: 'large.json', mimeType: 'application/json', buffer: Buffer.alloc(cityTransectFileLimit + 1) }); await page.getByRole('button', { name: inspectName, exact: true }).click(); await expect(page.getByRole('region', { name: '保存指定線の断面を復元', exact: true })).toContainText('8MiB'); expect(JSON.parse(await download(page))).toEqual(original);
  await file(page, original); await page.getByRole('button', { name: inspectName, exact: true }).click(); await page.getByRole('button', { name: '保存断面の点検を取消', exact: true }).click(); await expect(page.getByRole('region', { name: '保存指定線の確認プレビュー', exact: true })).toHaveCount(0); expect(JSON.parse(await download(page))).toEqual(original);
  await page.getByLabel('指定線 終点の北 (m)', { exact: true }).fill('5'); await page.getByRole('button', { name: '指定線を点検・プレビュー', exact: true }).click(); await page.getByRole('button', { name: '確認して任意方向の断面を表示', exact: true }).click();
  await file(page, original); await page.getByRole('button', { name: inspectName, exact: true }).click(); await page.getByRole('button', { name: confirmName, exact: true }).click(); await expect(page.getByLabel('指定線 終点の北 (m)', { exact: true })).toHaveValue('4'); expect(JSON.parse(await download(page))).toEqual(original);
});

test('delayed file reads cannot revive previews after file edit cancellation geometry reconfirmation or model replacement', async ({ page }) => {
  await page.goto('/?view=city'); await create(page); const original = JSON.parse(await download(page));
  await page.evaluate(() => {
    const read = File.prototype.text;
    File.prototype.text = function () { if (this.name !== 'delayed.json') return read.call(this); (window as unknown as { archiveWaiting: boolean }).archiveWaiting = true; return new Promise<string>(resolve => { (window as unknown as { releaseArchive: () => void }).releaseArchive = () => { read.call(this).then(resolve); }; }); };
  });
  for (const action of ['file', 'cancel', 'coordinate', 'footprint', 'source']) {
    await page.evaluate(() => { (window as unknown as { archiveWaiting: boolean }).archiveWaiting = false; }); await file(page, original, 'delayed.json'); await page.getByRole('button', { name: inspectName, exact: true }).click(); await page.waitForFunction(() => (window as unknown as { archiveWaiting: boolean }).archiveWaiting);
    if (action === 'file') await file(page, original, 'replacement.json');
    if (action === 'cancel') await page.getByRole('button', { name: '保存断面の点検を取消', exact: true }).click();
    if (action === 'coordinate') await page.getByLabel('指定線 終点の北 (m)', { exact: true }).fill('5');
    if (action === 'footprint') await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
    if (action === 'source') await page.getByRole('button', { name: '合成都市デモを表示', exact: true }).click();
    await page.evaluate(() => { (window as unknown as { releaseArchive: () => void }).releaseArchive(); });
    await page.getByRole('button', { name: '都市を真上から', exact: true }).click(); await expect(page.getByRole('region', { name: '保存指定線の確認プレビュー', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: confirmName, exact: true })).toHaveCount(0);
  }
});
