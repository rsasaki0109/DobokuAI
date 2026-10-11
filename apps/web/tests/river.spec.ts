import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('sensitivity history retains failed cases and original exports after project edits and reload', async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', {name:'青葉川・河道改修検討'})).toBeVisible();
  await page.getByRole('button',{name:'複製して新規作成',exact:true}).click();
  await page.getByLabel('プロジェクト名',{exact:true}).fill('E2E 感度比較履歴');
  await page.getByRole('button',{name:'プロジェクトを保存',exact:true}).click();
  await expect(page.getByText('プロジェクトを SQLite に保存しました')).toBeVisible();
  await page.getByRole('button',{name:'水理計算',exact:true}).click();
  await page.getByLabel('感度比較の値').fill('80, 100, -1');
  const pending=page.waitForResponse(r=>r.url().endsWith('/api/sensitivity/runs')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'基本条件を保持して感度比較'}).click();
  const response=await pending;expect(response.ok()).toBeTruthy();const saved=await response.json();
  await expect(page.getByText('感度比較完了: 成功 2 / 失敗 1。基本条件は変更していません。')).toBeVisible();
  await page.reload();
  await page.getByLabel('保存済みプロジェクト').selectOption({label:'E2E 感度比較履歴'});
  await page.getByRole('button',{name:'水理計算',exact:true}).click();
  await page.getByLabel('流量 Q (m³/s)').fill('125');
  await page.getByRole('button',{name:`感度履歴 #${saved.id} を開く`,exact:true}).click();
  await expect(page.getByLabel('流量 Q (m³/s)')).toHaveValue('125');
  await expect(page.getByText('感度比較完了: 成功 2 / 失敗 1。基本条件は変更していません。')).toBeVisible();
  const requests:string[]=[];
  page.on('request',r=>{if(r.method()==='POST')requests.push(r.url());});
  for(const kind of ['JSON','CSV','HTML']) {
    const download=page.waitForEvent('download');
    await page.getByRole('button',{name:`感度比較${kind}を保存`,exact:true}).click();
    const text=await readFile((await (await download).path())!,'utf8');
    expect(text).toContain(saved.comparison.baseline.executed_at);
    if(kind==='JSON')expect(JSON.parse(text)).toEqual(saved.comparison);
    if(kind==='CSV'){expect(text).toContain('water_change_m');expect(text).toContain('failed');}
    if(kind==='HTML'){expect(text).toContain('<svg');expect(text).toContain('失敗');}
  }
  expect(requests).toEqual([]);
  await expect(page.locator('.sensitivity-panel .history-item')).toHaveCount(1);
});

test('survey CSV preview, explicit import, sensitivity failures, provenance and saved results', async ({
  page,
}) => {
  const csv = await readFile('../../examples/survey-absolute.csv', 'utf8');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '青葉川・河道改修検討' })).toBeVisible();
  await page.getByRole('button', { name: '複製して新規作成', exact: true }).click();
  await page.getByLabel('プロジェクト名', { exact: true }).fill('E2E 測量取込み');
  await page.getByRole('button', { name: '横断面エディタ', exact: true }).click();
  await page
    .getByLabel('横断測量CSV', { exact: true })
    .setInputFiles({ name: 'survey-absolute.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByLabel('取込みデータの標高系').fill('合成サンプル・仮想基準高');
  await page.getByRole('button', { name: 'CSVを検証・プレビュー', exact: true }).click();
  await expect(
    page.getByText('取込みプレビュー: 11 断面。確認前の条件は変更されていません。'),
  ).toBeVisible();
  await expect(page.getByLabel('断面形式', { exact: true })).toHaveValue('trapezoid');
  await page.getByRole('button', { name: '内容を確認して全測点を置換・施工案をクリア' }).click();
  await expect(page.getByLabel('断面形式', { exact: true })).toHaveValue('survey');
  await expect(page.getByLabel('プロジェクトの標高系')).toHaveValue('合成サンプル・仮想基準高');
  await expect(page.getByText('取込み元: survey-absolute.csv', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '水理計算', exact: true }).click();
  await page.getByLabel('感度比較の値').fill('80, 100, -1');
  await page.getByRole('button', { name: '基本条件を保持して感度比較' }).click();
  await expect(
    page.getByText('感度比較完了: 成功 2 / 失敗 1。基本条件は変更していません。'),
  ).toBeVisible();
  await expect(page.getByLabel('流量 Q (m³/s)')).toHaveValue('100');
  const sensitivityDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '感度比較JSONを保存' }).click();
  const sensitivity = JSON.parse(
    await readFile((await (await sensitivityDownload).path())!, 'utf8'),
  );
  expect(sensitivity.cases[2].status).toBe('failed');
  expect(sensitivity.cases[2].run).toBeUndefined();
  for (const kind of ['CSV','HTML']) {
    const pending=page.waitForEvent('download');
    await page.getByRole('button',{name:`感度比較${kind}を保存`,exact:true}).click();
    const text=await readFile((await (await pending).path())!,'utf8');
    expect(text).toContain(sensitivity.baseline.executed_at);
    expect(text).toContain('survey-absolute.csv');
    expect(text).toContain('合成サンプル・仮想基準高');
  }
  await page.getByRole('button', { name: '計算を実行', exact: true }).click();
  await expect(page.getByText('数値計算と施工比較が完了しました')).toBeVisible();
  await expect(page.locator('.sensitivity-panel tbody tr')).toHaveCount(3);
  await expect(page.locator('tbody tr')).toHaveCount(14);
  for (const button of ['CSV', 'HTML レポート']) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: button, exact: true }).click();
    const text = await readFile((await (await pending).path())!, 'utf8');
    expect(text).toContain('survey-absolute.csv');
    expect(text).toContain('合成サンプル・仮想基準高');
  }
  await page.getByRole('button', { name: 'プロジェクトを保存', exact: true }).click();
  await expect(page.getByText('プロジェクトを SQLite に保存しました')).toBeVisible();
  await page.reload();
  await page.getByLabel('保存済みプロジェクト').selectOption({ label: 'E2E 測量取込み' });
  await page.getByRole('button', { name: '横断面エディタ', exact: true }).click();
  await expect(page.getByLabel('プロジェクトの標高系')).toHaveValue('合成サンプル・仮想基準高');
  await page
    .getByLabel('横断測量CSV', { exact: true })
    .setInputFiles({
      name: 'invalid.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv.replace('-22,18.000', '-22,NaN')),
    });
  await page.getByLabel('取込みデータの標高系').fill('合成サンプル・仮想基準高');
  await page.getByRole('button', { name: 'CSVを検証・プレビュー' }).click();
  await expect(page.getByRole('alert')).toContainText('CSVを反映できません');
  await expect(page.getByText('有限の数値を指定してください', { exact: false })).toBeVisible();
  await expect(
    page.getByRole('button', { name: '内容を確認して全測点を置換・施工案をクリア' }),
  ).toHaveCount(0);
  await expect(page.getByText('取込み元: survey-absolute.csv', { exact: false })).toBeVisible();
});

