import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const member = (id: string, heights: string, building = false) => `<core:cityObjectMember><${building ? 'bldg:Building' : 'dem:ReliefFeature'} gml:id="${id}"><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>${heights}</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></${building ? 'bldg:Building' : 'dem:ReliefFeature'}></core:cityObjectMember>`;
const ground = member('plane', '-100 -100 70 100 -100 90 100 100 130 -100 100 110 -100 -100 70');
const fixture = (extra = '') => `<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:gml="http://www.opengis.net/gml" xmlns:dem="http://www.opengis.net/citygml/relief/2.0" xmlns:bldg="http://www.opengis.net/citygml/building/2.0" srsName="urn:doboku:crs:local-metre" srsDimension="3">${ground}${extra}</core:CityModel>`;
const pickButton = (page: Page) => page.getByRole('button', { name: '地形をクリックして施工位置を選ぶ', exact: true });
const canvas = (page: Page) => page.getByLabel('都市と地形の3Dビュー').locator('canvas');
async function load(page: Page, xml = fixture()) {
  await page.route('**/api/**', r => r.abort());
  await page.goto('/?view=city');
  await page.getByRole('button', { name: '合成都市デモを表示', exact: true }).click();
  await page.getByLabel('CityGMLファイル', { exact: true }).setInputFiles({ name: 'pointer-fixture.gml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.getByRole('button', { name: 'CityGMLを点検・プレビュー', exact: true }).click();
  await page.getByRole('button', { name: '確認して都市モデルを表示', exact: true }).click();
  await page.getByRole('button', { name: '都市を真上から', exact: true }).click();
}
async function saved(page: Page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '都市の表示条件JSONを保存', exact: true }).click();
  return JSON.parse(await readFile((await (await download).path())!, 'utf8'));
}
async function centerClick(page: Page, x = .5, y = .5) {
  const c = canvas(page); await c.scrollIntoViewIfNeeded();
  const box = (await c.boundingBox())!;
  await c.click({ position: { x: box.width * x, y: box.height * y } });
}

