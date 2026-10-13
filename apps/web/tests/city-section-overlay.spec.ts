import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { terrainSections } from '../src/citySections';
import { citySectionOverlayData, citySectionColors } from '../src/citySectionOverlay';
import type { CityModel, CityFeature } from '../src/cityModel';

const footprint = { east: 0, north: 0, width: 40, length: 30, elevation: 100 };
function patch(id: string, x0 = -100, x1 = 100, h = (east: number, north: number) => 100 + .1 * east + .2 * north): CityFeature {
  const point = (east: number, north: number) => [east, h(east, north) - 100, -north];
  return { id, layer: 'terrain', triangleCount: 2, positions: [point(x0, -100), point(x1, -100), point(x1, 100), point(x0, -100), point(x1, 100), point(x0, 100)].flat() };
}
const model = (features = [patch('plane')]): CityModel => ({ crs: 'urn:doboku:crs:local-metre', origin: [0, 0, 100], features, bounds: { min: [-100, -100, -100], max: [100, 100, 100] }, polygonCount: features.length * 2, lod: 1 });

test('3D section positions use exact east/source-height/north conversion and analytic heights without marker offsets', () => {
  const m = model(), sections = terrainSections(m, { ...footprint, elevation: 150 });
  const before = structuredClone(sections), data = citySectionOverlayData(sections, m.origin[2]);
  expect(data.bounds).toEqual({ min: [-20, -3, -15], max: [20, 3, 15] });
  for (const axis of data.axes) {
    for (const values of [axis.segments, axis.points]) for (let i = 0; i < values.length; i += 3) {
      const [east, offsetHeight, z] = values.slice(i, i + 3), north = -z;
      expect(offsetHeight + m.origin[2]).toBeCloseTo(100 + .1 * east + .2 * north, 9);
      expect(axis.axis === 'east_west' ? north : east).toBeCloseTo(0, 12);
      expect(offsetHeight + m.origin[2]).not.toBe(150);
    }
  }
  expect(sections).toEqual(before);
  expect(() => citySectionOverlayData(sections, NaN)).toThrow('有限値');
});

test('3D segments never bridge a narrow gap, height discontinuity or ambiguous span and omit ambiguous points', () => {
  const gapModel = model([patch('left', -100, .1, () => 100), patch('right', .3, 100, () => 100)]);
  const gap = citySectionOverlayData(terrainSections(gapModel, footprint), 100).axes[0];
  for (let i = 0; i < gap.segments.length; i += 6) expect(gap.segments[i] < .2 && gap.segments[i + 3] > .2).toBe(false);
  expect(gap.segments.some(v => Math.abs(v - .1) < 1e-12)).toBe(true);
  expect(gap.segments.some(v => Math.abs(v - .3) < 1e-12)).toBe(true);
  const jumpModel = model([patch('low', -100, 0, () => 100), patch('high', 0, 100, () => 110)]);
  const jump = citySectionOverlayData(terrainSections(jumpModel, footprint), 100).axes[0];
  for (let i = 0; i < jump.segments.length; i += 6) expect(jump.segments[i + 1]).toBe(jump.segments[i + 4]);
  expect(jump.ambiguousPoints).toBe(1);
  for (let i = 0; i < jump.points.length; i += 3) expect(jump.points[i]).not.toBe(0);
  const overlapModel = model([patch('floor', -100, 100, () => 100), patch('raised', -100, 100, () => 110)]);
  const overlap = citySectionOverlayData(terrainSections(overlapModel, footprint), 100);
  expect(overlap.axes.every(a => a.segments.length === 0 && a.points.length === 0)).toBe(true); expect(overlap.bounds).toBeNull();
  expect(citySectionOverlayData(terrainSections(model([]), footprint), 100).bounds).toBeNull();
});

const xml = `<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:gml="http://www.opengis.net/gml" xmlns:dem="http://www.opengis.net/citygml/relief/2.0" srsName="urn:doboku:crs:local-metre" srsDimension="3"><core:cityObjectMember><dem:ReliefFeature gml:id="plane"><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>-100 -100 70 100 -100 90 100 100 130 -100 100 110 -100 -100 70</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></dem:ReliefFeature></core:cityObjectMember></core:CityModel>`;
async function saved(page: Page) {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: '都市の表示条件JSONを保存', exact: true }).click();
  return JSON.parse(await readFile((await (await event).path())!, 'utf8'));
}