test('sample → cross-section edit → steady flow → construction comparison → report → persistence', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '青葉川・河道改修検討' })).toBeVisible();
  await expect(page.getByText('32,000 m³', { exact: false })).toBeVisible();
  await page.screenshot({ path: '../../.local/dashboard.png', fullPage: true });
  await page.getByRole('button', { name: '横断面エディタ', exact: true }).click();
  await page.getByLabel('断面形状の変更を全測点に反映').check();
  await page.getByLabel('底幅 (m)', { exact: true }).fill('22');
  await page.getByRole('button', { name: '水理計算', exact: true }).click();
  await page.getByLabel('流量 Q (m³/s)').fill('110');
  await page.getByRole('button', { name: '計算を実行', exact: true }).click();
  await expect(page.getByText('数値計算と施工比較が完了しました')).toBeVisible();
  const rows = page.locator('tbody tr');
  await expect(rows).toHaveCount(11);
  await expect(rows.last()).toContainText('12.200'); // fixed downstream stage 9 + 3.2
  await page.getByRole('button', { name: '施工シナリオ比較', exact: true }).click();
  await page.getByLabel('掘削深 (m)', { exact: true }).fill('0.5');
  const responsePromise = page.waitForResponse(
    (r) => r.url().endsWith('/api/runs') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '計算を実行', exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  const { analysis: data } = await response.json();
  expect(data.comparisons[0].cut_volume).toBeCloseTo(17000, 1);
  expect(data.comparisons[0].max_water_change).toBeLessThan(0);
  expect(data.comparisons[0].profile.rows[10].water_elevation).toBeCloseTo(12.2, 8);
  await expect(page.getByText('掘削 17,000 m³', { exact: false })).toBeVisible();
  await expect(page.locator('.section-chart svg[role="application"]')).toBeVisible();
  await page.screenshot({ path: '../../.local/comparison.png', fullPage: true });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV', exact: true }).click();
  expect((await dl).suggestedFilename()).toBe('doboku-results.csv');
  const html = page.waitForEvent('download');
  await page.getByRole('button', { name: 'HTML レポート', exact: true }).click();
  expect((await html).suggestedFilename()).toBe('doboku-report.html');
  await page.getByRole('button', { name: 'プロジェクト', exact: true }).click();
  await page.getByRole('button', { name: '複製して新規作成', exact: true }).click();
  await page.getByLabel('プロジェクト名', { exact: true }).fill('E2E 検証河川');
  await page.getByRole('button', { name: 'プロジェクトを保存', exact: true }).click();
  await expect(page.getByText('プロジェクトを SQLite に保存しました')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '青葉川・河道改修検討' })).toBeVisible();
  await page.getByLabel('保存済みプロジェクト').selectOption({ label: 'E2E 検証河川' });
  await page.getByRole('button', { name: '水理計算', exact: true }).click();
  await expect(page.getByLabel('流量 Q (m³/s)')).toHaveValue('110');
  await page.getByRole('button', { name: '施工シナリオ比較', exact: true }).click();
  await expect(page.getByLabel('掘削深 (m)', { exact: true })).toHaveValue('0.5');
  expect(errors).toEqual([]);
});

