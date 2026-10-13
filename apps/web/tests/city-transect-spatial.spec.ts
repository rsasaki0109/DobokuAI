import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { traceTerrainTransect } from '../src/cityTransect';
import { probeTerrainTransect, transectProbePosition, transectOverlayData } from '../src/cityTransectSpatial';
import type { CityModel, CityFeature } from '../src/cityModel';

function patch(id: string, x0 = -100, x1 = 100, h = (e: number, n: number) => 100 + .1 * e + .2 * n): CityFeature {
  const v = (e: number, n: number) => [e, h(e, n) - 100, -n];
  return { id, layer: 'terrain', triangleCount: 2, positions: [v(x0, -100), v(x1, -100), v(x1, 100), v(x0, -100), v(x1, 100), v(x0, 100)].flat() };
}
const model = (features = [patch('plane')]): CityModel => ({ crs: 'urn:doboku:crs:local-metre', origin: [0, 0, 100], bounds: { min: [-100, -100, -100], max: [100, 100, 100] }, features, polygonCount: features.length * 2, lod: 1 });
const line = { start: { east: -3, north: -4 }, end: { east: 3, north: 4 } };

test('arbitrary-line probes and 3D vertices match an independent analytic plane in forward and reverse directions', () => {
  for (const l of [line, { start: line.end, end: line.start }]) {
    const t = traceTerrainTransect(model(), l), before = structuredClone(t), overlay = transectOverlayData(t, 100);
    for (const d of [...t.profile.points.map(p => p.distance), 1.23456789, 2.5]) {
      const p = probeTerrainTransect(t, d)!;
      expect(p).not.toHaveProperty('axis'); expect(p.status).toBe('unique'); expect(p.features).toEqual(['plane']);
      const f = d / 10, e = l.start.east + (l.end.east - l.start.east) * f, n = l.start.north + (l.end.north - l.start.north) * f;
      expect(p.east).toBe(e); expect(p.north).toBe(n); expect(Math.abs(p.elevations[0] - (100 + .1 * e + .2 * n))).toBeLessThan(1e-10);
      expect(transectProbePosition(p, 100)).toEqual([e, p.elevations[0] - 100, -n]);
      p.features.push('changed'); p.elevations.push(999);
    }
    for (const values of [overlay.segments, overlay.points]) for (let i = 0; i < values.length; i += 3) {
      const [e, y, z] = values.slice(i, i + 3); expect(Math.abs(y - (.1 * e - .2 * z))).toBeLessThan(1e-10); expect(Math.abs(e * 4 + z * 3)).toBeLessThan(1e-10);
    }
    expect(overlay.bounds!.min[0]).toBe(-3); expect(overlay.bounds!.max[0]).toBe(3); expect(t).toEqual(before);
    for (const d of [-1, 11, NaN, Infinity]) expect(probeTerrainTransect(t, d)).toBeNull();
    expect(transectProbePosition(probeTerrainTransect(t, 0), NaN)).toBeNull(); expect(() => transectOverlayData(t, NaN)).toThrow('有限値');
  }
});

test('missing and ambiguous arbitrary spans never acquire a 3D height or connecting segment', () => {
  const gap = traceTerrainTransect(model([patch('left', -100, .1), patch('right', .1000001, 100)]), line), overlay = transectOverlayData(gap, 100);
  const missing = gap.profile.intervals.find(v => v.status === 'uncovered')!;
  expect(missing.to - missing.from).toBeLessThan(1e-6); const p = probeTerrainTransect(gap, (missing.from + missing.to) / 2)!;
  expect(p.status).toBe('uncovered'); expect(p.elevations).toEqual([]); expect(transectProbePosition(p, 100)).toBeNull();
  for (let i = 0; i < overlay.segments.length; i += 6) { const a = overlay.segments[i], b = overlay.segments[i + 3]; expect(a < .10000005 && b > .10000005).toBe(false); }
  const ambiguous = traceTerrainTransect(model([patch('low', -100, 100, () => 99), patch('high', -100, 100, () => 101)]), line);
  const q = probeTerrainTransect(ambiguous, 2.5)!; expect(q.status).toBe('ambiguous'); expect(q.elevations).toEqual([99, 101]); expect(transectProbePosition(q, 100)).toBeNull();
  expect(transectOverlayData(ambiguous, 100)).toMatchObject({ segments: [], points: [], bounds: null });
  const crossed = structuredClone(ambiguous); crossed.profile.intervals = [{ from: 0, to: 10, status: 'ambiguous', curves: [{ from: 99, to: 101 }, { from: 101, to: 99 }], features: ['low', 'high'] }]; crossed.profile.points = [crossed.profile.points[0], crossed.profile.points.at(-1)!];
  const crossing = probeTerrainTransect(crossed, 5)!; expect(crossing.elevations).toEqual([100]); expect(crossing.status).toBe('ambiguous'); expect(transectProbePosition(crossing, 100)).toBeNull();
  const none = traceTerrainTransect(model([]), line); expect(transectOverlayData(none, 100).bounds).toBeNull();
});

