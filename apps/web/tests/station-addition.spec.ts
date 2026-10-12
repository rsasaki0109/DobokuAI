import { test, expect } from '@playwright/test';
import type { Project } from '../src/types';

for (const regime of ['subcritical', 'supercritical'] as const) {
  test(`downstream station addition requires supplied bed and preserves the ${regime} boundary contract`, async ({ page, request }) => {
    const project: Project = await (await request.get('/api/sample')).json();
    project.id = `station-addition-${regime}-${crypto.randomUUID()}`;
    project.name = project.id;
    project.scenarios = [];
    project.staged = false;
    if (regime === 'supercritical') {
      project.river = {
        discharge: 20, normal_slope: 0.02, boundary: { regime, depth: 0.55 },
        stations: Array.from({ length: 11 }, (_, i) => ({
          chainage: i * 10, bed_elevation: 10 - i * 0.2, roughness: 0.03,
          section: { kind: 'rectangle', width: 10, bank_height: 8 },
        })),
      };
    }
    expect((await request.post('/api/projects', { data: project })).ok()).toBeTruthy();
    const baselineResponse = await request.post('/api/runs', { data: { project, scenarios: [], staged: false } });
    expect(baselineResponse.ok()).toBeTruthy();
    const baseline = await baselineResponse.json();
    const last = project.river.stations.at(-1)!;
    const added = { ...structuredClone(last),
      chainage: last.chainage + (regime === 'subcritical' ? 100 : 10),
      bed_elevation: regime === 'subcritical' ? 8.9 : 7.8,
      roughness: regime === 'subcritical' ? 0.032 : 0.025,
    };
    await page.goto('/');
    await page.getByLabel('保存済みプロジェクト').selectOption(project.id);
    await page.getByRole('button', { name: '横断面エディタ', exact: true }).click();
    const open = page.getByRole('button', { name: '下流に断面を追加', exact: true });
    const proposal = page.getByRole('region', { name: '下流断面の追加候補', exact: true });
    const apply = page.getByRole('button', { name: '確認して下流断面を追加', exact: true });
    const bed = page.getByLabel('追加断面の河床標高 (m / 共通基準高)', { exact: true });
    const chainage = page.getByLabel('追加断面の縦断距離 (m)', { exact: true });
    const roughness = page.getByLabel('追加断面の粗度係数 n', { exact: true });
    await open.click();
    await expect(bed).toHaveValue('');
    await expect(apply).toBeDisabled();
    await expect(proposal).toContainText('河床標高は推定しません');
    await expect(proposal).toContainText('実測値を生成したものではありません');
    await expect(proposal).toContainText(project.reference.vertical_datum);
    await expect(page.locator('.station-list .station')).toHaveCount(11);
    await bed.fill(String(added.bed_elevation));
    await chainage.fill(String(last.chainage));
    await expect(apply).toBeDisabled();
    await chainage.fill(String(added.chainage));
    await roughness.fill('0.5');
    await expect(apply).toBeDisabled();
    await roughness.fill('');
    await expect(apply).toBeDisabled();
    await roughness.fill(String(added.roughness));
    await expect(apply).toBeEnabled();
    await expect(proposal.getByRole('status')).toContainText(regime === 'subcritical'
      ? '常流・下流端が追加断面に変わります' : '射流・上流端を保持します');
    await expect(proposal.getByRole('status')).toContainText(regime === 'subcritical' ? '追加後 12.1 m' : '追加後 10.55 m');
    await page.screenshot({ path: `../../.local/station-addition-${regime}-20261012.png`, fullPage: true });
    // Even explicit save during review saves only the original working geometry.
    await page.getByRole('button', { name: 'プロジェクトを保存', exact: true }).click();
    await expect(page.getByText('プロジェクトを SQLite に保存しました')).toBeVisible();
    expect(await (await request.get(`/api/projects/${project.id}`)).json()).toEqual(project);
    expect((await (await request.get(`/api/projects/${project.id}/runs`)).json()).items).toHaveLength(1);
    await page.getByRole('button', { name: '下流断面の追加を取消', exact: true }).click();
    await expect(proposal).toHaveCount(0);
    await expect(page.locator('.station-list .station')).toHaveCount(11);
    if (regime === 'subcritical') {
      // Editing any original conditions invalidates the pending addition.
      await open.click();
      await page.getByLabel('粗度係数 n', { exact: true }).fill('0.031');
      await expect(proposal).toHaveCount(0);
      await page.getByLabel('粗度係数 n', { exact: true }).fill('0.03');
      await page.getByLabel('断面形状の変更を全測点に反映', { exact: true }).check();
    }
    await open.click();
    await expect(bed).toHaveValue('');
    await bed.fill(String(added.bed_elevation));
    await chainage.fill(String(added.chainage));
    await roughness.fill(String(added.roughness));
    await apply.click();
    await expect(proposal).toHaveCount(0);
    await expect(page.locator('.station-list .station')).toHaveCount(12);
    await expect(page.getByLabel('断面形状の変更を全測点に反映', { exact: true })).not.toBeChecked();
    await expect(page.getByLabel('河床標高 (m / 共通基準高)', { exact: true })).toHaveValue(String(added.bed_elevation));
    // Application edits the working model; saving is still explicit.
    expect(await (await request.get(`/api/projects/${project.id}`)).json()).toEqual(project);
    await page.getByRole('button', { name: 'プロジェクトを保存', exact: true }).click();
    await expect(page.getByText('プロジェクトを SQLite に保存しました')).toBeVisible();
    const saved: Project = await (await request.get(`/api/projects/${project.id}`)).json();
    expect(saved.river.stations).toEqual([...project.river.stations, added]);
    expect(saved.river.boundary).toEqual(project.river.boundary);
    expect(saved.river.discharge).toBe(project.river.discharge);
    expect(saved.river.normal_slope).toBe(project.river.normal_slope);
    await page.getByRole('button', { name: '水理計算', exact: true }).click();
    const calculated = page.waitForResponse(r => r.url().endsWith('/api/runs') && r.request().method() === 'POST');
    await page.getByRole('button', { name: '計算を実行', exact: true }).click();
    const response = await calculated;
    expect(response.ok()).toBeTruthy();
    const run = await response.json();
    const rows = run.analysis.run.profile.rows;
    expect(rows).toHaveLength(12);
    expect(rows[regime === 'subcritical' ? 11 : 0].water_elevation).toBeCloseTo(regime === 'subcritical' ? 12.1 : 10.55, 8);
    expect(rows.every((r: { froude: number }) => regime === 'subcritical' ? r.froude < 0.98 : r.froude > 1.02)).toBe(true);
    expect(await (await request.get(`/api/runs/${baseline.id}`)).json()).toEqual(baseline);
    await page.reload();
    await page.getByLabel('保存済みプロジェクト').selectOption(project.id);
    expect(await (await request.get(`/api/projects/${project.id}`)).json()).toEqual(saved);
  });
}