test('agent requires review, creates a comparison and rejects unsupported hydraulic conditions', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '青葉川・河道改修検討' })).toBeVisible();
  await page.getByRole('button', { name: 'AI アシスタント', exact: true }).click();
  await page.getByRole('button', { name: '粗度係数を0.035に変更した場合の水位を比較して' }).click();
  await page.getByRole('button', { name: '操作を提案', exact: true }).click();
  await expect(page.getByText('粗度: 現在の各断面 → 0.035 の比較案を追加')).toBeVisible();
  await expect(
    page.getByText('適用前の条件は変更されていません。', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: '条件を確認して適用・再計算' }).click();
  await expect(page.getByText('確認済みツールを適用し、Rust エンジンで計算しました')).toBeVisible();
  await page.getByRole('button', { name: '施工シナリオ比較', exact: true }).click();
  await expect(page.locator('.scenario-form')).toHaveCount(2);
  await page.getByRole('button', { name: '水理計算', exact: true }).click();
  await page.getByLabel('境界水深 (m / 河床から)').fill('8');
  await page.getByRole('button', { name: '計算を実行', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('越岸');
  await expect(page.locator('tbody tr')).toHaveCount(0);
});

test('saved calculation history restores original conditions, results and report timestamps', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '青葉川・河道改修検討' })).toBeVisible();
  await page.getByRole('button', { name: '複製して新規作成', exact: true }).click();
  await page.getByLabel('プロジェクト名', { exact: true }).fill('E2E 計算履歴');
  await page.getByRole('button', { name: 'プロジェクトを保存', exact: true }).click();
  await expect(page.getByText('プロジェクトを SQLite に保存しました')).toBeVisible();
  const firstResponse = page.waitForResponse(
    (r) => r.url().endsWith('/api/runs') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '計算を実行', exact: true }).click();
  const first = await (await firstResponse).json();
  await expect(page.locator('.history-item')).toHaveCount(1);
  await page.getByRole('button', { name: '水理計算', exact: true }).click();
  await page.getByLabel('流量 Q (m³/s)').fill('120');
  await page.getByRole('button', { name: '施工シナリオ比較', exact: true }).click();
  await page.getByLabel('掘削深 (m)', { exact: true }).fill('0.5');
  await page.getByLabel('施工段階として順に累積する（オフ: 独立した代替案）').check();
  await page.getByRole('button', { name: '計算を実行', exact: true }).click();
  await expect(page.getByText('数値計算と施工比較が完了しました')).toBeVisible();
  await page.reload();
  await page.getByLabel('保存済みプロジェクト').selectOption({ label: 'E2E 計算履歴' });
  await expect(page.locator('.history-item')).toHaveCount(2);
  await page.getByRole('button', { name: `計算履歴 #${first.id} を開く`, exact: true }).click();
  await expect(
    page.getByText(`計算履歴 #${first.id} の条件と保存結果を復元しました（再計算していません）`),
  ).toBeVisible();
  // Every export refers to the original snapshot, not the current wall clock.
  for (const [button, kind] of [
    ['CSV', 'csv'],
    ['HTML レポート', 'html'],
    ['再現用 JSON', 'json'],
  ] as const) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: button, exact: true }).click();
    const saved = await pending;
    const text = await readFile((await saved.path())!, 'utf8');
    expect(text).toContain(first.analysis.run.executed_at);
    if (kind === 'json') expect(JSON.parse(text)).toEqual(first.analysis);
  }
  await page.getByRole('button', { name: '施工シナリオ比較', exact: true }).click();
  await expect(page.getByLabel('掘削深 (m)', { exact: true })).toHaveValue('1');
  await expect(
    page.getByLabel('施工段階として順に累積する（オフ: 独立した代替案）'),
  ).not.toBeChecked();
  await page.getByRole('button', { name: '水理計算', exact: true }).click();
  await expect(page.getByLabel('流量 Q (m³/s)')).toHaveValue('100');
  await expect(page.locator('tbody tr')).toHaveCount(11);
  await page.getByLabel('流量 Q (m³/s)').fill('130');
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(page.getByText('保存結果を開く', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'プロジェクト', exact: true }).click();
  await expect(page.locator('.history-item')).toHaveCount(2);
  await expect(page.getByText('表示中の保存結果', { exact: true })).toHaveCount(0);
});
