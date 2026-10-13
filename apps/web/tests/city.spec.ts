import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const geographic = `<?xml version="1.0"?><core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:gml="http://www.opengis.net/gml" xmlns:bldg="http://www.opengis.net/citygml/building/2.0" xmlns:dem="http://www.opengis.net/citygml/relief/2.0" srsName="urn:ogc:def:crs:EPSG::6697" srsDimension="3">
<core:cityObjectMember><dem:ReliefFeature gml:id="synthetic-ground"><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>35 139 100 35 139.001 100 35.001 139.001 100 35.001 139 100 35 139 100</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></dem:ReliefFeature></core:cityObjectMember>
<core:cityObjectMember><bldg:Building gml:id="synthetic-roof"><bldg:lod1MultiSurface><gml:MultiSurface><gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>35 139 110 35 139.001 110 35.001 139.001 110 35.001 139 110 35 139 110</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember></gml:MultiSurface></bldg:lod1MultiSurface></bldg:Building></core:cityObjectMember>
</core:CityModel>`;

test('bundled PLATEAU Yokohama model displays original data with licensed provenance and no external requests', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const external: string[] = [];
  const origin = new URL(test.info().project.use.baseURL as string).origin;
  page.on('request', r => { if (r.url().startsWith('http') && new URL(r.url()).origin !== origin) external.push(r.url()); });
  await page.route('**/api/**', r => r.abort());
  await page.goto('/?view=city');
  // The cold Vite transform includes the bundled real model; wait for readiness.
  await expect(page.getByRole('heading', { name: '横浜・みなとみらい（PLATEAU 2024）', exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByLabel('都市と地形の3Dビュー').locator('canvas')).toBeVisible();
  await expect(page.getByText('公開都市モデル・表示用抜粋', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '都市を真上から', exact: true }).click();
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: '都市の表示条件JSONを保存', exact: true }).click();
  const data = JSON.parse(await readFile((await (await exported).path())!, 'utf8'));
  expect(data.synthetic).toBe(false); expect(data.data_kind).toBe('public_city_model');
  expect(data.numerical_solver_linked).toBe(false); expect(data.dataset.license).toBe('CC BY 4.0');
  expect(data.dataset.building_ids).toHaveLength(38); expect(data.dataset.terrain_triangles).toBe(12206);
  expect(data.crs).toBe('EPSG:6697'); expect(data.bounds.max[1]).toBeGreaterThan(290);
  for (const source of data.sources) {
    const bytes = await readFile(`src/data/yokohama/${source.name}`);
    expect(bytes.length).toBe(source.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.sha256);
  }
  await page.screenshot({ path: '../../.local/plateau-yokohama-20261012.png', fullPage: true });
  await page.getByRole('button', { name: '合成都市デモを表示', exact: true }).click();
  await expect(page.getByRole('heading', { name: '合成都市デモ', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '横浜の公開モデルを確認', exact: true }).click();
  await expect(page.getByRole('region', { name: '都市モデルの取込み確認' })).toBeVisible();
  await page.getByRole('button', { name: '確認して都市モデルを表示', exact: true }).click();
  await expect(page.getByRole('heading', { name: '横浜・みなとみらい（PLATEAU 2024）', exact: true })).toBeVisible();
  expect(external).toEqual([]); expect(errors).toEqual([]);
});

