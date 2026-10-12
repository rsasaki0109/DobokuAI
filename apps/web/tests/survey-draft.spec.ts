import { test, expect } from '@playwright/test';
import type { Project, Section } from '../src/types';

const shape = (bankX: number): Section => ({
  kind: 'survey',
  points: [{ x: -bankX, z: 8 }, { x: -10, z: 0 }, { x: 10, z: 0 }, { x: bankX, z: 8 }],
});
const text = (section: Section) => section.kind === 'survey'
  ? section.points.map(p => `${p.x}, ${p.z}`).join('\n') : '';

test('same-count survey import discards old point draft and errors before save and calculation', async ({ page, request }) => {
  const project: Project = await (await request.get('/api/sample')).json();
  project.id = `survey-draft-import-${crypto.randomUUID()}`;
  project.name = project.id;
  project.scenarios = [];
  project.staged = false;
  project.river.stations.forEach(s => { s.section = shape(22); });
  expect((await request.post('/api/projects', { data: project })).ok()).toBeTruthy();
  const baselineResponse = await request.post('/api/runs', { data: { project, scenarios: [], staged: false } });
  expect(baselineResponse.ok()).toBeTruthy();
  const baseline = await baselineResponse.json();
  await page.goto('/');
  await page.getByLabel('保存済みプロジェクト').selectOption(project.id);
  await page.getByRole('button', { name: '横断面エディタ', exact: true }).click();
  const points = page.getByLabel('測量点', { exact: true });
  const error = page.getByRole('alert').filter({ hasText: '各行に有限値' });
  await points.fill('');
  await page.getByRole('button', { name: '測量点を反映', exact: true }).click();
  await expect(error).toBeVisible();
  await points.fill('-100, 8\n-10, 0\n10, 0\n100, 8');
  // Edits outside the section do not discard a draft for the same geometry.
  await page.getByLabel('粗度係数 n', { exact: true }).fill('0.035');
  await expect(points).toHaveValue('-100, 8\n-10, 0\n10, 0\n100, 8');
  const expected = project.river.stations.map(s => ({ ...s, section: shape(24) }));
  const csv = 'station,chainage_m,bed_elevation_m,roughness,x_m,elevation_m\n' +
    expected.flatMap((s, i) => s.section.kind === 'survey' ? s.section.points.map(p =>
      `S${i},${s.chainage},${s.bed_elevation},${s.roughness},${p.x},${p.z}`,
    ) : []).join('\n');
  await page.getByLabel('横断測量CSV', { exact: true }).setInputFiles({
    name: 'synthetic-same-count.csv', mimeType: 'text/csv', buffer: Buffer.from(csv),
  });
  await page.getByLabel('取込みデータの標高系').fill(project.reference.vertical_datum);
  await page.getByLabel('CSVの高さの解釈', { exact: true }).selectOption('relative');
  await page.getByRole('button', { name: 'CSVを検証・プレビュー', exact: true }).click();
  await expect(page.getByRole('region', { name: '取込み条件の確認', exact: true })).toBeVisible();
  await expect(points).toHaveValue('-100, 8\n-10, 0\n10, 0\n100, 8');
  await page.getByRole('button', { name: '内容を確認して全測点を置換・施工案をクリア', exact: true }).click();
  await expect(points).toHaveValue(text(shape(24)));
  await expect(error).toHaveCount(0);
  expect(await (await request.get(`/api/projects/${project.id}`)).json()).toEqual(project);
  // A subsequent apply must use the imported points, not the previous draft.
  await page.getByRole('button', { name: '測量点を反映', exact: true }).click();
  await page.getByRole('button', { name: 'プロジェクトを保存', exact: true }).click();
  await expect(page.getByText('プロジェクトを SQLite に保存しました')).toBeVisible();
  const saved: Project = await (await request.get(`/api/projects/${project.id}`)).json();
  expect(saved.river.stations).toEqual(expected);
  const calculated = page.waitForResponse(r => r.url().endsWith('/api/runs') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '計算を実行', exact: true }).click();
  const response = await calculated;
  expect(response.ok()).toBeTruthy();
  const run = await response.json();
  expect(run.analysis.project.river.stations).toEqual(expected);
  expect(run.analysis.run.profile.rows).toHaveLength(expected.length);
  expect(run.analysis.run.profile.rows.at(-1).water_elevation).toBeCloseTo(12.2, 8);
  expect(await (await request.get(`/api/runs/${baseline.id}`)).json()).toEqual(baseline);
  await page.reload();
  await page.getByLabel('保存済みプロジェクト').selectOption(project.id);
  await page.getByRole('button', { name: '横断面エディタ', exact: true }).click();
  await expect(points).toHaveValue(text(shape(24)));
});

test('deleting a preceding construction scenario resets the reused survey editor to the remaining shape', async ({ page, request }) => {
  const project: Project = await (await request.get('/api/sample')).json();
  project.id = `survey-draft-scenario-${crypto.randomUUID()}`;
  project.name = project.id;
  project.staged = false;
  project.scenarios = [22, 24].map((bankX, i) => ({
    name: `合成断面案${i + 1}`, modification: { kind: 'replace_section', section: shape(bankX) },
  }));
  expect((await request.post('/api/projects', { data: project })).ok()).toBeTruthy();
  await page.goto('/');
  await page.getByLabel('保存済みプロジェクト').selectOption(project.id);
  await page.getByRole('button', { name: '施工シナリオ比較', exact: true }).click();
  const fields = page.getByLabel('測量点', { exact: true });
  await fields.nth(0).fill('invalid');
  await page.getByRole('button', { name: '測量点を反映', exact: true }).nth(0).click();
  await expect(page.getByRole('alert').filter({ hasText: '各行に有限値' })).toBeVisible();
  await fields.nth(1).fill('-200, 8\n-10, 0\n10, 0\n200, 8');
  await page.getByRole('button', { name: '施工案1を削除', exact: true }).click();
  await expect(fields).toHaveCount(1);
  await expect(fields).toHaveValue(text(shape(24)));
  await expect(page.getByRole('alert').filter({ hasText: '各行に有限値' })).toHaveCount(0);
  await page.getByRole('button', { name: '測量点を反映', exact: true }).click();
  expect(await (await request.get(`/api/projects/${project.id}`)).json()).toEqual(project);
  await page.getByRole('button', { name: 'プロジェクトを保存', exact: true }).click();
  await expect(page.getByText('プロジェクトを SQLite に保存しました')).toBeVisible();
  const saved: Project = await (await request.get(`/api/projects/${project.id}`)).json();
  expect(saved.scenarios).toEqual(project.scenarios!.slice(1));
  expect(saved.river).toEqual(project.river);
  const calculated = page.waitForResponse(r => r.url().endsWith('/api/runs') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '計算を実行', exact: true }).click();
  const response = await calculated;
  expect(response.ok()).toBeTruthy();
  const run = await response.json();
  expect(run.analysis.project.river).toEqual(project.river);
  expect(run.analysis.comparisons).toHaveLength(1);
  expect(run.analysis.comparisons[0].river.stations.map((s: { section: Section }) => s.section))
    .toEqual(project.river.stations.map(() => shape(24)));
});
