import { test, expect } from '@playwright/test';
import type { Project } from '../src/types';

for (const regime of ['subcritical', 'supercritical'] as const) {
  for (const index of [0, 5, 10]) {
    test(`station deletion reviews ${regime} index ${index} and preserves remaining conditions`, async ({ page, request }) => {
      const project: Project = await (await request.get('/api/sample')).json();
      project.id = `station-delete-${regime}-${index}-${crypto.randomUUID()}`;
      project.name = project.id;
      project.staged = false;
      if (regime === 'supercritical') {
        project.river = {
          discharge: 20, normal_slope: 0.02, boundary: { regime, depth: 0.55 },
          stations: Array.from({ length: 11 }, (_, i) => ({
            chainage: i * 10, bed_elevation: 10 - i * 0.2, roughness: 0.03,
            section: { kind: 'rectangle', width: 10, bank_height: 8 },
          })),
        };
        project.scenarios = [{ name: '合成の粗度比較', modification: { kind: 'roughness', value: 0.025 } }];
      }
      expect((await request.post('/api/projects', { data: project })).ok()).toBeTruthy();
      const baselineResponse = await request.post('/api/runs', { data: { project, scenarios: project.scenarios, staged: false } });
      expect(baselineResponse.ok()).toBeTruthy();
      const baseline = await baselineResponse.json();
      const remaining = project.river.stations.filter((_, i) => i !== index);
      const expectedStage = remaining[regime === 'subcritical' ? 9 : 0].bed_elevation + project.river.boundary.depth;
      await page.goto('/');
      await page.getByLabel('保存済みプロジェクト').selectOption(project.id);
      await page.getByRole('button', { name: '横断面エディタ', exact: true }).click();
      const select = (i: number) => page.getByRole('button', { name: new RegExp(`No\\.${String(i + 1).padStart(2, '0')}`) }).click();
      await select(index);
      await page.getByLabel('断面形状の変更を全測点に反映', { exact: true }).check();
      const open = page.getByRole('button', { name: '選択断面を削除', exact: true });
      const proposal = page.getByRole('region', { name: '断面削除の確認', exact: true });
      const confirm = page.getByRole('button', { name: '確認して断面を削除', exact: true });
      await open.click();
      await expect(proposal).toContainText('11 → 10');
      await expect(proposal).toContainText(project.reference.vertical_datum);
      if (index === 5) await expect(proposal).toContainText(regime === 'subcritical'
        ? '接続後の区間: 400 m → 600 m、間隔 200 m'
        : '接続後の区間: 40 m → 60 m、間隔 20 m');
      const changed = regime === 'subcritical' ? index === 10 : index === 0;
      await expect(proposal.getByRole('status')).toContainText(changed ? '変更します' : '保持します');
      await expect(proposal.getByRole('status')).toContainText(`削除後 ${Number(expectedStage.toFixed(8))} m`);
      await expect(page.locator('.station-list .station')).toHaveCount(11);
      await page.getByRole('button', { name: 'プロジェクトを保存', exact: true }).click();
      await expect(page.getByText('プロジェクトを SQLite に保存しました')).toBeVisible();
      expect(await (await request.get(`/api/projects/${project.id}`)).json()).toEqual(project);
      expect((await (await request.get(`/api/projects/${project.id}/runs`)).json()).items).toHaveLength(1);
      await page.getByRole('button', { name: '断面削除を取消', exact: true }).click();
      await expect(proposal).toHaveCount(0);
      // Selection changes discard the old proposal, including returning to its index.
      await open.click();
      await select(index === 0 ? 1 : 9);
      await expect(proposal).toHaveCount(0);
      await select(index);
      await expect(proposal).toHaveCount(0);
      await open.click();
      await page.getByRole('button', { name: '下流に断面を追加', exact: true }).click();
      await expect(proposal).toHaveCount(0);
      await expect(page.getByRole('region', { name: '下流断面の追加候補', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '下流断面の追加を取消', exact: true }).click();
      await open.click();
      if (regime === 'subcritical' && index === 10) {
        await page.screenshot({ path: '../../.local/station-deletion-downstream-20261012.png', fullPage: true });
      }
      await confirm.click();
      await expect(proposal).toHaveCount(0);
      await expect(page.locator('.station-list .station')).toHaveCount(10);
      await expect(page.getByLabel('断面形状の変更を全測点に反映', { exact: true })).not.toBeChecked();
      expect(await (await request.get(`/api/projects/${project.id}`)).json()).toEqual(project);
      await page.getByRole('button', { name: 'プロジェクトを保存', exact: true }).click();
      await expect(page.getByText('プロジェクトを SQLite に保存しました')).toBeVisible();
      const saved: Project = await (await request.get(`/api/projects/${project.id}`)).json();
      expect(saved).toEqual({ ...project, river: { ...project.river, stations: remaining } });
      await page.getByRole('button', { name: '計算を実行', exact: true }).click();
      await expect(page.getByText('数値計算と施工比較が完了しました')).toBeVisible();
      const history = await (await request.get(`/api/projects/${project.id}/runs`)).json();
      expect(history.items).toHaveLength(2);
      const run = await (await request.get(`/api/runs/${history.items[0].id}`)).json();
      expect(run.analysis.project).toEqual(saved);
      const rows = run.analysis.run.profile.rows;
      expect(rows.map((r: { chainage: number }) => r.chainage)).toEqual(remaining.map(s => s.chainage));
      expect(rows[regime === 'subcritical' ? 9 : 0].water_elevation).toBeCloseTo(expectedStage, 8);
      expect(rows.every((r: { froude: number }) => regime === 'subcritical' ? r.froude < 0.98 : r.froude > 1.02)).toBe(true);
      expect(run.analysis.comparisons).toHaveLength(1);
      if (regime === 'subcritical') expect(run.analysis.comparisons[0].cut_volume).toBeCloseTo(index === 5 ? 32000 : 28800, 6);
      expect(run.analysis.comparisons[0].profile.rows[regime === 'subcritical' ? 9 : 0].water_elevation).toBeCloseTo(expectedStage, 8);
      expect(await (await request.get(`/api/runs/${baseline.id}`)).json()).toEqual(baseline);
      await page.reload();
      await page.getByLabel('保存済みプロジェクト').selectOption(project.id);
      expect(await (await request.get(`/api/projects/${project.id}`)).json()).toEqual(saved);
    });
  }
}

test('station deletion discards stale drafts at a reused survey index and enforces minimum two sections', async ({ page, request }) => {
  const project: Project = await (await request.get('/api/sample')).json();
  project.id = `station-delete-survey-${crypto.randomUUID()}`;
  project.name = project.id;
  project.scenarios = [];
  project.river.stations = project.river.stations.slice(0, 3).map((s, i) => ({
    ...s, section: { kind: 'survey', points: [{ x: -22, z: 8 }, { x: -10, z: 0 }, { x: 10, z: 0 }, { x: 22 + i, z: 8 }] },
  }));
  expect((await request.post('/api/projects', { data: project })).ok()).toBeTruthy();
  await page.goto('/');
  await page.getByLabel('保存済みプロジェクト').selectOption(project.id);
  await page.getByRole('button', { name: '横断面エディタ', exact: true }).click();
  await page.getByRole('button', { name: /No\.02/ }).click();
  await page.getByRole('button', { name: '選択断面を削除', exact: true }).click();
  const proposal = page.getByRole('region', { name: '断面削除の確認', exact: true });
  await expect(proposal).toContainText('接続後の区間: 0 m → 200 m、間隔 200 m');
  await expect(proposal.getByRole('status')).toContainText('保持します');
  // Editing original data invalidates this proposal.
  await page.getByLabel('粗度係数 n', { exact: true }).fill('0.031');
  await expect(proposal).toHaveCount(0);
  await page.getByLabel('粗度係数 n', { exact: true }).fill('0.03');
  await page.getByRole('button', { name: /No\.01/ }).click();
  await page.getByLabel('測量点', { exact: true }).fill('-100,8\n-10,0\n10,0\n100,8');
  await page.getByRole('button', { name: '選択断面を削除', exact: true }).click();
  await page.getByRole('button', { name: '確認して断面を削除', exact: true }).click();
  await expect(page.getByLabel('測量点', { exact: true })).toHaveValue('-22, 8\n-10, 0\n10, 0\n23, 8');
  await expect(page.getByRole('button', { name: '選択断面を削除', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'プロジェクトを保存', exact: true }).click();
  await expect(page.getByText('プロジェクトを SQLite に保存しました')).toBeVisible();
  const saved: Project = await (await request.get(`/api/projects/${project.id}`)).json();
  expect(saved.river.stations).toEqual(project.river.stations.slice(1));
});
