import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { buildCityReport } from '../src/cityReport';
import type { CityModel } from '../src/cityModel';

const ground = { id: 'plane', layer: 'terrain' as const, triangleCount: 2, positions: [
  -100, -30, 100, 100, -10, 100, 100, 30, -100, -100, -30, 100, 100, 30, -100, -100, 10, -100,
] };
const model: CityModel = { crs: 'urn:doboku:crs:local-metre', origin: [0, 0, 100], features: [ground], bounds: { min: [-100, -30, -100], max: [100, 100, 100] }, polygonCount: 2, lod: 1 };
const input = { title: '合成傾斜平面', model, footprint: { east: 0, north: 0, width: 40, length: 30, elevation: 100 }, sources: [], inspected_at: '2026-10-13T00:00:00Z', source_url: '', attribution: '合成例', usage_terms: 'テスト用', data_kind: 'synthetic' as const, dataset: null };
const timestamp = '2026-10-13T01:00:00.000Z';

test('city report formats retain original coordinates, analytic heights, source hashes and unsupported states', () => {
  const report = buildCityReport(input, timestamp);
  expect(report.snapshot.terrain_inspection.samples.map(s => s.elevations[0])).toEqual([100, 95, 99, 105, 101]);
  expect(report.snapshot).toMatchObject({ generated_at: timestamp, numerical_solver_linked: false, whole_footprint_coverage_verified: false, origin_axis_units: ['m', 'm', 'm'] });
  expect(report.csv).toContain('"南西","-20","-15","unique","95"');
  expect(report.csv.charCodeAt(0)).toBe(0xFEFF); expect(report.csv).toContain('\r\n');
  expect(report.csv).toContain('"合成例","テスト用","","null"');
  // Independent RFC CSV parser verifies column alignment and numeric signs.
  const rows = JSON.parse(execFileSync('python3', ['-c', 'import csv,io,json,sys; print(json.dumps(list(csv.DictReader(io.StringIO(sys.stdin.read().lstrip("\\ufeff")), strict=True))))'], { input: report.csv, encoding: 'utf8' }));
  expect(rows).toHaveLength(5); expect(rows.every((r: object) => !('null' in r))).toBe(true);
  expect(rows[1]).toMatchObject({ point: '南西', east_m: '-20', north_m: '-15', elevation_m: '95', crs: model.crs, lod: '1', attribution: '合成例', usage_terms: 'テスト用' });
  const missing = buildCityReport({ ...input, model: { ...model, features: [] } }, timestamp);
  expect(missing.snapshot.terrain_inspection.samples.every(s => s.status === 'uncovered')).toBe(true);
  expect(missing.csv).toContain('"中心","0","0","uncovered","","[]"');
  expect(missing.html).toContain('地形なし');
  const raised = { ...ground, id: 'raised', positions: ground.positions.map((v, i) => i % 3 === 1 ? v + 10 : v) };
  const ambiguous = buildCityReport({ ...input, model: { ...model, features: [ground, raised] } }, timestamp);
  expect(ambiguous.snapshot.terrain_inspection.samples[0]).toMatchObject({ status: 'ambiguous', elevations: [100, 110] });
  expect(ambiguous.csv).toContain('"中心","0","0","ambiguous","","[100,110]"');
  expect(ambiguous.html).toContain('高さが一意でない');
  expect(() => buildCityReport({ ...input, footprint: { ...input.footprint, east: 99 } }, timestamp)).toThrow('有効な施工範囲');
  expect(() => buildCityReport(input, 'not-a-date')).toThrow('作成日時');
  expect(buildCityReport(input, '2026-10-13T10:00:00+09:00').snapshot.generated_at).toBe(timestamp);
});

test('imported report text cannot inject HTML or spreadsheet formulas', async ({ page }) => {
  const malicious = '</pre><script>window.reportInjected=true</script><img src="https://example.invalid/x">';
  const id = '=HYPERLINK("https://example.invalid","x")';
  const report = buildCityReport({ ...input, title: malicious, attribution: malicious, source_url: 'javascript:alert(1)',
    model: { ...model, features: [{ ...ground, id }] }, sources: [{ name: malicious, bytes: 25, sha256: 'a'.repeat(64) }] }, timestamp);
  expect(report.csv).toContain('"\'=HYPERLINK(""https://example.invalid"",""x"")"');
  const requests: string[] = []; page.on('request', r => { if (r.url().startsWith('http')) requests.push(r.url()); });
  await page.setContent(report.html);
  expect(await page.evaluate(() => 'reportInjected' in window)).toBe(false);
  await expect(page.locator('script, img, iframe')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '都市地形・施工範囲の確認資料', exact: true })).toBeVisible();
  const snapshot = JSON.parse(await page.locator('#city-report-snapshot').textContent() as string);
  expect(snapshot.title).toBe(malicious); expect(snapshot.sources[0].sha256).toBe('a'.repeat(64));
  const href = (await page.getByRole('link', { name: 'この資料と同じ条件のCSVを保存' }).getAttribute('href'))!;
  expect(decodeURIComponent(href.split(',').slice(1).join(','))).toBe(report.csv);
  expect(requests).toEqual([]);
});

