import { test, expect } from '@playwright/test';
import type { Project, Row } from '../src/types';

test('section conversion requires confirmation and preserves trapezoid coordinates and hydraulic results', async ({ page, request }) => {
  const project: Project = await (await request.get('/api/sample')).json();
  project.id = `section-conversion-${crypto.randomUUID()}`;
  project.name = project.id;
  project.scenarios = [];
  project.staged = false;
  expect((await request.post('/api/projects', { data: project })).ok()).toBeTruthy();
  const baselineResponse = await request.post('/api/runs', { data: { project, scenarios: [], staged: false } });
  expect(baselineResponse.ok()).toBeTruthy();
  const baseline = await baselineResponse.json();
  await page.goto('/');
  await page.getByLabel('保存済みプロジェクト').selectOption(project.id);
  await page.getByRole('button', { name: '横断面エディタ', exact: true }).click();
  await page.getByLabel('断面形状の変更を全測点に反映').check();
  await page.getByLabel('断面形式', { exact: true }).selectOption('survey');
  const proposal = page.getByRole('region', { name: '断面形式の変更確認' });
  await expect(proposal).toContainText('座標を保持');
  await expect(proposal).toContainText('全測点の断面形状');
  await expect(page.getByLabel('底幅 (m)', { exact: true })).toHaveValue('20');
  await page.getByRole('button', { name: 'プロジェクトを保存', exact: true }).click();
  await expect(page.getByText('プロジェクトを SQLite に保存しました')).toBeVisible();
  expect(await (await request.get(`/api/projects/${project.id}`)).json()).toEqual(project);
  await page.getByRole('button', { name: '断面形式の変更を取消', exact: true }).click();
  await expect(page.getByLabel('断面形式', { exact: true })).toHaveValue('trapezoid');
  await page.getByLabel('断面形式', { exact: true }).selectOption('survey');
  await page.getByRole('button', { name: '断面形式の変更を反映', exact: true }).click();
  const points = [{ x: -22, z: 8 }, { x: -10, z: 0 }, { x: 10, z: 0 }, { x: 22, z: 8 }];
  await expect(page.getByLabel('測量点', { exact: true })).toHaveValue(points.map(p => `${p.x}, ${p.z}`).join('\n'));
  // Empty draft must remain empty and fail, rather than silently reuse old points.
  await page.getByLabel('測量点', { exact: true }).fill('');
  await page.getByRole('button', { name: '測量点を反映', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '各行に有限値' })).toBeVisible();
  await page.getByRole('button', { name: /No.02/ }).click();
  await expect(page.getByLabel('測量点', { exact: true })).toHaveValue(points.map(p => `${p.x}, ${p.z}`).join('\n'));
  await page.getByRole('button', { name: 'プロジェクトを保存', exact: true }).click();
  await expect(page.getByText('プロジェクトを SQLite に保存しました')).toBeVisible();
  const saved: Project = await (await request.get(`/api/projects/${project.id}`)).json();
  expect(saved.river.stations).toEqual(project.river.stations.map(s => ({ ...s, section: { kind: 'survey', points } })));
  await page.getByRole('button', { name: '水理計算', exact: true }).click();
  const pending = page.waitForResponse(r => r.url().endsWith('/api/runs') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '計算を実行', exact: true }).click();
  const response = await pending;
  expect(response.ok()).toBeTruthy();
  const converted = await response.json();
  const rows: Row[] = converted.analysis.run.profile.rows;
  expect(rows).toHaveLength(baseline.analysis.run.profile.rows.length);
  for (const [i, row] of rows.entries()) {
    for (const key of ['depth', 'water_elevation', 'area', 'velocity', 'froude', 'normal_depth', 'critical_depth'] as const) {
      expect(Math.abs(row[key] - baseline.analysis.run.profile.rows[i][key])).toBeLessThan(1e-7);
    }
  }
  expect(await (await request.get(`/api/runs/${baseline.id}`)).json()).toEqual(baseline);
  expect((await (await request.get(`/api/projects/${project.id}/runs`)).json()).items).toHaveLength(2);
});