test('city demo works without API and confirms overlays without using uncommitted inputs', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const posts: string[] = []; page.on('request', r => { if (r.method() === 'POST') posts.push(r.url()); });
  await page.route('**/api/**', r => r.abort());
  await page.goto('/?view=city');
  await page.getByRole('button', { name: '合成都市デモを表示', exact: true }).click();
  await expect(page.getByRole('heading', { name: '都市・地形3D', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '合成都市デモ', exact: true })).toBeVisible();
  await expect(page.getByText('合成例', { exact: true })).toBeVisible();
  const stage = page.getByLabel('都市と地形の3Dビュー');
  await expect(stage.locator('canvas')).toBeVisible();
  expect(await stage.locator('canvas').evaluate(c => { const g = (c as HTMLCanvasElement).getContext('webgl2'); return !!g && !g.isContextLost(); })).toBe(true);
  await page.getByLabel('建物 (18)', { exact: true }).uncheck();
  await page.getByLabel('建物 (18)', { exact: true }).check();
  for (const name of ['都市を真上から', '都市を夕景で表示', '都市を自動回転']) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('button', { name, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: '都市を自動回転', exact: true }).click();
  await page.getByRole('button', { name: '都市を斜めから', exact: true }).click();
  await page.getByLabel('施工範囲の幅 (m)', { exact: true }).fill('55');
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '反映済み施工範囲' })).toContainText('55 × 30 m');
  await page.getByLabel('施工範囲の幅 (m)', { exact: true }).fill('70');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '都市の表示条件JSONを保存', exact: true }).click();
  const json = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(json.synthetic).toBe(true); expect(json.data_kind).toBe('synthetic'); expect(json.numerical_solver_linked).toBe(false);
  expect(json.footprint.width).toBe(55); expect(json.feature_count).toBe(22);
  expect(json.polygon_count).toBe(477); expect(json.sources).toEqual([]);
  await page.getByRole('button', { name: '施工範囲の編集を取消', exact: true }).click();
  await expect(page.getByLabel('施工範囲の幅 (m)', { exact: true })).toHaveValue('55');
  await page.getByLabel('施工範囲の東方向 (m)', { exact: true }).fill('10000');
  await expect(page.getByRole('button', { name: '確認して施工範囲を表示', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '施工範囲の編集を取消', exact: true }).click();
  await page.screenshot({ path: '../../.local/city-workspace-20261012.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(posts).toEqual([]); expect(errors).toEqual([]);
});

test('CityGML import confirms exact source hashes, common CRS and heights with independent horizontal reference', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/**', r => r.abort());
  await page.goto('/?view=city');
  await page.getByRole('button', { name: '合成都市デモを表示', exact: true }).click();
  const select = async () => page.getByLabel('CityGMLファイル', { exact: true }).setInputFiles({ name: 'synthetic-geographic.gml', mimeType: 'application/xml', buffer: Buffer.from(geographic) });
  await select();
  await page.getByLabel('都市モデルの原データURL').fill('https://example.invalid/synthetic-fixture');
  await page.getByLabel('都市モデルの出典', { exact: true }).fill('合成座標検証');
  await page.getByLabel('都市モデルの利用条件', { exact: true }).fill('テスト用合成例');
  await page.getByRole('button', { name: 'CityGMLを点検・プレビュー', exact: true }).click();
  const review = page.getByRole('region', { name: '都市モデルの取込み確認' });
  await expect(review).toContainText('2地物・2面 / EPSG:6697');
  const sha = createHash('sha256').update(geographic).digest('hex');
  await expect(review).toContainText(sha);
  await expect(page.getByRole('heading', { name: '合成都市デモ', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '都市モデルの取込みを取消', exact: true }).click();
  await expect(review).toHaveCount(0);
  await page.getByRole('button', { name: 'CityGMLを点検・プレビュー', exact: true }).click();
  await expect(review).toBeVisible();
  await page.getByLabel('都市モデルの出典', { exact: true }).fill('合成座標検証・更新');
  await expect(review).toHaveCount(0);
  await page.getByRole('button', { name: 'CityGMLを点検・プレビュー', exact: true }).click();
  await expect(review).toBeVisible();
  await page.getByRole('button', { name: '確認して都市モデルを表示', exact: true }).click();
  await expect(page.getByRole('heading', { name: '取り込んだ都市・地形', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '都市の表示条件JSONを保存', exact: true }).click();
  const json = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(json.synthetic).toBeNull(); expect(json.data_kind).toBe('unspecified');
  expect(json.crs).toBe('EPSG:6697'); expect(json.origin).toEqual([35.0005, 139.0005, 100]);
  expect(json.bounds.min[1]).toBe(0); expect(json.bounds.max[1]).toBe(10);
  // Independent GDAL/PROJ Transverse Mercator reference on GRS80, lat/lon
  // origin 35.0005/139.0005, k=1. Display tangent-plane error <0.001m here.
  expect(Math.abs(json.bounds.min[0] - -45.64408482283651)).toBeLessThan(.001);
  expect(Math.abs(json.bounds.max[0] - 45.64408482515929)).toBeLessThan(.001);
  expect(Math.abs(json.bounds.min[2] - -55.47040835239781)).toBeLessThan(.001);
  expect(Math.abs(json.bounds.max[2] - 55.470175307352825)).toBeLessThan(.001);
  expect(json.sources).toEqual([{ name: 'synthetic-geographic.gml', bytes: Buffer.byteLength(geographic), sha256: sha }]);
  expect(json.attribution).toBe('合成座標検証・更新'); expect(json.footprint.elevation).toBe(105);
  expect(json.numerical_solver_linked).toBe(false);
  expect(errors).toEqual([]);
});

test('invalid CityGML leaves confirmed display unchanged and rejects missing or ambiguous geometry', async ({ page }) => {
  await page.route('**/api/**', r => r.abort());
  await page.goto('/?view=city');
  await page.getByRole('button', { name: '合成都市デモを表示', exact: true }).click();
  const cases = [
    { xml: geographic.replaceAll('EPSG::6697', 'EPSG::4326'), message: '未対応の座標系' },
    { xml: geographic.replace('srsDimension="3"', 'srsDimension="2"'), message: 'srsDimension=3' },
    { xml: geographic.replace('<gml:exterior>', '<gml:interior/><gml:exterior>'), message: '穴を持つ面' },
    { xml: geographic.replace('35 139 100</gml:posList>', '35 139.0001 100</gml:posList>'), message: '同じ座標で閉じて' },
    { xml: geographic.replace('35 139 100 ', 'NaN 139 100 '), message: '有限値' },
    { xml: '<!DOCTYPE x><core:CityModel/>', message: 'DOCTYPE' },
    { xml: '<CityModel/>', message: 'CityGML 2.0/3.0' },
    { xml: geographic.replace('xmlns:gml=', 'xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:gml=').replace('<gml:surfaceMember>', '<gml:surfaceMember xlink:href="https://example.invalid/model.gml">'), message: 'xlink参照' },
    { xml: geographic.replaceAll('139.001', '140'), message: '対角5km' },
    { xml: geographic.replace('35 139 100 35 139.001 100 35.001 139.001 100 35.001 139 100', '35 139 100 35.001 139.001 100 35 139.001 100 35.001 139 100'), message: '自己交差' },
  ];
  for (const c of cases) {
    await page.getByLabel('CityGMLファイル', { exact: true }).setInputFiles({ name: 'invalid.gml', mimeType: 'application/xml', buffer: Buffer.from(c.xml) });
    await page.getByRole('button', { name: 'CityGMLを点検・プレビュー', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: c.message })).toBeVisible();
    await expect(page.getByRole('region', { name: '都市モデルの取込み確認' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '合成都市デモ', exact: true })).toBeVisible();
  }
  await page.getByLabel('CityGMLファイル', { exact: true }).setInputFiles({ name: 'large.gml', mimeType: 'application/xml', buffer: Buffer.alloc(8 * 1024 * 1024 + 1, 'x') });
  await page.getByRole('button', { name: 'CityGMLを点検・プレビュー', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '1ファイル8MiB' })).toBeVisible();
});

test('explicit LOD selection and mixed-CRS rejection preserve the last confirmed city and clear old overlays', async ({ page }) => {
  await page.route('**/api/**', r => r.abort());
  await page.goto('/?view=city');
  await page.getByRole('button', { name: '合成都市デモを表示', exact: true }).click();
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  const roof = geographic.match(/<core:cityObjectMember><bldg:Building[\s\S]+?<\/core:cityObjectMember>/)![0]
    .replaceAll('lod1MultiSurface', 'lod2MultiSurface').replaceAll('110', '190').replace('synthetic-roof', 'synthetic-roof-lod2');
  const xml = geographic.replace('</core:CityModel>', roof + '</core:CityModel>');
  await page.getByLabel('CityGMLファイル', { exact: true }).setInputFiles({ name: 'synthetic-lods.gml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
  await page.getByRole('button', { name: 'CityGMLを点検・プレビュー', exact: true }).click();
  const review = page.getByRole('region', { name: '都市モデルの取込み確認' });
  await expect(review).toContainText('2地物・2面');
  await page.getByLabel('表示LOD', { exact: true }).selectOption('2');
  await expect(review).toHaveCount(0);
  await page.getByRole('button', { name: 'CityGMLを点検・プレビュー', exact: true }).click();
  await expect(review).toContainText('LOD 2');
  await page.getByRole('button', { name: '確認して都市モデルを表示', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '反映済み施工範囲' })).toHaveCount(0);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '都市の表示条件JSONを保存', exact: true }).click();
  const saved = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  expect(saved.bounds.max[1]).toBe(90); expect(saved.lod).toBe(2);
  const local = await readFile('../../examples/synthetic-city.gml');
  await page.getByLabel('表示LOD', { exact: true }).selectOption('1');
  await page.getByLabel('CityGMLファイル', { exact: true }).setInputFiles([
    { name: 'geographic.gml', mimeType: 'application/xml', buffer: Buffer.from(geographic) },
    { name: 'local.gml', mimeType: 'application/xml', buffer: local },
  ]);
  await page.getByRole('button', { name: 'CityGMLを点検・プレビュー', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '異なる座標系' })).toBeVisible();
  const again = page.waitForEvent('download');
  await page.getByRole('button', { name: '都市の表示条件JSONを保存', exact: true }).click();
  const repeated = JSON.parse(await readFile((await (await again).path())!, 'utf8'));
  expect(Number.isFinite(Date.parse(repeated.exported_at))).toBe(true);
  expect({ ...repeated, exported_at: saved.exported_at }).toEqual(saved);
});

test('city import and planning overlay preserve saved river conditions and existing calculation history', async ({ page, request }) => {
  const project = await (await request.get('/api/sample')).json();
  project.id = `city-preservation-${crypto.randomUUID()}`; project.name = project.id;
  expect((await request.post('/api/projects', { data: project })).ok()).toBeTruthy();
  const calculated = await request.post('/api/runs', { data: { project, scenarios: [], staged: false } });
  expect(calculated.ok()).toBeTruthy(); const run = await calculated.json();
  await page.goto('/');
  await page.getByLabel('保存済みプロジェクト').selectOption(project.id);
  const posts: string[] = []; page.on('request', r => { if (r.method() === 'POST') posts.push(r.url()); });
  await page.getByRole('button', { name: '都市・地形3D', exact: true }).click();
  const fixture = await readFile('../../examples/synthetic-city.gml');
  await page.getByLabel('CityGMLファイル', { exact: true }).setInputFiles({ name: 'synthetic-city.gml', mimeType: 'application/xml', buffer: fixture });
  await page.getByRole('button', { name: 'CityGMLを点検・プレビュー', exact: true }).click();
  await expect(page.getByRole('region', { name: '都市モデルの取込み確認' })).toBeVisible();
  await page.getByRole('button', { name: '確認して都市モデルを表示', exact: true }).click();
  await page.getByRole('button', { name: '確認して施工範囲を表示', exact: true }).click();
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: '都市の表示条件JSONを保存', exact: true }).click();
  const metadata = JSON.parse(await readFile((await (await exported).path())!, 'utf8'));
  expect(metadata.synthetic).toBeNull(); expect(metadata.data_kind).toBe('unspecified');
  expect(posts).toEqual([]);
  expect(await (await request.get(`/api/projects/${project.id}`)).json()).toEqual(project);
  expect(await (await request.get(`/api/runs/${run.id}`)).json()).toEqual(run);
  await page.getByRole('button', { name: '水理計算', exact: true }).click();
  await expect(page.getByLabel('流量 Q (m³/s)', { exact: true })).toHaveValue(String(project.river.discharge));
});
