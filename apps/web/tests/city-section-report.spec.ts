import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { buildCitySectionReport } from '../src/citySectionReport';
import { citySectionCSV, citySectionCSVFromSnapshot } from '../src/citySectionCSV';
import { terrainSections } from '../src/citySections';
import type { CityModel, CityFeature } from '../src/cityModel';

function patch(id: string, x0 = -100, x1 = 100, height = (east: number, north: number) => 100 + .1 * east + .2 * north): CityFeature {
  const point = (east: number, north: number) => [east, height(east, north) - 100, -north];
  return { id, layer: 'terrain', triangleCount: 2, positions: [point(x0, -100), point(x1, -100), point(x1, 100), point(x0, -100), point(x1, 100), point(x0, 100)].flat() };
}
const model = (features = [patch('plane')]): CityModel => ({ crs: 'urn:doboku:crs:local-metre', origin: [0, 0, 100], features, bounds: { min: [-100, -100, -100], max: [100, 100, 100] }, polygonCount: features.length * 2, lod: 1 });
const input = { title: '合成平面', model: model(), footprint: { east: 0, north: 0, width: 40, length: 30, elevation: 100 },
  sources: [{ name: 'plane.gml', bytes: 25, sha256: 'a'.repeat(64) }], inspected_at: '2026-10-13T00:00:00Z', source_url: '',
  attribution: '合成例', usage_terms: 'テスト用', data_kind: 'synthetic' as const, dataset: null };
const inspectedAt = '2026-10-13T10:00:00+09:00', generatedAt = '2026-10-13T10:01:00+09:00';

test('centerline report snapshots freeze exact sections, normalize UTC and reject mismatched footprints', () => {
  const sections = terrainSections(input.model, input.footprint), expected = structuredClone(sections);
  const report = buildCitySectionReport(input, sections, inspectedAt, generatedAt);
  expect(report.snapshot).toMatchObject({ report_type: 'city_terrain_centerline_inspection', generated_at: '2026-10-13T01:01:00.000Z',
    sections_inspected_at: '2026-10-13T01:00:00.000Z', whole_footprint_coverage_verified: false, numerical_solver_linked: false });
  expect(report.snapshot.terrain_sections.sections).toEqual(expected);
  expect(report.snapshot).not.toHaveProperty('terrain_inspection');
  expect(report.csv).toBe(citySectionCSV(input, sections, inspectedAt, generatedAt));
  const rows = JSON.parse(execFileSync('python3', ['-c', 'import csv,io,json,sys; print(json.dumps(list(csv.DictReader(io.StringIO(sys.stdin.read().lstrip("\\ufeff")), strict=True))))'], { input: report.csv, encoding: 'utf8' }));
  expect(rows.every((r: { generated_at_utc: string; sections_inspected_at_utc: string }) => r.generated_at_utc === report.snapshot.generated_at && r.sections_inspected_at_utc === report.snapshot.sections_inspected_at)).toBe(true);
  expect(rows[0]).toMatchObject({ start_east_m: '-20', start_elevation_m: '98', attribution: '合成例' });
  sections[0].points[0].elevations[0] = 999;
  expect(report.snapshot.terrain_sections.sections).toEqual(expected);
  expect(() => buildCitySectionReport(input, expected, 'invalid', generatedAt)).toThrow('断面点検日時');
  expect(() => buildCitySectionReport(input, expected, inspectedAt, 'invalid')).toThrow('作成日時');
  expect(() => buildCitySectionReport({ ...input, footprint: { ...input.footprint, east: 1 } }, expected, inspectedAt, generatedAt)).toThrow('位置が一致');
  expect(() => citySectionCSV(input, expected.slice(0, 1), inspectedAt)).toThrow('位置が一致');
  const fractional = { ...input, footprint: { ...input.footprint, east: .17, north: -.13, width: .29, length: .37 } };
  expect(buildCitySectionReport(fractional, terrainSections(fractional.model, fractional.footprint), inspectedAt).snapshot.footprint).toEqual(fractional.footprint);
});