const xml = `<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:gml="http://www.opengis.net/gml" xmlns:dem="http://www.opengis.net/citygml/relief/2.0" srsName="urn:doboku:crs:local-metre" srsDimension="3"><core:cityObjectMember><dem:ReliefFeature gml:id="plane"><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>-100 -100 70 100 -100 90 100 100 130 -100 100 110 -100 -100 70</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></dem:ReliefFeature></core:cityObjectMember></core:CityModel>`;
async function download(page: Page, name: string) {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click();
  return readFile((await (await event).path())!, 'utf8');
}

test('city report exports confirmed footprints only and remains usable offline with the exact companion CSV', async ({ page, context }) => {
  await page.route('**/api/**', r => r.abort()); await page.goto('/?view=city');
  await page.getByRole('button', { name: '合成都市デモを表示', exact: true }).click();
  const htmlButton = page.getByRole('button', { name: '施工範囲の確認資料HTMLを保存', exact: true });
  await expect(htmlButton).toBeDisabled();
  await page.getByLabel('CityGMLファイル', { exact: true }).setInputFiles({ name: 'plane.gml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.getByRole('button', { name: 'CityGMLを点検・プレビュー', exact: true }).click();
  await page.getByRole('button', { name: '確認して都市モデルを表示', exact: true }).click();
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  await page.getByLabel('施工範囲の東方向 (m)', { exact: true }).fill('20');
  await page.getByLabel('施工範囲の幅 (m)', { exact: true }).fill('55');
  const html = await download(page, '施工範囲の確認資料HTMLを保存');
  const csv = await download(page, '施工範囲の地形5点CSVを保存');
  expect(csv).toContain('"中心","0","0","unique","100"');
  const offline = await context.newPage(); const requests: string[] = [];
  offline.on('request', r => { if (r.url().startsWith('http')) requests.push(r.url()); });
  await offline.route('**/*', r => r.abort()); await offline.setContent(html);
  const snapshot = JSON.parse(await offline.locator('#city-report-snapshot').textContent() as string);
  expect(snapshot.footprint).toMatchObject({ east: 0, width: 40 }); expect(snapshot.data_kind).toBe('unspecified');
  expect(snapshot.terrain_inspection.samples[0].elevations).toEqual([100]);
  expect(snapshot.sources[0].name).toBe('plane.gml');
  await expect(offline.getByRole('img', { name: '施工範囲の5点確認配置図' })).toBeVisible();
  await expect(offline.getByRole('table', { name: '地形5点の確認結果' })).toContainText('100');
  const companion = offline.waitForEvent('download');
  await offline.getByRole('link', { name: 'この資料と同じ条件のCSVを保存' }).click();
  const companionCSV = await readFile((await (await companion).path())!, 'utf8');
  expect(companionCSV).toContain(`"${snapshot.generated_at}"`);
  expect(companionCSV).toContain('"中心","0","0","unique","100"');
  expect(requests).toEqual([]); await offline.close();
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  expect(await download(page, '施工範囲の地形5点CSVを保存')).toContain('"中心","20","0","unique","102"');
  await page.getByRole('button', { name: '施工範囲を非表示', exact: true }).click(); await expect(htmlButton).toBeDisabled();
  await page.getByRole('button', { name: '合成都市デモを表示', exact: true }).click(); await expect(htmlButton).toBeDisabled();
});

test('public Yokohama reports retain licensed original provenance and independent marker and ground elevations', async ({ page, context }) => {
  const posts: string[] = []; page.on('request', r => { if (r.method() === 'POST') posts.push(r.url()); });
  await page.route('**/api/**', r => r.abort()); await page.goto('/?view=city');
  await expect(page.getByRole('heading', { name: '横浜・みなとみらい（PLATEAU 2024）', exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  const html = await download(page, '施工範囲の確認資料HTMLを保存');
  const csv = await download(page, '施工範囲の地形5点CSVを保存');
  expect(csv).toContain('国土交通省'); expect(csv).toContain('CC BY 4.0');
  expect(csv).toContain('https://creativecommons.org/licenses/by/4.0/');
  const offline = await context.newPage(); await offline.route('**/*', r => r.abort()); await offline.setContent(html);
  const snapshot = JSON.parse(await offline.locator('#city-report-snapshot').textContent() as string);
  expect(snapshot.data_kind).toBe('public_city_model'); expect(snapshot.dataset.license).toBe('CC BY 4.0');
  expect(snapshot.dataset.terrain_triangles).toBe(12206); expect(snapshot.sources).toHaveLength(2);
  expect(snapshot.attribution).toContain('国土交通省'); expect(snapshot.usage_terms).toContain('原メタデータで確認');
  expect(snapshot.sources.find((s: { name: string }) => s.name === 'terrain.gml').sha256).toBe('8528615ce11b65a7d2f095cd9e1b696cae14d24a1f310d17577b62d64d2a520b');
  expect(snapshot.origin_axis_units).toEqual(['degree', 'degree', 'm']);
  expect(snapshot.footprint.elevation).toBeGreaterThan(100);
  expect(snapshot.terrain_inspection.samples[0].status).toBe('unique');
  expect(snapshot.terrain_inspection.samples[0].elevations[0]).toBeLessThan(10);
  expect(snapshot.numerical_solver_linked).toBe(false); expect(snapshot.whole_footprint_coverage_verified).toBe(false);
  await expect(offline.getByText('同梱モデルの原出典・利用条件を確認', { exact: false })).toBeVisible();
  await offline.screenshot({ path: '../../.local/city-report-yokohama-20261013.png' });
  expect(posts).toEqual([]); await offline.close();
});