test('3D overlays use confirmed profiles, permit terrain picking, preserve exports and clear stale focus and geometry', async ({ page }) => {
  const errors: string[] = [], posts: string[] = []; page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (r.method() === 'POST') posts.push(r.url()); });
  await page.route('**/api/**', r => r.abort()); await page.goto('/?view=city');
  await page.getByLabel('CityGMLファイル', { exact: true }).setInputFiles({ name: 'plane.gml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.getByRole('button', { name: 'CityGMLを点検・プレビュー', exact: true }).click();
  await page.getByRole('button', { name: '確認して都市モデルを表示', exact: true }).click();
  const toggle = page.getByRole('button', { name: '地形断面を3Dに重ねる', exact: true }), focus = page.getByRole('button', { name: '地形断面を近くから見る', exact: true });
  const caption = page.getByRole('status', { name: '地形断面の3D表示', exact: true }), close = page.getByRole('status', { name: '地形断面の近接表示', exact: true });
  await expect(toggle).toBeDisabled(); await expect(focus).toBeDisabled();
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  await page.getByRole('button', { name: '反映済み範囲の地形断面を表示', exact: true }).click();
  await expect(caption).toContainText('東西（緑） 40 m'); await expect(caption).toContainText('南北（青） 30 m');
  const before = await saved(page); await focus.click(); await expect(close).toBeVisible();
  await toggle.click(); await expect(caption).toHaveCount(0); await expect(close).toBeVisible();
  await toggle.click(); await expect(caption).toBeVisible();
  const after = await saved(page); expect({ ...after, exported_at: before.exported_at }).toEqual(before);
  await page.getByRole('button', { name: '都市を真上から', exact: true }).click();
  await page.getByLabel('都市と地形の3Dビュー').screenshot({ path: '../../.local/city-section-overlay-plane-20261013.png' });
  await page.getByLabel('施工範囲の幅 (m)', { exact: true }).fill('55'); await expect(caption).toContainText('東西（緑） 40 m');
  await page.getByRole('button', { name: '地形をクリックして施工位置を選ぶ', exact: true }).click();
  const canvas = page.getByLabel('都市と地形の3Dビュー').locator('canvas'); await canvas.scrollIntoViewIfNeeded(); const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.getByRole('status', { name: '施工位置の選択結果', exact: true })).toContainText('地形から入力候補');
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  await expect(toggle).toBeDisabled(); await expect(caption).toHaveCount(0); await expect(close).toHaveCount(0);
  await page.getByRole('button', { name: '反映済み範囲の地形断面を表示', exact: true }).click(); await expect(caption).toContainText('東西（緑） 55 m');
  await focus.click(); await page.getByRole('button', { name: '都市全体を表示', exact: true }).click(); await expect(close).toHaveCount(0);
  await page.getByRole('button', { name: '施工範囲を非表示', exact: true }).click(); await expect(toggle).toBeDisabled();
  await page.getByRole('button', { name: '合成都市デモを表示', exact: true }).click(); await expect(focus).toBeDisabled();
  expect(errors).toEqual([]); expect(posts).toEqual([]);
});

test('public Yokohama profiles use matching 2D colors and original terrain while focus leaves project conditions unchanged', async ({ page }) => {
  const errors: string[] = [], posts: string[] = []; page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (r.method() === 'POST') posts.push(r.url()); });
  await page.route('**/api/**', r => r.abort()); await page.goto('/?view=city');
  await expect(page.getByRole('heading', { name: '横浜・みなとみらい（PLATEAU 2024）', exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: '中心の地形高さを標高候補にする', exact: true }).click();
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  await page.getByRole('button', { name: '反映済み範囲の地形断面を表示', exact: true }).click();
  const before = await saved(page);
  for (const [axis, name] of [['east_west', '東西'], ['south_north', '南北']] as const) {
    await expect(page.getByRole('img', { name: `${name}の地形断面`, exact: true }).locator('[data-terrain-line]').first()).toHaveAttribute('stroke', citySectionColors[axis]);
  }
  await page.getByRole('button', { name: '地形断面を近くから見る', exact: true }).click();
  await expect(page.getByRole('status', { name: '地形断面の近接表示', exact: true })).toBeVisible();
  await page.getByLabel('都市と地形の3Dビュー').screenshot({ path: '../../.local/city-section-overlay-yokohama-20261013.png' });
  const focused = await saved(page); expect({ ...focused, exported_at: before.exported_at }).toEqual(before);
  await page.getByLabel('地形 (1)', { exact: true }).uncheck();
  await expect(page.getByRole('status', { name: '地形断面の3D表示', exact: true })).toContainText('東西（緑） 40 m');
  await page.getByLabel('地形 (1)', { exact: true }).check();
  const after = await saved(page);
  expect([...after.visible_layers].sort()).toEqual([...before.visible_layers].sort());
  expect({ ...after, exported_at: before.exported_at, visible_layers: before.visible_layers }).toEqual(before);
  expect(after.attribution).toContain('国土交通省'); expect(after.dataset.license).toBe('CC BY 4.0');
  expect(errors).toEqual([]); expect(posts).toEqual([]);
});
