import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { sampleGround, footprintGround } from '../src/cityTerrain';
import type { CityModel, CityFeature } from '../src/cityModel';

// Independent plane: original height = 100 + 0.1 east + 0.2 north.
const ground: CityFeature = { id: 'plane', layer: 'terrain', triangleCount: 2, positions: [
  -100, -30, 100, 100, -10, 100, 100, 30, -100,
  -100, -30, 100, 100, 30, -100, -100, 10, -100,
] };
const model = (features: CityFeature[] = [ground]): CityModel => ({ crs: 'urn:doboku:crs:local-metre', origin: [0, 0, 100], features, bounds: { min: [-100, -30, -100], max: [100, 100, 100] }, polygonCount: 2, lod: 1 });

test('terrain sampling matches an analytic plane at interiors, diagonal seams, vertices and reversed winding', () => {
  for (const [east, north] of [[7, 11], [0, 0], [-100, -100], [100, 100], [-99, 90]]) {
    for (const positions of [ground.positions, [ground.positions.slice(6, 9), ground.positions.slice(3, 6), ground.positions.slice(0, 3), ground.positions.slice(15, 18), ground.positions.slice(12, 15), ground.positions.slice(9, 12)].flat()]) {
      const sampled = sampleGround(model([{ ...ground, positions }]), east, north);
      expect(sampled.status).toBe('unique'); expect(sampled.elevations).toHaveLength(1);
      expect(sampled.elevations[0]).toBeCloseTo(100 + .1 * east + .2 * north, 9);
    }
  }
  const samples = footprintGround(model(), { east: 0, north: 0, width: 40, length: 30 });
  expect(samples.map(s => s.elevations[0])).toEqual([100, 95, 99, 105, 101]);
});

test('terrain inspection rejects extrapolation, layered heights, vertical faces and invalid inputs; excludes roofs', () => {
  expect(sampleGround(model(), 101, 0).status).toBe('uncovered');
  expect(sampleGround(model([]), 0, 0).status).toBe('uncovered');
  expect(sampleGround(model(), NaN, 0).status).toBe('invalid');
  expect(footprintGround(model(), { east: 0, north: 0, width: -1, length: 30 })).toEqual([]);
  const raised = { ...ground, id: 'raised', positions: ground.positions.map((v, i) => i % 3 === 1 ? v + 10 : v) };
  expect(sampleGround(model([ground, raised]), 0, 0)).toMatchObject({ status: 'ambiguous', elevations: [100, 110], features: ['plane', 'raised'] });
  expect(sampleGround(model([ground, { ...raised, layer: 'building' }]), 0, 0).elevations).toEqual([100]);
  const wall: CityFeature = { id: 'vertical', layer: 'terrain', triangleCount: 1, positions: [0, 0, -10, 0, 10, -10, 0, 0, 10] };
  expect(sampleGround(model([ground, wall]), 0, 0).status).toBe('ambiguous');
  expect(sampleGround(model([wall]), 1, 0).status).toBe('uncovered');
  // Five covered points can surround a hole: the output must not assert full coverage.
  const patches = [[0, 0], [-20, -15], [20, -15], [20, 15], [-20, 15]].map(([east, north], i) => ({
    ...ground, id: `patch-${i}`, positions: [east - 1, 0, -north + 1, east + 1, 0, -north + 1, east, 0, -north - 1], triangleCount: 1,
  }));
  const sparse = footprintGround(model(patches), { east: 0, north: 0, width: 40, length: 30 });
  expect(sparse.every(s => s.status === 'unique')).toBe(true);
  expect(sampleGround(model(patches), 5, 5).status).toBe('uncovered');
});

const fixture = (extra = '') => `<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:gml="http://www.opengis.net/gml" xmlns:dem="http://www.opengis.net/citygml/relief/2.0" srsName="urn:doboku:crs:local-metre" srsDimension="3"><core:cityObjectMember><dem:ReliefFeature gml:id="plane"><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>-100 -100 70 100 -100 90 100 100 130 -100 100 110 -100 -100 70</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></dem:ReliefFeature></core:cityObjectMember>${extra}</core:CityModel>`;