test('ambiguous event points and rotated vertical projections take precedence over adjacent valid ground', () => {
  const jump = traceTerrainTransect(model([patch('low', -100, 0, () => 100), patch('high', 0, 100, () => 110)]), line);
  const boundary = jump.profile.points.find(p => p.status === 'ambiguous')!;
  expect(probeTerrainTransect(jump, boundary.distance)).toMatchObject({ kind: 'point', status: 'ambiguous', elevations: [100, 110] });
  expect(transectProbePosition(probeTerrainTransect(jump, boundary.distance), 100)).toBeNull();
  const m: CityModel = { ...model(), bounds: { min: [-3000, -100, -3000], max: [3000, 200, 3000] }, features: [{ id: 'wall', layer: 'terrain', triangleCount: 1, positions: [300, 0, -400, 600, 100, -800, 900, 0, -1200] }] };
  const vertical = traceTerrainTransect(m, { start: { east: 0, north: -10 }, end: { east: 1700, north: 2290 } });
  for (const p of vertical.profile.points.filter(p => p.status === 'ambiguous')) expect(transectProbePosition(probeTerrainTransect(vertical, p.distance), 100)).toBeNull();
  expect(transectOverlayData(vertical, 100)).toMatchObject({ segments: [], points: [], bounds: null });
});

const xml = `<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:gml="http://www.opengis.net/gml" xmlns:dem="http://www.opengis.net/citygml/relief/2.0" srsName="urn:doboku:crs:local-metre" srsDimension="3"><core:cityObjectMember><dem:ReliefFeature gml:id="plane"><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>-100 -100 70 100 -100 90 100 100 130 -100 100 110 -100 -100 70</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></dem:ReliefFeature></core:cityObjectMember></core:CityModel>`;
async function download(page: Page, name: string) { const event = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); return readFile((await (await event).path())!, 'utf8'); }
async function setLine(page: Page) { for (const [i, label] of ['始点の東 (m)', '始点の北 (m)', '終点の東 (m)', '終点の北 (m)'].entries()) await page.getByLabel(`指定線 ${label}`, { exact: true }).fill(String([-3, -4, 3, 4][i])); }
async function confirm(page: Page) { await page.getByRole('button', { name: '指定線を点検・プレビュー', exact: true }).click(); await page.getByRole('button', { name: '確認して任意方向の断面を表示', exact: true }).click(); }

