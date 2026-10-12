import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

test('stored trial pack downloads exact evidence, works offline and rejects a changed-baseline study', async ({ page, request }) => {
  const project = await (await request.get('/api/sample')).json();
  project.id = `review-${crypto.randomUUID()}`; project.name = project.id;
  expect((await request.post('/api/projects', { data: project })).ok()).toBeTruthy();
  const run = await (await request.post('/api/runs', { data: { project, scenarios: [{ name:'河道掘削1m', modification:{kind:'excavate',depth:1} }], staged:false } })).json();
  const sensitivity = await (await request.post('/api/sensitivity/runs', { data: { project, cases:[{parameter:'discharge',value:120},{parameter:'discharge',value:10000}] } })).json();
  const resolution = await (await request.post('/api/resolution/runs', { data:{project,confirmed_interpolation:true} })).json();
  const changed = structuredClone(project); changed.river.discharge = 110;
  const mismatched = await (await request.post('/api/sensitivity/runs', { data:{project:changed,cases:[{parameter:'discharge',value:120}]} })).json();
  await page.goto('/');
  await page.getByLabel('保存済みプロジェクト').selectOption(project.id);
  await page.getByLabel(`計算履歴 #${run.id} を開く`).click();
  const panel = page.getByRole('region', { name:'試行記録パック' });
  await panel.getByLabel('感度比較の収録履歴').selectOption(String(sensitivity.id));
  await panel.getByLabel('測点間隔比較の収録履歴').selectOption(String(resolution.id));
  const calculations: string[] = [];
  page.on('request', r => { if (r.method()==='POST' && /\/api\/(simulate|compare|runs|sensitivity\/runs|resolution\/runs)$/.test(r.url())) calculations.push(r.url()); });
  const previewResponse = page.waitForResponse(r=>r.url().endsWith('/api/review-packs/preview'));
  await panel.getByRole('button',{name:'記録パックの内容を確認'}).click();
  const preview = await (await previewResponse).json();
  await expect(panel).toContainText('3 種類の保存履歴');
  await expect(panel).toContainText('13 ファイル');
  const pending = page.waitForEvent('download');
  await panel.getByRole('button',{name:'記録パックZIPを保存'}).click();
  const path = (await (await pending).path())!;
  // Independent standard-library reader verifies file CRCs, manifest hashes and failed CSV cells.
  const decoded = JSON.parse(execFileSync('/usr/bin/python3',['-c',`
import zipfile,hashlib,json,csv,io,sys
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 manifest=json.loads(z.read('manifest.json'))
 for f in manifest['files']:
  content=z.read(f['path']);assert len(content)==f['bytes'];assert hashlib.sha256(content).hexdigest()==f['sha256']
 assert hashlib.sha256(z.read('conditions.json')).hexdigest()==manifest['conditions_sha256']
 rows=list(csv.DictReader(io.StringIO(z.read('sensitivity.csv').decode('utf-8-sig'))))
 failed=[r for r in rows if r['status']=='failed'];assert len(failed)==1
 assert all(failed[0][field]=='' for field in ['water_elevation_m','depth_m','velocity_m_s','executed_at'])
 print(json.dumps({'manifest':manifest,'construction':json.loads(z.read('construction.json')),'sensitivity':json.loads(z.read('sensitivity.json')),'resolution':json.loads(z.read('resolution.json')),'index_html':z.read('index.html').decode(),'construction_html':z.read('construction.html').decode()}))
`,path],{encoding:'utf8',maxBuffer:16*1024*1024}));
  expect(decoded.manifest.files).toEqual(preview.files);
  expect(decoded.construction).toEqual(run); expect(decoded.sensitivity).toEqual(sensitivity); expect(decoded.resolution).toEqual(resolution);
  expect(calculations).toEqual([]);
  await panel.getByLabel('感度比較の収録履歴').selectOption(String(mismatched.id));
  await expect(panel.getByRole('button',{name:'記録パックZIPを保存'})).toHaveCount(0);
  await panel.getByRole('button',{name:'記録パックの内容を確認'}).click();
  await expect(panel.getByRole('alert')).toContainText('一致しません');
  expect((await (await request.get(`/api/projects/${project.id}/runs`)).json()).items).toHaveLength(1);
  expect(await (await request.get(`/api/runs/${run.id}`)).json()).toEqual(run);
  expect(await (await request.get(`/api/projects/${project.id}`)).json()).toEqual(project);
  const origin = new URL(page.url()).origin;
  await page.route('**/api/**', route=>route.abort());
  await page.route('**/offline-review/*.html', route=>route.fulfill({contentType:'text/html',body:route.request().url().endsWith('/index.html')?decoded.index_html:decoded.construction_html}));
  await page.goto(`${origin}/offline-review/index.html`);
  await expect(page.getByRole('heading',{name:'河川の試行記録パック'})).toBeVisible();
  await page.getByRole('link',{name:'図付きHTML'}).first().click();
  await expect(page.locator('svg').first()).toBeVisible();
  await expect(page.locator('body')).toContainText(run.analysis.run.executed_at);
});