test('offline reports preserve narrow gaps and ambiguous heights while escaping imported text and CSV formulas', async ({ page }) => {
  const malicious = '</pre><script>window.sectionInjected=true</script><img src="https://example.invalid/x">';
  const id = '=HYPERLINK("https://example.invalid","x")';
  const requests: string[] = []; page.on('request', r => { if (r.url().startsWith('http')) requests.push(r.url()); });
  for (const [features, state] of [[ [patch(id, -100, .1, () => 100), patch(malicious, .3, 100, () => 100)], 'uncovered' ],
    [ [patch(id, -100, 100, e => 100 + e), patch(malicious, -100, 100, e => 100 - e)], 'ambiguous' ],
    [ [], 'uncovered' ]] as const) {
    const m = model([...features]), sections = terrainSections(m, input.footprint);
    const report = buildCitySectionReport({ ...input, model: m, title: malicious, attribution: malicious, usage_terms: malicious,
      source_url: id, dataset: { note: malicious }, sources: [{ name: malicious, bytes: 25, sha256: 'a'.repeat(64) }] }, sections, inspectedAt, generatedAt);
    await page.setContent(report.html);
    await expect(page.locator('script,img,iframe')).toHaveCount(0);
    expect(await page.evaluate(() => 'sectionInjected' in window)).toBe(false);
    const snapshot = JSON.parse((await page.locator('#city-section-report-snapshot').textContent())!);
    expect(snapshot.title).toBe(malicious); expect(snapshot.dataset.note).toBe(malicious);
    await expect(page.getByRole('table', { name: '東西の区間判定', exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: '東西の交点判定', exact: true })).toBeVisible();
    if (features.length) {
      expect(report.csv).toContain('"\'=HYPERLINK(""https://example.invalid"",""x"")"');
      const region = page.getByRole('region', { name: '東西の断面結果', exact: true });
      await expect(region.locator(`[data-section-status="${state}"]`)).toHaveCount(sections[0].intervals.filter(v => v.status === state).length);
      await expect(region.locator('[data-terrain-line]')).toHaveCount(sections[0].intervals.filter(v => v.status === 'unique').length);
      if (state === 'uncovered') {
        const range = sections[0].intervals.find(v => v.status === state)!;
        expect(range.to - range.from).toBeCloseTo(.2, 12);
        expect(Number(await region.locator('[data-section-status="uncovered"]').getAttribute('width'))).toBeCloseTo(510 * .2 / 40, 9);
      }
    } else {
      await expect(page.locator('svg')).toHaveCount(0);
      await expect(page.getByRole('region', { name: '東西の断面結果', exact: true })).toContainText('地形高さを表示できません');
    }
    const href = (await page.getByRole('link', { name: 'この資料と同じ条件の断面CSVを保存' }).getAttribute('href'))!;
    expect(decodeURIComponent(href.substring(href.indexOf(',') + 1))).toBe(report.csv);
  }
  expect(requests).toEqual([]);
});

const xml = `<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:gml="http://www.opengis.net/gml" xmlns:dem="http://www.opengis.net/citygml/relief/2.0" srsName="urn:doboku:crs:local-metre" srsDimension="3"><core:cityObjectMember><dem:ReliefFeature gml:id="plane"><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>-100 -100 70 100 -100 90 100 100 130 -100 100 110 -100 -100 70</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></dem:ReliefFeature></core:cityObjectMember></core:CityModel>`;
async function download(page: Page, name: string) {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click();
  return readFile((await (await event).path())!, 'utf8');
}

