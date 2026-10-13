import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { cityDisplayFingerprint, cityDisplayVersion, inspectCityDisplay } from '../src/cityDisplay';
import type { CityModel } from '../src/cityModel';

const model: CityModel = { crs: 'urn:doboku:crs:local-metre', origin: [0, 0, 100], bounds: { min: [-100, -50, -100], max: [100, 100, 100] },
  lod: 1, polygonCount: 1, features: [{ id: 'plane', layer: 'terrain', triangleCount: 1, positions: [-100, 0, 100, 100, 0, 100, 0, 0, -100] }] };
const sources = [{ name: 'plane.gml', bytes: 256, sha256: 'a'.repeat(64) }];
async function settings() {
  return { schema_version: 2, display_version: cityDisplayVersion, exported_at: '2026-10-13T01:00:00Z', model_type: 'citygml_display', numerical_solver_linked: false,
    crs: model.crs, origin: model.origin, bounds: model.bounds, lod: model.lod, feature_count: model.features.length, polygon_count: model.polygonCount, sources,
    model_fingerprint_sha256: await cityDisplayFingerprint(model), footprint: { east: 0, north: 0, width: 40, length: 30, elevation: 100 },
    visible_layers: ['terrain'], selected_feature: 'plane', top: true, rotating: false, sunset: true };
}

test('display identity detects different geometry with identical bounds and strictly validates restored settings', async () => {
  const saved = await settings();
  expect(await cityDisplayFingerprint(structuredClone(model))).toBe(saved.model_fingerprint_sha256);
  const changed = structuredClone(model); changed.features[0].positions[1] = .25;
  expect(changed.bounds).toEqual(model.bounds); expect(changed.polygonCount).toBe(model.polygonCount);
  expect(await cityDisplayFingerprint(changed)).not.toBe(saved.model_fingerprint_sha256);
  await expect(inspectCityDisplay(saved, changed, sources)).rejects.toThrow('地物・地形形状');
  const valid = await inspectCityDisplay({ ...saved, bounds: { max: model.bounds.max, min: model.bounds.min },
    source_url: 'javascript:alert(1)', attribution: '<script>fake</script>', terrain_inspection: { samples: [{ elevations: [999] }] } }, model, sources);
  expect(valid).toMatchObject({ exported_at: '2026-10-13T01:00:00.000Z', selected_feature: 'plane', footprint: saved.footprint });
  expect(valid).not.toHaveProperty('source_url'); expect(valid).not.toHaveProperty('terrain_inspection');
  expect(await inspectCityDisplay({ ...saved, footprint: null, visible_layers: [], selected_feature: null }, model, sources)).toMatchObject({ footprint: null, visible_layers: [], selected_feature: null });
  for (const patch of [
    { schema_version: 1 }, { numerical_solver_linked: true }, { display_version: '999' }, { exported_at: 'invalid' },
    { crs: 'EPSG:9999' }, { lod: 2 }, { sources: [{ ...sources[0], sha256: 'b'.repeat(64) }] }, { model_fingerprint_sha256: '0'.repeat(64) },
    { footprint: { ...saved.footprint, width: -1 } }, { footprint: { ...saved.footprint, north: 10000 } },
    { footprint: { ...saved.footprint, elevation: NaN } }, { footprint: { ...saved.footprint, width: '40' } },
    { visible_layers: ['terrain', 'terrain'] }, { visible_layers: ['unknown'] }, { selected_feature: 'unknown' }, { rotating: 'false' },
  ]) await expect(inspectCityDisplay({ ...saved, ...patch }, model, sources)).rejects.toThrow();
});

async function exported(page: Page) {
  const event = page.waitForEvent('download'); await page.getByRole('button', { name: '都市の表示条件JSONを保存', exact: true }).click();
  return JSON.parse(await readFile((await (await event).path())!, 'utf8'));
}
async function file(page: Page, data: unknown, name = 'display.json') {
  await page.getByLabel('都市の表示条件JSON', { exact: true }).setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
}
async function inspect(page: Page, data: unknown) {
  await file(page, data); await page.getByRole('button', { name: '表示条件JSONを点検', exact: true }).click();
}
const restoredFields = (s: Record<string, unknown>) => ({ footprint: s.footprint, visible_layers: s.visible_layers, selected_feature: s.selected_feature, top: s.top, rotating: s.rotating, sunset: s.sunset });

