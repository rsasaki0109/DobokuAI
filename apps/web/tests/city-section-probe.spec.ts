import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { terrainSections } from '../src/citySections';
import { probeCitySection, cityProbePosition } from '../src/citySectionProbe';
import type { CityFeature, CityModel } from '../src/cityModel';

const footprint = { east: 0, north: 0, width: 40, length: 30, elevation: 150 };
function patch(id: string, x0 = -100, x1 = 100, h = (e: number, n: number) => 100 + .1 * e + .2 * n): CityFeature {
  const p = (e: number, n: number) => [e, h(e, n) - 100, -n];
  return { id, layer: 'terrain', triangleCount: 2, positions: [p(x0, -100), p(x1, -100), p(x1, 100), p(x0, -100), p(x1, 100), p(x0, 100)].flat() };
}
const model = (features = [patch('plane')]): CityModel => ({ crs: 'urn:doboku:crs:local-metre', origin: [0, 0, 100], features, bounds: { min: [-100, -100, -100], max: [100, 100, 100] }, polygonCount: features.length * 2, lod: 1 });

test('section probes agree with analytic plane at endpoints, shared events and interior in both axes without mutation', () => {
  const sections = terrainSections(model(), footprint), before = structuredClone(sections);
  for (const s of sections) for (const d of [...s.points.map(p => p.distance), 1.23456789, s.length / 2]) {
    const p = probeCitySection(s, d)!;
    expect(p.status).toBe('unique'); expect(p.features).toEqual(['plane']);
    expect(p.elevations[0]).toBeCloseTo(100 + .1 * p.east + .2 * p.north, 10);
    expect(p.kind).toBe(s.points.some(v => v.distance === d) ? 'point' : 'interval');
    expect(cityProbePosition(p, 100)).toEqual([p.east, p.elevations[0] - 100, -p.north]);
    expect(p.elevations[0]).not.toBe(footprint.elevation);
    p.elevations.push(999); p.features.push('changed');
  }
  expect(sections).toEqual(before);
  for (const d of [-.001, 40.001, NaN, Infinity]) expect(probeCitySection(sections[0], d)).toBeNull();
  expect(cityProbePosition(probeCitySection(sections[0], 0), NaN)).toBeNull();
});

test('probes keep even submicrometre gaps uncovered and prefer exact ambiguous discontinuity points', () => {
  const gap = terrainSections(model([patch('left', -100, .1, () => 100), patch('right', .1000001, 100, () => 100)]), footprint)[0];
  const missing = gap.intervals.find(v => v.status === 'uncovered')!;
  expect(missing.to - missing.from).toBeLessThan(1e-6);
  const p = probeCitySection(gap, (missing.from + missing.to) / 2)!;
  expect(p.status).toBe('uncovered'); expect(p.elevations).toEqual([]); expect(cityProbePosition(p, 100)).toBeNull();
  expect(probeCitySection(gap, missing.from)!.status).toBe('unique');
  const jump = terrainSections(model([patch('low', -100, 0, () => 100), patch('high', 0, 100, () => 110)]), footprint)[0];
  const boundary = probeCitySection(jump, 20)!;
  expect(boundary.kind).toBe('point'); expect(boundary.status).toBe('ambiguous'); expect(boundary.elevations).toEqual([100, 110]);
  expect(cityProbePosition(boundary, 100)).toBeNull();
  expect(probeCitySection(jump, 19.99)!.elevations).toEqual([100]); expect(probeCitySection(jump, 20.01)!.elevations).toEqual([110]);
});

test('ambiguous curve crossings and vertical projections do not acquire a 3D height', () => {
  const crossing = terrainSections(model([patch('up', -100, 100, e => 100 + e), patch('down', -100, 100, e => 100 - e)]), footprint)[0];
  // Use a crossing inside an interval, rather than a stored event.
  const s = { ...crossing, points: [crossing.points[0], crossing.points.at(-1)!], intervals: [{ from: 0, to: 40, status: 'ambiguous' as const, curves: [{ from: 80, to: 120 }, { from: 120, to: 80 }], features: ['up', 'down'] }] };
  const p = probeCitySection(s, 20)!; expect(p.elevations).toEqual([100]); expect(p.status).toBe('ambiguous'); expect(cityProbePosition(p, 100)).toBeNull();
  const vertical: CityFeature = { id: 'vertical', layer: 'terrain', triangleCount: 1, positions: [0, 0, -10, 0, 10, -10, 0, 0, 10] };
  const v = probeCitySection(terrainSections(model([patch('ground'), vertical]), footprint)[0], 20)!;
  expect(v.status).toBe('ambiguous'); expect(v.features).toContain('vertical'); expect(cityProbePosition(v, 100)).toBeNull();
  const empty = probeCitySection(terrainSections(model([]), footprint)[0], 10)!;
  expect(empty.status).toBe('uncovered'); expect(empty.features).toEqual([]); expect(cityProbePosition(empty, 100)).toBeNull();
});

