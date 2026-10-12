import { test, expect } from '@playwright/test';
import type { Project } from '../src/types';

for (const regime of ['subcritical', 'supercritical'] as const) {
  test(`CSV review discloses inherited boundary and replaced roughness for ${regime}`, async ({ page, request }) => {
    const project: Project = await (await request.get('/api/sample')).json();
    project.id = `import-conditions-${regime}-${crypto.randomUUID()}`;
    project.name = project.id;
    project.reference.vertical_datum = '合成A基準高';
    if (regime === 'supercritical') {
      project.river = {
        discharge: 20, normal_slope: 0.02,
        boundary: { regime, depth: 0.55 },
        stations: Array.from({ length: 11 }, (_, i) => ({
          chainage: i * 10, bed_elevation: 10 - i * 0.2, roughness: 0.03,
          section: { kind: 'rectangle', width: 10, bank_height: 8 },
        })),
      };
    } else {
      project.river.stations.forEach(s => { s.roughness = 0.04; });
    }
    expect((await request.post('/api/projects', { data: project })).ok()).toBeTruthy();
    const baselineResponse = await request.post('/api/runs', { data: { project, scenarios: [], staged: false } });
    expect(baselineResponse.ok()).toBeTruthy();
    const baseline = await baselineResponse.json();
    const shift = regime === 'subcritical' ? 20 : 100;
    const expected = project.river.stations.map((s, i) => ({
      ...s, bed_elevation: s.bed_elevation + shift, roughness: 0.024 + i * 0.0002,
      section: { kind: 'survey' as const, points: regime === 'subcritical'
        ? [{ x: -22, z: 8 }, { x: -10, z: 0 }, { x: 10, z: 0 }, { x: 22, z: 8 }]
        : [{ x: -6.6, z: 8 }, { x: -5, z: 0 }, { x: 5, z: 0 }, { x: 6.6, z: 8 }],
      },
    }));
    const csv = 'station,chainage_m,bed_elevation_m,roughness,x_m,elevation_m\n' +
      expected.flatMap((s, i) => s.section.points.map(p =>
        `S${i},${s.chainage},${s.bed_elevation},${s.roughness},${p.x},${p.z}`,
      )).join('\n');
    await page.goto('/');
    await page.getByLabel('保存済みプロジェクト').selectOption(project.id);
    // Unsaved scenario edits are part of the current working conditions.
    await page.getByRole('button', { name: '施工シナリオ比較', exact: true }).click();
    await page.getByRole('button', { name: '案を追加', exact: true }).click();
    await page.getByRole('checkbox', { name: '施工段階として順に累積する（オフ: 独立した代替案）', exact: true }).check();
    await page.getByRole('button', { name: '横断面エディタ', exact: true }).click();
    await page.getByLabel('横断測量CSV', { exact: true }).setInputFiles({ name: 'synthetic-conditions.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.getByLabel('取込みデータの標高系').fill('合成B基準高');
    await page.getByLabel('CSVの高さの解釈', { exact: true }).selectOption('relative');
    await page.getByRole('button', { name: 'CSVを検証・プレビュー', exact: true }).click();
    const review = page.getByRole('region', { name: '取込み条件の確認', exact: true });
    const table = review.getByRole('table', { name: 'CSV取込みの条件変更', exact: true });
    const row = (label: string) => table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: label, exact: true }) });
    await expect(row('粗度係数 n（範囲）')).toContainText(regime === 'subcritical' ? '0.04' : '0.03');
    await expect(row('粗度係数 n（範囲）')).toContainText('0.024〜0.026');
    await expect(row('粗度係数 n（範囲）')).toContainText('各測点のCSV値で置換');
    const index = regime === 'subcritical' ? 10 : 0;
    const stage = project.river.stations[index].bed_elevation + project.river.boundary.depth;
    await expect(row('境界水位 (m / 各標高系)').getByRole('cell').nth(0)).toHaveText(String(stage));
    await expect(row('境界水位 (m / 各標高系)').getByRole('cell').nth(1)).toHaveText(String(stage + shift));
    await expect(row('境界流況')).toContainText(regime === 'subcritical' ? '常流・下流端' : '射流・上流端');
    await expect(row('標高系')).toContainText('合成A基準高');
    await expect(row('標高系')).toContainText('合成B基準高');
    await expect(row('施工案').getByRole('cell').nth(0)).toHaveText('2');
    await expect(row('施工案').getByRole('cell').nth(1)).toHaveText('0');
    await expect(review.getByRole('status')).toContainText('取込み前後の水位差は算定しません');
    expect(await (await request.get(`/api/projects/${project.id}`)).json()).toEqual(project);
    expect((await (await request.get(`/api/projects/${project.id}/runs`)).json()).items).toHaveLength(1);
    // The condition review uses the current datum, not a stale copy made at CSV preview.
    await page.getByLabel('プロジェクトの標高系', { exact: true }).fill('合成B基準高');
    await expect(review.getByRole('status')).toContainText('原資料の標高基準の一致は自動検証していません');
    await page.getByLabel('プロジェクトの標高系', { exact: true }).fill('合成A基準高');
    await page.screenshot({ path: `../../.local/import-conditions-${regime}-20261012.png`, fullPage: true });
    if (regime === 'subcritical') {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await page.getByRole('button', { name: '内容を確認して全測点を置換・施工案をクリア', exact: true }).click();
    await page.getByRole('button', { name: 'プロジェクトを保存', exact: true }).click();
    await expect(page.getByText('プロジェクトを SQLite に保存しました')).toBeVisible();
    const saved: Project = await (await request.get(`/api/projects/${project.id}`)).json();
    expect(saved.river.stations).toEqual(expected);
    expect(saved.river.boundary).toEqual(project.river.boundary);
    expect(saved.river.discharge).toBe(project.river.discharge);
    expect(saved.river.normal_slope).toBe(project.river.normal_slope);
    expect(saved.scenarios).toEqual([]);
    expect(saved.staged).toBe(false);
    expect(saved.reference.vertical_datum).toBe('合成B基準高');
    const calculated = page.waitForResponse(r => r.url().endsWith('/api/runs') && r.request().method() === 'POST');
    await page.getByRole('button', { name: '計算を実行', exact: true }).click();
    const response = await calculated;
    expect(response.ok()).toBeTruthy();
    const run = await response.json();
    expect(run.analysis.project.river.stations).toEqual(expected);
    expect(run.analysis.run.profile.rows[index].water_elevation).toBeCloseTo(stage + shift, 8);
    expect(run.analysis.run.profile.rows.every((r: { froude: number }) => regime === 'subcritical' ? r.froude < 0.98 : r.froude > 1.02)).toBe(true);
    expect(await (await request.get(`/api/runs/${baseline.id}`)).json()).toEqual(baseline);
    await page.reload();
    await page.getByLabel('保存済みプロジェクト').selectOption(project.id);
    expect(await (await request.get(`/api/projects/${project.id}`)).json()).toEqual(saved);
  });
}