test('ground-height candidate requires confirmation, exports only confirmed samples and clears on source replacement', async ({ page }) => {
  await page.route('**/api/**', r => r.abort());
  await page.goto('/?view=city');
  await page.getByRole('button', { name: '合成都市デモを表示', exact: true }).click();
  await page.getByLabel('CityGMLファイル', { exact: true }).setInputFiles({ name: 'plane.gml', mimeType: 'application/xml', buffer: Buffer.from(fixture()) });
  await page.getByRole('button', { name: 'CityGMLを点検・プレビュー', exact: true }).click();
  await page.getByRole('button', { name: '確認して都市モデルを表示', exact: true }).click();
  const region = page.getByRole('region', { name: '施工範囲の地形5点確認' });
  await expect(region).toContainText('中心：100.000 m');
  await page.getByLabel('地形 (1)', { exact: true }).uncheck();
  await expect(region).toContainText('中心：100.000 m');
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  await page.getByLabel('施工範囲の東方向 (m)', { exact: true }).fill('20');
  await page.getByRole('button', { name: '中心の地形高さを標高候補にする', exact: true }).click();
  await expect(page.getByLabel('施工範囲の標高 (m / 原データ基準)', { exact: true })).toHaveValue('102');
  const saved = async () => {
    const download = page.waitForEvent('download'); await page.getByRole('button', { name: '都市の表示条件JSONを保存', exact: true }).click();
    return JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  };
  const before = await saved(); expect(before.footprint.east).toBe(0); expect(before.terrain_inspection.samples[0].elevations).toEqual([100]);
  expect(before.terrain_inspection.whole_footprint_coverage_verified).toBe(false);
  await page.getByRole('button', { name: '施工範囲の編集を取消', exact: true }).click();
  await expect(page.getByLabel('施工範囲の東方向 (m)', { exact: true })).toHaveValue('0');
  await page.getByLabel('施工範囲の東方向 (m)', { exact: true }).fill('20');
  await page.getByRole('button', { name: '中心の地形高さを標高候補にする', exact: true }).click();
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  const after = await saved(); expect(after.footprint).toMatchObject({ east: 20, elevation: 102 });
  expect(after.terrain_inspection.samples[0].elevations).toEqual([102]);
  expect(after.numerical_solver_linked).toBe(false);
  await page.screenshot({ path: '../../.local/terrain-inspection-20261013.png', fullPage: true });
  await page.getByLabel('施工範囲の東方向 (m)', { exact: true }).fill('1000');
  await expect(region).toContainText('地形がありません・外挿しません');
  await expect(page.getByRole('button', { name: '中心の地形高さを標高候補にする', exact: true })).toBeDisabled();
  expect(await saved()).toEqual(after);
  await page.getByRole('button', { name: '合成都市デモを表示', exact: true }).click();
  expect((await saved()).terrain_inspection).toBeNull();
});

test('overlapping terrain heights disable the ground-height proposal without changing the confirmed model', async ({ page }) => {
  await page.route('**/api/**', r => r.abort());
  await page.goto('/?view=city');
  await page.getByRole('button', { name: '合成都市デモを表示', exact: true }).click();
  const raised = fixture().match(/<core:cityObjectMember>[\s\S]*?<\/core:cityObjectMember>/)![0]
    .replace('gml:id="plane"', 'gml:id="raised"')
    .replace('-100 -100 70 100 -100 90 100 100 130 -100 100 110 -100 -100 70', '-100 -100 80 100 -100 100 100 100 140 -100 100 120 -100 -100 80');
  await page.getByLabel('CityGMLファイル', { exact: true }).setInputFiles({ name: 'layers.gml', mimeType: 'application/xml', buffer: Buffer.from(fixture(raised)) });
  await page.getByRole('button', { name: 'CityGMLを点検・プレビュー', exact: true }).click();
  await page.getByRole('button', { name: '確認して都市モデルを表示', exact: true }).click();
  await expect(page.getByRole('region', { name: '施工範囲の地形5点確認' })).toContainText('高さが重なる・鉛直面');
  await expect(page.getByRole('button', { name: '中心の地形高さを標高候補にする', exact: true })).toBeDisabled();
  // An explicitly entered display marker is still allowed; it does not resolve ground ambiguity.
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '都市の表示条件JSONを保存', exact: true }).click();
  const json = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(json.terrain_inspection.samples[0]).toMatchObject({ status: 'ambiguous', elevations: [100, 110] });
});