const xml = `<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:gml="http://www.opengis.net/gml" xmlns:dem="http://www.opengis.net/citygml/relief/2.0" srsName="urn:doboku:crs:local-metre" srsDimension="3"><core:cityObjectMember><dem:ReliefFeature gml:id="plane"><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>-100 -100 70 100 -100 90 100 100 130 -100 100 110 -100 -100 70</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></dem:ReliefFeature></core:cityObjectMember></core:CityModel>`;

test('keyboard and chart position inspection follows confirmed sections, clears stale selections and exports static reports', async ({ page }) => {
  const errors: string[] = [], posts: string[] = []; page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (r.method() === 'POST') posts.push(r.url()); });
  await page.route('**/api/**', r => r.abort()); await page.goto('/?view=city');
  await page.getByLabel('CityGMLファイル', { exact: true }).setInputFiles({ name: 'plane.gml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.getByRole('button', { name: 'CityGMLを点検・プレビュー', exact: true }).click(); await page.getByRole('button', { name: '確認して都市モデルを表示', exact: true }).click();
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click(); await page.getByRole('button', { name: '反映済み範囲の地形断面を表示', exact: true }).click();
  const input = page.getByRole('spinbutton', { name: '東西の照会距離 (m)', exact: true }), status = page.getByRole('status', { name: '東西の位置照会', exact: true });
  const highlight = page.getByRole('status', { name: '断面照会位置の3D表示', exact: true });
  await input.focus(); await input.pressSequentially('25'); await input.press('Tab');
  await expect(status).toContainText('東 5 m・北 0 m'); await expect(status).toContainText('[100.5]'); await expect(highlight).toContainText('標高 100.5 m');
  const chart = page.getByRole('img', { name: '東西の地形断面', exact: true });
  await expect(chart.locator('[data-section-probe]')).toHaveAttribute('data-section-probe', 'unique');
  await page.getByRole('button', { name: '地形断面を近くから見る', exact: true }).click();
  await page.getByLabel('都市と地形の3Dビュー').screenshot({ path: '../../.local/city-section-probe-plane-20261013.png' });
  await page.getByLabel('施工範囲の幅 (m)', { exact: true }).fill('55'); await expect(status).toContainText('東 5 m');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '施工範囲の地形断面HTMLを保存', exact: true }).click();
  const html = await readFile((await (await download).path())!, 'utf8');
  expect(html).not.toContain('data-section-probe'); expect(html).not.toContain('の照会距離'); expect(html).not.toContain('<script');
  const report = await page.context().newPage(); await report.route('**/*', r => r.abort()); await report.setContent(html);
  const snapshot = JSON.parse((await report.locator('#city-section-report-snapshot').textContent())!);
  expect(snapshot.footprint.width).toBe(40); await report.close();
  await input.fill('41'); await expect(page.getByRole('alert')).toContainText('0〜40 m'); await expect(highlight).toHaveCount(0);
  await page.getByLabel('東西の交点を照会', { exact: true }).selectOption('0'); await expect(status).toContainText('交点の判定'); await expect(status).toContainText('[98]');
  // A click on a stored circle preserves the exact event distance; a plot click uses SVG coordinates.
  await chart.locator('circle').filter({ has: page.locator('title') }).first().click(); await expect(input).toHaveValue('0');
  await chart.evaluate(svg => { const matrix = (svg as SVGSVGElement).getScreenCTM()!; const p = new DOMPoint(333, 130).matrixTransform(matrix); svg.dispatchEvent(new MouseEvent('click', { clientX: p.x, clientY: p.y, bubbles: true })); });
  await expect(status).toContainText('区間内の判定');
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click(); await expect(status).toHaveCount(0); await expect(highlight).toHaveCount(0);
  await page.getByRole('button', { name: '反映済み範囲の地形断面を表示', exact: true }).click(); await expect(input).toHaveValue('');
  await input.fill('20'); await page.getByRole('button', { name: '反映済み範囲の地形断面を表示', exact: true }).click(); await expect(input).toHaveValue('');
  await input.fill('20'); await page.getByRole('button', { name: '施工範囲を非表示', exact: true }).click(); await expect(highlight).toHaveCount(0);
  expect(errors).toEqual([]); expect(posts).toEqual([]);
});