test('public Yokohama display settings survive reload with review, current provenance and fresh terrain inspection', async ({ page }) => {
  const posts: string[] = []; page.on('request', r => { if (r.method() === 'POST') posts.push(r.url()); });
  await page.route('**/api/**', r => r.abort()); await page.goto('/?view=city');
  await expect(page.getByRole('heading', { name: '横浜・みなとみらい（PLATEAU 2024）', exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByLabel('施工範囲の幅 (m)', { exact: true }).fill('55');
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  await page.getByRole('button', { name: '都市を真上から', exact: true }).click();
  await page.getByRole('button', { name: '都市を夕景で表示', exact: true }).click();
  await page.getByLabel('建物 (55)', { exact: true }).uncheck();
  await page.getByLabel('施工範囲の幅 (m)', { exact: true }).fill('70');
  const saved = await exported(page); expect(saved.footprint.width).toBe(55); expect(saved.model_fingerprint_sha256).toMatch(/^[a-f0-9]{64}$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: '横浜・みなとみらい（PLATEAU 2024）', exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  await page.getByRole('button', { name: '反映済み範囲の地形断面を表示', exact: true }).click();
  const before = await exported(page);
  const incoming = { ...saved, attribution: '</pre><script>fake()</script>', source_url: 'javascript:alert(1)', dataset: null,
    terrain_inspection: { method: 'fake', samples: [{ elevations: [999] }] } };
  await inspect(page, incoming);
  const review = page.getByRole('region', { name: '都市の表示条件復元の確認', exact: true });
  await expect(review).toContainText('55 × 30 m'); await expect(review).toContainText('地物形状');
  expect(restoredFields(await exported(page))).toEqual(restoredFields(before));
  await page.getByRole('button', { name: '表示条件の復元を取消', exact: true }).click();
  expect(restoredFields(await exported(page))).toEqual(restoredFields(before));
  await expect(page.getByRole('img', { name: '東西の地形断面', exact: true })).toBeVisible();
  await inspect(page, incoming); await page.getByRole('button', { name: '確認して表示条件を復元', exact: true }).click();
  await expect(review).toHaveCount(0); await expect(page.getByLabel('施工範囲の幅 (m)', { exact: true })).toHaveValue('55');
  await expect(page.getByLabel('建物 (55)', { exact: true })).not.toBeChecked();
  await expect(page.getByRole('button', { name: '都市を真上から', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '都市を夕景で表示', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '施工範囲の地形断面HTMLを保存', exact: true })).toBeDisabled();
  const after = await exported(page); expect(restoredFields(after)).toEqual(restoredFields(saved));
  expect(after.attribution).toBe(saved.attribution); expect(after.dataset.license).toBe('CC BY 4.0');
  expect(after.terrain_inspection.samples).toEqual(saved.terrain_inspection.samples); expect(after.model_fingerprint_sha256).toBe(saved.model_fingerprint_sha256);
  expect(after.inspected_at).not.toBe(saved.inspected_at); expect(posts).toEqual([]);
  await page.getByRole('button', { name: '反映済み範囲の地形断面を表示', exact: true }).click();
  await expect(page.getByRole('img', { name: '東西の地形断面', exact: true })).toBeVisible();
});

test('unsupported, oversized, corrupted and foreign display files preserve existing display and null footprints restore explicitly', async ({ page }) => {
  await page.route('**/api/**', r => r.abort()); await page.goto('/?view=city');
  await page.getByRole('button', { name: '合成都市デモを表示', exact: true }).click();
  const hidden = await exported(page);
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  const saved = await exported(page);
  for (const bad of [{ ...saved, schema_version: 1 }, { ...saved, model_fingerprint_sha256: '0'.repeat(64) },
    { ...saved, footprint: { ...saved.footprint, elevation: 100000 } }, { ...saved, visible_layers: ['unknown'] }]) {
    await inspect(page, bad); await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('region', { name: '都市の表示条件復元の確認', exact: true })).toHaveCount(0);
    expect(restoredFields(await exported(page))).toEqual(restoredFields(saved));
  }
  for (const [name, buffer] of [['large.json', Buffer.alloc(128 * 1024 + 1, ' ')], ['broken.json', Buffer.from('{not JSON')]] as const) {
    await page.getByLabel('都市の表示条件JSON', { exact: true }).setInputFiles({ name, mimeType: 'application/json', buffer });
    await page.getByRole('button', { name: '表示条件JSONを点検', exact: true }).click(); await expect(page.getByRole('alert')).toBeVisible();
    expect(restoredFields(await exported(page))).toEqual(restoredFields(saved));
  }
  await inspect(page, { ...hidden, visible_layers: [], selected_feature: null });
  await expect(page.getByRole('region', { name: '都市の表示条件復元の確認', exact: true })).toContainText('すべて非表示');
  await page.getByRole('button', { name: '確認して表示条件を復元', exact: true }).click();
  expect((await exported(page)).footprint).toBeNull(); await expect(page.getByRole('button', { name: '施工範囲の確認資料HTMLを保存', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '横浜の公開モデルを確認', exact: true }).click();
  await page.getByRole('button', { name: '確認して都市モデルを表示', exact: true }).click();
  await inspect(page, saved); await expect(page.getByRole('alert')).toContainText('一致しません');
  expect((await exported(page)).data_kind).toBe('public_city_model');
});

test('changing the restore file or source during delayed inspection cannot revive an obsolete candidate', async ({ page }) => {
  await page.route('**/api/**', r => r.abort()); await page.goto('/?view=city');
  const saved = await exported(page);
  await page.evaluate(() => {
    const text = File.prototype.text;
    File.prototype.text = async function () {
      const value = await text.call(this);
      if (this.name === 'delayed.json') await new Promise<void>(resolve => { (window as unknown as { releaseRestore: () => void }).releaseRestore = resolve; });
      return value;
    };
  });
  const review = page.getByRole('region', { name: '都市の表示条件復元の確認', exact: true });
  for (const changeModel of [false, true]) {
    await file(page, saved, 'delayed.json'); await page.getByRole('button', { name: '表示条件JSONを点検', exact: true }).click();
    await expect(page.getByRole('button', { name: '表示条件を点検中…', exact: true })).toBeDisabled();
    await page.waitForFunction(() => typeof (window as unknown as { releaseRestore?: () => void }).releaseRestore === 'function');
    if (changeModel) await page.getByRole('button', { name: '合成都市デモを表示', exact: true }).click();
    else await file(page, { ...saved, schema_version: 1 });
    await page.evaluate(async () => {
      (window as unknown as { releaseRestore: () => void }).releaseRestore();
      delete (window as unknown as { releaseRestore?: () => void }).releaseRestore;
      await new Promise(resolve => setTimeout(resolve, 150));
    });
    await expect(review).toHaveCount(0); await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '表示条件JSONを点検', exact: true })).toBeEnabled();
  }
  expect((await exported(page)).data_kind).toBe('synthetic');
});

test('restoring display settings preserves stored river conditions, run history and active hydraulic inputs', async ({ page, request }) => {
  const project = await (await request.get('/api/sample')).json(); project.id = `city-display-${crypto.randomUUID()}`; project.name = project.id; project.river.discharge = 119;
  expect((await request.post('/api/projects', { data: project })).ok()).toBe(true);
  const response = await request.post('/api/runs', { data: { project, scenarios: [], staged: false } }); expect(response.ok()).toBe(true); const run = await response.json();
  await page.goto('/'); await page.getByLabel('保存済みプロジェクト').selectOption(project.id);
  const posts: string[] = []; page.on('request', r => { if (r.method() === 'POST') posts.push(r.url()); });
  await page.getByRole('button', { name: '都市・地形3D', exact: true }).click();
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click(); const saved = await exported(page);
  await page.getByLabel('施工範囲の幅 (m)', { exact: true }).fill('55');
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  await inspect(page, saved); await page.getByRole('button', { name: '確認して表示条件を復元', exact: true }).click();
  expect((await exported(page)).footprint.width).toBe(40); expect(posts).toEqual([]);
  expect(await (await request.get(`/api/projects/${project.id}`)).json()).toEqual(project);
  expect(await (await request.get(`/api/runs/${run.id}`)).json()).toEqual(run);
  await page.getByRole('button', { name: '水理計算', exact: true }).click(); await expect(page.getByLabel('流量 Q (m³/s)', { exact: true })).toHaveValue('119');
});