test('real terrain pointer clicks stage exact source-plane heights; orbit drags preserve drafts and confirmation controls exports', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const posts: string[] = []; page.on('request', r => { if (r.method() === 'POST') posts.push(r.url()); });
  await load(page);
  await centerClick(page);
  await expect(page.getByRole('status').filter({ hasText: '選択地物：' })).toContainText('plane');
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  const before = await saved(page);
  await page.getByLabel('施工範囲の幅 (m)', { exact: true }).fill('55');
  await page.getByRole('button', { name: '都市を自動回転', exact: true }).click();
  await pickButton(page).click();
  await expect(page.getByRole('button', { name: '都市を自動回転', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: '都市を自動回転', exact: true })).toBeDisabled();
  await canvas(page).scrollIntoViewIfNeeded(); const box = (await canvas(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 + 20, { steps: 8 }); await page.mouse.up();
  await expect(page.getByLabel('施工範囲の東方向 (m)', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('施工範囲の北方向 (m)', { exact: true })).toHaveValue('0');
  await expect(page.getByRole('status', { name: '施工位置の選択結果' })).toHaveCount(0);
  await page.getByRole('button', { name: '都市を斜めから', exact: true }).click();
  await page.getByRole('button', { name: '都市を真上から', exact: true }).click();
  await centerClick(page, .54, .46);
  await expect(page.getByRole('status', { name: '施工位置の選択結果' })).toContainText('地形から入力候補を選択');
  const east = Number(await page.getByLabel('施工範囲の東方向 (m)', { exact: true }).inputValue());
  const north = Number(await page.getByLabel('施工範囲の北方向 (m)', { exact: true }).inputValue());
  const elevation = Number(await page.getByLabel('施工範囲の標高 (m / 原データ基準)', { exact: true }).inputValue());
  expect(east).toBeGreaterThan(1); expect(north).toBeGreaterThan(1);
  // Independent original plane reference: not raycast Float32 mesh height.
  expect(elevation).toBeCloseTo(100 + .1 * east + .2 * north, 9);
  await expect(page.getByLabel('施工範囲の幅 (m)', { exact: true })).toHaveValue('55');
  const unconfirmed = await saved(page); expect(unconfirmed.footprint).toEqual(before.footprint); expect(unconfirmed.terrain_inspection).toEqual(before.terrain_inspection);
  await page.getByRole('button', { name: '施工範囲の編集を取消', exact: true }).click();
  await expect(page.getByLabel('施工範囲の幅 (m)', { exact: true })).toHaveValue('40');
  await centerClick(page, .54, .46);
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  await expect(pickButton(page)).toHaveAttribute('aria-pressed', 'false');
  const after = await saved(page); expect(after.footprint.east).toBeCloseTo(east, 9); expect(after.footprint.elevation).toBeCloseTo(elevation, 9);
  expect(after.numerical_solver_linked).toBe(false);
  expect(posts).toEqual([]); expect(errors).toEqual([]);
});

test('picking buildings, overlapping ground, hidden terrain and sky leaves the current input candidate unchanged', async ({ page }) => {
  const roof = member('roof', '-100 -100 200 100 -100 200 100 100 200 -100 100 200 -100 -100 200', true);
  const raised = member('raised', '-100 -100 80 100 -100 100 100 100 140 -100 100 120 -100 -100 80');
  await load(page, fixture(roof + raised));
  await page.getByLabel('施工範囲の東方向 (m)', { exact: true }).fill('17');
  await pickButton(page).click();
  await centerClick(page);
  await expect(page.getByRole('status', { name: '施工位置の選択結果' })).toContainText('建物・道路などは施工位置に採用しません');
  await expect(page.getByLabel('施工範囲の東方向 (m)', { exact: true })).toHaveValue('17');
  await page.getByLabel('建物 (1)', { exact: true }).uncheck();
  await centerClick(page);
  await expect(page.getByRole('status', { name: '施工位置の選択結果' })).toContainText('地形高さが一意に決まりません');
  await expect(page.getByLabel('施工範囲の東方向 (m)', { exact: true })).toHaveValue('17');
  await page.getByLabel('地形 (2)', { exact: true }).uncheck();
  await centerClick(page);
  await expect(page.getByLabel('施工範囲の東方向 (m)', { exact: true })).toHaveValue('17');
  await canvas(page).click({ position: { x: 4, y: 4 } });
  await expect(page.getByLabel('施工範囲の東方向 (m)', { exact: true })).toHaveValue('17');
  await page.getByRole('button', { name: '合成都市デモを表示', exact: true }).click();
  await expect(pickButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('status', { name: '施工位置の選択結果' })).toHaveCount(0);
  expect((await saved(page)).footprint).toBeNull();
});

test('terrain picks near model edges are never clamped, and confirmed source replacement clears the pending pick', async ({ page }) => {
  await load(page);
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  const before = await saved(page);
  await pickButton(page).click();
  await centerClick(page, .69, .5);
  await expect(page.getByRole('status', { name: '施工位置の選択結果' })).toContainText('地形から入力候補を選択');
  const east = Number(await page.getByLabel('施工範囲の東方向 (m)', { exact: true }).inputValue());
  expect(east).toBeGreaterThan(80); expect(east).toBeLessThan(100);
  await expect(page.getByLabel('施工範囲の幅 (m)', { exact: true })).toHaveValue('40');
  await expect(page.getByRole('button', { name: '確認して施工範囲を表示', exact: true })).toBeDisabled();
  expect((await saved(page)).footprint).toEqual(before.footprint);
  await page.getByRole('button', { name: '横浜の公開モデルを確認', exact: true }).click();
  // Rearm while import review is open: replacement itself must disarm picking.
  await pickButton(page).click();
  await expect(pickButton(page)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '確認して都市モデルを表示', exact: true }).click();
  await expect(pickButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('status', { name: '施工位置の選択結果' })).toHaveCount(0);
  expect((await saved(page)).footprint).toBeNull();
});

test('bundled public Yokohama terrain supplies a confirmed planning candidate without API writes', async ({ page }) => {
  const posts: string[] = []; page.on('request', r => { if (r.method() === 'POST') posts.push(r.url()); });
  await page.route('**/api/**', r => r.abort());
  await page.goto('/?view=city');
  await expect(page.getByRole('heading', { name: '横浜・みなとみらい（PLATEAU 2024）', exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByLabel(/^建物 \(/).uncheck();
  await page.getByRole('button', { name: '都市を真上から', exact: true }).click();
  await pickButton(page).click(); await centerClick(page);
  await expect(page.getByRole('status', { name: '施工位置の選択結果' })).toContainText('地形から入力候補を選択');
  const height = Number(await page.getByLabel('施工範囲の標高 (m / 原データ基準)', { exact: true }).inputValue());
  expect(Number.isFinite(height)).toBe(true);
  expect((await saved(page)).footprint).toBeNull();
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  const data = await saved(page);
  expect(data.data_kind).toBe('public_city_model'); expect(data.dataset.license).toBe('CC BY 4.0');
  expect(data.footprint.elevation).toBe(height);
  expect(data.terrain_inspection.samples[0]).toMatchObject({ status: 'unique', elevations: [height] });
  expect(data.terrain_inspection.samples[0].features.length).toBeGreaterThan(0);
  expect(data.terrain_inspection.samples[0].features.every((id: string) => id.startsWith('terrain.gml / '))).toBe(true);
  expect(data.numerical_solver_linked).toBe(false); expect(posts).toEqual([]);
  await page.getByLabel(/^建物 \(/).check();
  await page.getByRole('button', { name: '都市を斜めから', exact: true }).click();
  await page.screenshot({ path: '../../.local/picking-yokohama-20261013.png', fullPage: true });
});
