import { test, expect } from '@playwright/test';

test('common-datum water level sets downstream depth and construction retains the entered level', async ({ page, request }) => {
  const project = await (await request.get('/api/sample')).json();
  project.id = `stage-subcritical-${crypto.randomUUID()}`;
  project.name = project.id;
  project.reference.vertical_datum = '合成の共通基準高・境界入力';
  expect((await request.post('/api/projects', { data: project })).ok()).toBeTruthy();
  await page.goto('/');
  await page.getByLabel('保存済みプロジェクト').selectOption(project.id);
  await page.getByRole('button', { name: '水理計算', exact: true }).click();
  const stage = page.getByLabel('境界水位 (m / 共通基準高)', { exact: true });
  const depth = page.getByLabel('境界水深 (m / 河床から)', { exact: true });
  await expect(stage).toHaveValue('12.2');
  await expect(page.getByRole('status').filter({ hasText: '下流端（常流）' })).toContainText('河床標高 9 m');
  await expect(page.getByRole('status').filter({ hasText: '下流端（常流）' })).toContainText(project.reference.vertical_datum);
  await stage.fill('12.6');
  expect(Number(await depth.inputValue())).toBeCloseTo(3.6, 12);
  // Input edits do not save or append history until the explicit actions.
  expect(await (await request.get(`/api/projects/${project.id}`)).json()).toEqual(project);
  expect((await (await request.get(`/api/projects/${project.id}/runs`)).json()).items).toHaveLength(0);
  await page.getByRole('button', { name: 'プロジェクトを保存', exact: true }).click();
  const pending = page.waitForResponse(r => r.url().endsWith('/api/runs') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '計算を実行', exact: true }).click();
  const response = await pending;
  expect(response.ok()).toBeTruthy();
  const stored = await response.json();
  expect(stored.analysis.project.river.boundary.depth).toBeCloseTo(3.6, 12);
  expect(stored.analysis.run.profile.rows.at(-1).water_elevation).toBeCloseTo(12.6, 12);
  expect(stored.analysis.comparisons[0].river.boundary.depth).toBeCloseTo(4.6, 12);
  expect(stored.analysis.comparisons[0].profile.rows.at(-1).water_elevation).toBeCloseTo(12.6, 12);
  await expect(page.getByText('数値計算と施工比較が完了しました')).toBeVisible();
  // Below-bed input remains invalid; no clamping or fabricated result/history.
  for (const input of ['8.5', '9', '']) {
    await stage.fill(input);
    if (input === '') await expect(depth).toHaveValue('');
    else expect(Number(await depth.inputValue())).toBeCloseTo(Number(input) - 9, 12);
    await expect(page.getByRole('alert').filter({ hasText: '水深は0より大きい値が必要' })).toBeVisible();
    const failed = page.waitForResponse(r => r.url().endsWith('/api/runs') && r.request().method() === 'POST');
    await page.getByRole('button', { name: '計算を実行', exact: true }).click();
    expect((await failed).status()).toBe(422);
  }
  expect((await (await request.get(`/api/projects/${project.id}/runs`)).json()).items).toHaveLength(1);
  expect(await (await request.get(`/api/runs/${stored.id}`)).json()).toEqual(stored);
  await page.reload();
  await page.getByLabel('保存済みプロジェクト').selectOption(project.id);
  await page.getByRole('button', { name: '水理計算', exact: true }).click();
  expect(Number(await stage.inputValue())).toBeCloseTo(12.6, 12);
  await depth.fill('3.4');
  expect(Number(await stage.inputValue())).toBeCloseTo(12.4, 12);
  // Bed edits preserve the specified depth, so the derived displayed level changes.
  await page.getByRole('button', { name: '横断面エディタ', exact: true }).click();
  await page.getByRole('button', { name: /No.11/ }).click();
  await page.getByLabel('河床標高 (m / 共通基準高)', { exact: true }).fill('9.1');
  await page.getByRole('button', { name: '水理計算', exact: true }).click();
  expect(Number(await depth.inputValue())).toBeCloseTo(3.4, 12);
  expect(Number(await stage.inputValue())).toBeCloseTo(12.5, 12);
  await page.screenshot({ path: '../../.local/boundary-stage-20261012.png', fullPage: true });
});

test('supercritical water level uses the upstream bed; regime switch recalculates the displayed level', async ({ page, request }) => {
  const project = await (await request.get('/api/sample')).json();
  project.id = `stage-supercritical-${crypto.randomUUID()}`;
  project.name = project.id;
  project.reference.vertical_datum = '合成の共通基準高・射流';
  project.scenarios = [];
  project.staged = false;
  project.river = {
    discharge: 20, normal_slope: 0.02,
    boundary: { regime: 'supercritical', depth: 0.5 },
    stations: Array.from({ length: 11 }, (_, i) => ({
      chainage: i * 10, bed_elevation: 10 - i * 0.2, roughness: 0.03,
      section: { kind: 'rectangle', width: 10, bank_height: 8 },
    })),
  };
  expect((await request.post('/api/projects', { data: project })).ok()).toBeTruthy();
  await page.goto('/');
  await page.getByLabel('保存済みプロジェクト').selectOption(project.id);
  await page.getByRole('button', { name: '水理計算', exact: true }).click();
  const stage = page.getByLabel('境界水位 (m / 共通基準高)', { exact: true });
  const depth = page.getByLabel('境界水深 (m / 河床から)', { exact: true });
  await expect(stage).toHaveValue('10.5');
  await expect(page.getByRole('status').filter({ hasText: '上流端（射流）' })).toContainText('距離 0 m · 河床標高 10 m');
  await stage.fill('10.55');
  expect(Number(await depth.inputValue())).toBeCloseTo(0.55, 12);
  const pending = page.waitForResponse(r => r.url().endsWith('/api/runs') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '計算を実行', exact: true }).click();
  const response = await pending;
  expect(response.ok()).toBeTruthy();
  const stored = await response.json();
  expect(stored.analysis.run.profile.rows[0].water_elevation).toBeCloseTo(10.55, 12);
  expect(stored.analysis.run.profile.rows[0].depth).toBeCloseTo(0.55, 12);
  expect(stored.analysis.run.profile.rows.every((row: { froude: number }) => row.froude > 1.02)).toBe(true);
  await expect(page.getByText('数値計算と施工比較が完了しました')).toBeVisible();
  await page.getByLabel('境界条件 / 流況', { exact: true }).selectOption('subcritical');
  expect(Number(await depth.inputValue())).toBeCloseTo(0.55, 12);
  expect(Number(await stage.inputValue())).toBeCloseTo(8.55, 12);
  await expect(page.getByRole('status').filter({ hasText: '下流端（常流）' })).toContainText('河床標高 8 m');
  expect(await (await request.get(`/api/runs/${stored.id}`)).json()).toEqual(stored);
});