test('confirmed section HTML uses the visible SVG, downloads exact CSV offline and invalidates stale results', async ({ page, context }) => {
  await page.route('**/api/**', r => r.abort()); await page.goto('/?view=city');
  await page.getByRole('button', { name: '合成都市デモを表示', exact: true }).click();
  await page.getByLabel('CityGMLファイル', { exact: true }).setInputFiles({ name: 'plane.gml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.getByRole('button', { name: 'CityGMLを点検・プレビュー', exact: true }).click();
  await page.getByRole('button', { name: '確認して都市モデルを表示', exact: true }).click();
  const button = page.getByRole('button', { name: '施工範囲の地形断面HTMLを保存', exact: true });
  await expect(button).toBeDisabled();
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click(); await expect(button).toBeDisabled();
  await page.getByRole('button', { name: '反映済み範囲の地形断面を表示', exact: true }).click();
  const svg = await page.getByRole('img', { name: '東西の地形断面', exact: true }).innerHTML();
  await page.getByLabel('施工範囲の幅 (m)', { exact: true }).fill('55');
  await page.getByLabel('都市モデルの出典', { exact: true }).fill('未反映の出典');
  const html = await download(page, '施工範囲の地形断面HTMLを保存');
  const offline = await context.newPage(), requests: string[] = [];
  offline.on('request', r => { if (r.url().startsWith('http')) requests.push(r.url()); });
  await offline.route('**/*', r => r.abort()); await offline.setContent(html);
  expect(await offline.getByRole('img', { name: '東西の地形断面', exact: true }).innerHTML()).toBe(svg);
  const snapshot = JSON.parse((await offline.locator('#city-section-report-snapshot').textContent())!);
  expect(snapshot.footprint.width).toBe(40); expect(snapshot.attribution).not.toBe('未反映の出典');
  expect(snapshot.sources[0].name).toBe('plane.gml'); expect(snapshot.sources[0].sha256).toHaveLength(64);
  const event = offline.waitForEvent('download'); await offline.getByRole('link', { name: 'この資料と同じ条件の断面CSVを保存' }).click();
  const csv = await readFile((await (await event).path())!, 'utf8'); expect(csv).toBe(citySectionCSVFromSnapshot(snapshot));
  expect(requests).toEqual([]); await offline.close();
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click(); await expect(button).toBeDisabled();
  await page.getByRole('button', { name: '反映済み範囲の地形断面を表示', exact: true }).click(); await expect(button).toBeEnabled();
  const updated = await download(page, '施工範囲の地形断面HTMLを保存'); expect(updated).toContain('幅 55 m');
  await page.getByRole('button', { name: '施工範囲を非表示', exact: true }).click(); await expect(button).toBeDisabled();
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  await page.getByRole('button', { name: '反映済み範囲の地形断面を表示', exact: true }).click();
  await page.getByRole('button', { name: '合成都市デモを表示', exact: true }).click(); await expect(button).toBeDisabled();
});

test('public Yokohama section reports retain original licensed geometry and provenance without API writes', async ({ page, context }) => {
  const posts: string[] = []; page.on('request', r => { if (r.method() === 'POST') posts.push(r.url()); });
  await page.route('**/api/**', r => r.abort()); await page.goto('/?view=city');
  await expect(page.getByRole('heading', { name: '横浜・みなとみらい（PLATEAU 2024）', exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  await page.getByRole('button', { name: '反映済み範囲の地形断面を表示', exact: true }).click();
  const html = await download(page, '施工範囲の地形断面HTMLを保存');
  const offline = await context.newPage(); await offline.route('**/*', r => r.abort()); await offline.setContent(html);
  const snapshot = JSON.parse((await offline.locator('#city-section-report-snapshot').textContent())!);
  expect(snapshot.data_kind).toBe('public_city_model'); expect(snapshot.crs).toBe('EPSG:6697'); expect(snapshot.lod).toBe(1);
  expect(snapshot.origin_axis_units).toEqual(['degree', 'degree', 'm']);
  expect(snapshot.dataset.license_url).toBe('https://creativecommons.org/licenses/by/4.0/');
  expect(snapshot.sources.map((s: { sha256: string }) => s.sha256)).toEqual(['b46217f9589f7b1340592b78a1316d00c36aa26131df7bcbf4ea49b76d884547', '8528615ce11b65a7d2f095cd9e1b696cae14d24a1f310d17577b62d64d2a520b']);
  await expect(offline.getByRole('img', { name: '東西の地形断面', exact: true })).toBeVisible();
  await expect(offline.getByRole('img', { name: '南北の地形断面', exact: true })).toBeVisible();
  await expect(offline.getByRole('table', { name: '東西の区間判定', exact: true })).toBeVisible();
  expect(snapshot.attribution).toContain('国土交通省'); expect(snapshot.usage_terms).toContain('CC BY 4.0');
  expect(snapshot.terrain_sections.sections[0].points.some((p: { elevations: number[] }) => p.elevations.some(h => h < 0))).toBe(true);
  expect(snapshot.terrain_sections.sections[0].points.every((p: { elevations: number[] }) => p.elevations.every(h => h !== snapshot.footprint.elevation))).toBe(true);
  const href = (await offline.getByRole('link', { name: 'この資料と同じ条件の断面CSVを保存' }).getAttribute('href'))!;
  expect(decodeURIComponent(href.substring(href.indexOf(',') + 1))).toBe(citySectionCSVFromSnapshot(snapshot));
  expect(posts).toEqual([]);
  await offline.setViewportSize({ width: 1180, height: 1050 });
  await offline.getByRole('heading', { name: '東西・南北の地形断面', exact: true }).scrollIntoViewIfNeeded();
  await offline.screenshot({ path: '../../.local/city-section-report-yokohama-20261013.png' }); await offline.close();
});