test('keyboard and chart arbitrary-line probes update 3D, preserve static exports and clear when geometry is reconfirmed', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); await page.route('**/api/**', r => r.abort()); await page.goto('/?view=city');
  await page.getByLabel('CityGMLファイル', { exact: true }).setInputFiles({ name: 'plane.gml', mimeType: 'application/xml', buffer: Buffer.from(xml) }); await page.getByRole('button', { name: 'CityGMLを点検・プレビュー', exact: true }).click(); await page.getByRole('button', { name: '確認して都市モデルを表示', exact: true }).click();
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click(); await page.getByRole('button', { name: '反映済み範囲の地形断面を表示', exact: true }).click(); await setLine(page);
  await page.getByRole('button', { name: '指定線を点検・プレビュー', exact: true }).click(); await expect(page.getByRole('status', { name: '指定線の3D表示', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '確認して任意方向の断面を表示', exact: true }).click();
  const overlay = page.getByRole('status', { name: '指定線の3D表示', exact: true }), highlight = page.getByRole('status', { name: '指定線照会位置の3D表示', exact: true }), probe = page.getByRole('status', { name: '指定線の位置照会', exact: true });
  await expect(overlay).toBeVisible(); await expect(page.getByRole('status', { name: '地形断面の3D表示', exact: true })).toHaveCount(0);
  const saved = await download(page, '指定線の断面JSONを保存'), csv = await download(page, '指定線の断面CSVを保存');
  const distance = page.getByRole('spinbutton', { name: '指定線の照会距離 (m)', exact: true }); await distance.fill('2.5'); await expect(probe).toContainText('東 -1.5 m・北 -2 m'); await expect(highlight).toContainText('東 -1.5 m・北 -2 m');
  await expect(page.locator('[data-section-probe="unique"]')).toHaveCount(1); expect(await download(page, '指定線の断面JSONを保存')).toBe(saved); expect(await download(page, '指定線の断面CSVを保存')).toBe(csv);
  const html = await download(page, '指定線の断面HTMLを保存'), other = await page.context().newPage(); await other.route('**/*', r => r.abort()); await other.setContent(html); await expect(other.locator('[data-section-probe]')).toHaveCount(0); await expect(other.getByRole('spinbutton')).toHaveCount(0); expect(JSON.parse((await other.locator('#city-transect-snapshot').textContent())!)).toEqual(JSON.parse(saved)); await other.close();
  await page.getByRole('combobox', { name: '指定線の交点を照会', exact: true }).selectOption('0'); await expect(probe).toContainText('東 -3 m・北 -4 m');
  const figure = page.getByRole('img', { name: '指定線の地形断面', exact: true }); await figure.scrollIntoViewIfNeeded();
  const target = await figure.evaluate((svg: SVGSVGElement) => { const p = svg.createSVGPoint(); p.x = 256.25; p.y = 135; const q = p.matrixTransform(svg.getScreenCTM()!); return { x: q.x, y: q.y }; }); await page.mouse.click(target.x, target.y); await expect(probe).toContainText('区間'); await expect(highlight).toBeVisible();
  await distance.fill('11'); await expect(highlight).toHaveCount(0); await expect(page.getByRole('region', { name: '任意方向の断面結果', exact: true }).getByRole('alert')).toContainText('照会距離'); await distance.fill('2.5');
  await page.getByRole('button', { name: '指定線を近くから見る', exact: true }).click(); await expect(page.getByRole('status', { name: '指定線の近接表示', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '指定線を3Dに重ねる', exact: true }).click(); await expect(highlight).toHaveCount(0); await expect(page.getByRole('status', { name: '指定線の近接表示', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '指定線を3Dに重ねる', exact: true }).click(); await expect(highlight).toBeVisible();
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click(); await expect(overlay).toHaveCount(0); await expect(highlight).toHaveCount(0); await expect(page.getByRole('button', { name: '指定線を近くから見る', exact: true })).toBeDisabled();
  await confirm(page); await distance.fill('2.5'); await page.getByLabel('指定線 終点の北 (m)', { exact: true }).fill('5'); await expect(overlay).toHaveCount(0); await expect(highlight).toHaveCount(0); expect(errors).toEqual([]);
});

test('public Yokohama spatial inspection retains source heights and river storage and does not restore obsolete overlays', async ({ page, request }) => {
  const project = await (await request.get('/api/projects/sample-river')).json(), history = await (await request.get('/api/projects/sample-river/runs')).json(); await page.goto('/?view=city');
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click(); await setLine(page); await confirm(page);
  const saved = JSON.parse(await download(page, '指定線の断面JSONを保存')); await page.getByRole('spinbutton', { name: '指定線の照会距離 (m)', exact: true }).fill('2.5');
  const t = saved.terrain_transect, p = probeTerrainTransect(t, 2.5)!; expect(p.status).toBe('unique'); await expect(page.getByRole('status', { name: '指定線照会位置の3D表示', exact: true })).toContainText(`標高 ${p.elevations[0]} m`);
  await page.getByRole('button', { name: '指定線を近くから見る', exact: true }).click(); await page.getByRole('button', { name: '都市全体を表示', exact: true }).click(); await expect(page.getByRole('status', { name: '指定線の近接表示', exact: true })).toHaveCount(0);
  expect(JSON.parse(await download(page, '指定線の断面JSONを保存'))).toEqual(saved); expect(saved.attribution).toContain('PLATEAU'); expect(saved.usage_terms).toContain('CC BY');
  await page.getByRole('button', { name: '施工範囲を非表示', exact: true }).click(); await expect(page.getByRole('status', { name: '指定線の3D表示', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click(); await expect(page.getByRole('status', { name: '指定線の3D表示', exact: true })).toHaveCount(0); await confirm(page); await page.getByRole('button', { name: '合成都市デモを表示', exact: true }).click(); await expect(page.getByRole('status', { name: '指定線の3D表示', exact: true })).toHaveCount(0);
  expect(await (await request.get('/api/projects/sample-river')).json()).toEqual(project); expect(await (await request.get('/api/projects/sample-river/runs')).json()).toEqual(history);
});