test('vertical banks are refused without shifting coordinates; parametric conversion retains custom dimensions', async ({ page, request }) => {
  const project: Project = await (await request.get('/api/sample')).json();
  project.id = `section-vertical-${crypto.randomUUID()}`;
  project.name = project.id;
  project.scenarios = [];
  project.river.stations.forEach(s => { s.section = { kind: 'rectangle', width: 26, bank_height: 6 }; });
  expect((await request.post('/api/projects', { data: project })).ok()).toBeTruthy();
  await page.goto('/');
  await page.getByLabel('保存済みプロジェクト').selectOption(project.id);
  await page.getByRole('button', { name: '横断面エディタ', exact: true }).click();
  await page.getByLabel('断面形式', { exact: true }).selectOption('survey');
  await expect(page.getByRole('alert').filter({ hasText: '自動補正しません' })).toBeVisible();
  await expect(page.getByLabel('断面形式', { exact: true })).toHaveValue('rectangle');
  await expect(page.getByRole('button', { name: '断面形式の変更を反映', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'プロジェクトを保存', exact: true }).click();
  await expect(page.getByText('プロジェクトを SQLite に保存しました')).toBeVisible();
  expect(await (await request.get(`/api/projects/${project.id}`)).json()).toEqual(project);
  // A proposal belongs to its original station, even when adjacent geometry is identical.
  await page.getByLabel('断面形式', { exact: true }).selectOption('trapezoid');
  await expect(page.getByRole('region', { name: '断面形式の変更確認' })).toContainText('底幅 26 m、法勾配 0、堤岸高 6 m');
  await page.getByRole('button', { name: /No.02/ }).click();
  await expect(page.getByRole('region', { name: '断面形式の変更確認' })).toHaveCount(0);
  await page.getByLabel('断面形式', { exact: true }).selectOption('trapezoid');
  await page.getByRole('button', { name: '断面形式の変更を反映', exact: true }).click();
  await expect(page.getByLabel('底幅 (m)', { exact: true })).toHaveValue('26');
  await expect(page.getByLabel('法勾配 (水平 / 鉛直)', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('堤岸高・河床から (m)', { exact: true })).toHaveValue('6');
  await page.getByLabel('断面形式', { exact: true }).selectOption('survey');
  await expect(page.getByRole('alert').filter({ hasText: '自動補正しません' })).toBeVisible();
  await expect(page.getByLabel('断面形式', { exact: true })).toHaveValue('trapezoid');
  await page.getByRole('button', { name: 'プロジェクトを保存', exact: true }).click();
  await expect(page.getByText('プロジェクトを SQLite に保存しました')).toBeVisible();
  const saved: Project = await (await request.get(`/api/projects/${project.id}`)).json();
  expect(saved.river.stations[1].section).toEqual({ kind: 'trapezoid', bottom_width: 26, side_slope: 0, bank_height: 6 });
  expect(saved.river.stations.filter((_, i) => i !== 1)).toEqual(project.river.stations.filter((_, i) => i !== 1));
  expect((await (await request.get(`/api/projects/${project.id}/runs`)).json()).items).toHaveLength(0);
});

test('construction replacement confirms shape changes and keeps the base river in saved results', async ({ page, request }) => {
  const project: Project = await (await request.get('/api/sample')).json();
  project.id = `section-replacement-${crypto.randomUUID()}`;
  project.name = project.id;
  expect((await request.post('/api/projects', { data: project })).ok()).toBeTruthy();
  await page.goto('/');
  await page.getByLabel('保存済みプロジェクト').selectOption(project.id);
  await page.getByRole('button', { name: '施工シナリオ比較', exact: true }).click();
  await page.getByRole('combobox', { name: '条件変更', exact: true }).selectOption('replace_section');
  await page.getByLabel('断面形式', { exact: true }).selectOption('rectangle');
  await expect(page.getByRole('region', { name: '断面形式の変更確認' })).toContainText('形状が変わります');
  await page.screenshot({ path: '../../.local/section-conversion-20261012.png', fullPage: true });
  await page.getByRole('button', { name: '断面形式の変更を取消', exact: true }).click();
  await expect(page.getByLabel('断面形式', { exact: true })).toHaveValue('trapezoid');
  await page.getByLabel('断面形式', { exact: true }).selectOption('rectangle');
  await page.getByRole('button', { name: '断面形式の変更を反映', exact: true }).click();
  const pending = page.waitForResponse(r => r.url().endsWith('/api/runs') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '計算を実行', exact: true }).click();
  const response = await pending;
  expect(response.ok()).toBeTruthy();
  const run = await response.json();
  expect(run.analysis.project.river).toEqual(project.river);
  expect(run.analysis.comparisons[0].river.stations.map((s: { section: unknown }) => s.section)).toEqual(
    project.river.stations.map(() => ({ kind: 'rectangle', width: 20, bank_height: 8 })),
  );
  expect(run.analysis.comparisons[0].profile.rows.at(-1).water_elevation).toBeCloseTo(12.2, 8);
});