test('Yokohama inspection retains negative source heights and source IDs and can switch between axes', async ({ page }) => {
  const errors: string[] = [], posts: string[] = []; page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (r.method() === 'POST') posts.push(r.url()); });
  await page.route('**/api/**', r => r.abort()); await page.goto('/?view=city');
  await page.getByLabel('施工範囲の幅 (m)', { exact: true }).fill('200'); await page.getByLabel('施工範囲の長さ (m)', { exact: true }).fill('200');
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click(); await page.getByRole('button', { name: '反映済み範囲の地形断面を表示', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '施工範囲の地形断面HTMLを保存', exact: true }).click();
  const html = await readFile((await (await download).path())!, 'utf8');
  const report = await page.context().newPage(); await report.route('**/*', r => r.abort()); await report.setContent(html);
  const snapshot = JSON.parse((await report.locator('#city-section-report-snapshot').textContent())!); await report.close();
  const sections = snapshot.terrain_sections.sections as ReturnType<typeof terrainSections>;
  const section = sections.find(s => s.points.some(p => p.status === 'unique' && p.elevations[0] < 0))!;
  expect(section).toBeTruthy(); const point = section.points.find(p => p.status === 'unique' && p.elevations[0] < 0)!;
  const axis = section.axis === 'east_west' ? '東西' : '南北', other = axis === '東西' ? '南北' : '東西';
  await page.getByLabel(`${axis}の交点を照会`, { exact: true }).selectOption(String(point.distance));
  const status = page.getByRole('status', { name: `${axis}の位置照会`, exact: true });
  await expect(status).toContainText(JSON.stringify(point.elevations)); await expect(status).toContainText(JSON.stringify(point.features));
  await expect(page.getByRole('status', { name: '断面照会位置の3D表示', exact: true })).toContainText(`標高 ${point.elevations[0]} m`);
  await page.getByLabel(`${other}の照会距離 (m)`, { exact: true }).fill('100'); await expect(status).toHaveCount(0);
  await page.getByRole('button', { name: '断面の位置照会を解除', exact: true }).click(); await expect(page.getByRole('status', { name: '断面照会位置の3D表示', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '合成都市デモを表示', exact: true }).click(); await expect(page.getByLabel(`${other}の照会距離 (m)`, { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]); expect(posts).toEqual([]);
});

test('overlapping and absent terrain show a coordinate diagnosis without drawing an invented height', async ({ page }) => {
  await page.route('**/api/**', r => r.abort()); await page.goto('/?view=city');
  const member = xml.match(/<core:cityObjectMember>[\s\S]*<\/core:cityObjectMember>/)![0];
  const raised = member.replace('gml:id="plane"', 'gml:id="raised"').replace('70 100 -100 90 100 100 130 -100 100 110 -100 -100 70', '80 100 -100 100 100 100 140 -100 100 120 -100 -100 80');
  const overlap = xml.replace('</core:CityModel>', `${raised}</core:CityModel>`);
  for (const [data, expected] of [[overlap, '高さが一意でない・鉛直面'], [xml.replaceAll('dem:ReliefFeature', 'gml:Building'), '地形なし']] as const) {
    await page.getByLabel('CityGMLファイル', { exact: true }).setInputFiles({ name: 'model.gml', mimeType: 'application/xml', buffer: Buffer.from(data) });
    await page.getByRole('button', { name: 'CityGMLを点検・プレビュー', exact: true }).click(); await page.getByRole('button', { name: '確認して都市モデルを表示', exact: true }).click();
    await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click(); await page.getByRole('button', { name: '反映済み範囲の地形断面を表示', exact: true }).click();
    await page.getByLabel('東西の照会距離 (m)', { exact: true }).fill('25');
    const status = page.getByRole('status', { name: '東西の位置照会', exact: true });
    await expect(status).toContainText(expected); await expect(status).toContainText('東 5 m・北 0 m');
    await expect(status).toContainText('3Dに位置の点を置きません');
    await expect(page.getByRole('status', { name: '断面照会位置の3D表示', exact: true })).toHaveCount(0);
    if (expected === '地形なし') { await expect(status).toContainText('標高候補（原データ基準 m）：なし'); await expect(page.getByRole('img', { name: '東西の地形断面', exact: true })).toHaveCount(0); }
    else {
      await expect(status).toContainText('[100.5,110.5]');
      const chart = page.getByRole('img', { name: '東西の地形断面', exact: true });
      await expect(chart.locator('[data-section-probe]')).toHaveAttribute('data-section-probe', 'ambiguous');
      // Ambiguous event lines select the stored event, rather than a nearby pixel distance.
      await chart.scrollIntoViewIfNeeded();
      const stroke = await chart.evaluate(svg => {
        const p = new DOMPoint(65, 26).matrixTransform((svg as SVGSVGElement).getScreenCTM()!);
        return { x: p.x, y: p.y };
      });
      await page.mouse.click(stroke.x, stroke.y);
      await expect(page.getByLabel('東西の照会距離 (m)', { exact: true })).toHaveValue('0');
      await expect(status).toContainText('交点の判定'); await expect(status).toContainText('[98,108]');
      await expect(page.getByRole('status', { name: '断面照会位置の3D表示', exact: true })).toHaveCount(0);
    }
  }
});
