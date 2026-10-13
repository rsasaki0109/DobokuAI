import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { terrainSections } from '../src/citySections';
import { citySectionSnapshot } from '../src/citySectionCSV';
import { cityGradingConditions, inspectGradingRun } from '../src/cityGrading';
import type { GradingRun } from '../src/cityGrading';
import { buildCityGradingReport } from '../src/cityGradingReport';
import type { CityModel } from '../src/cityModel';

const footprint = { east: 0, north: 0, width: 40, length: 30, elevation: 100 };
const p = (east: number, north: number) => [east, .1 * east + .2 * north, -north];
const model: CityModel = { crs: 'urn:doboku:crs:local-metre', origin: [0, 0, 100], bounds: { min: [-100, -30, -100], max: [100, 30, 100] },
  lod: 1, polygonCount: 2, features: [{ id: 'plane', layer: 'terrain', triangleCount: 2, positions: [p(-100,-100),p(100,-100),p(100,100),p(-100,-100),p(100,100),p(-100,100)].flat() }] };
const input = { title: '合成平面', model, footprint, sources: [{ name: 'plane.gml', bytes: 25, sha256: 'a'.repeat(64) }],
  inspected_at: '2026-10-13T00:00:00Z', source_url: '', attribution: '合成例', usage_terms: 'テスト用', data_kind: 'synthetic' as const, dataset: null };
const sections = terrainSections(model, footprint), conditions = cityGradingConditions(sections, 100);
function analyticRun(): GradingRun {
  const areas = (axis: 'east_west' | 'south_north', area: number) => ({ complete: true, known_length_m: conditions[axis].length_m,
    uncovered_length_m: 0, ambiguous_length_m: 0, unresolved_point_count: 0, cut_area_m2: area, fill_area_m2: area, known_cut_area_m2: area, known_fill_area_m2: area,
    spans: conditions[axis].spans.map((v, i) => ({ start_m: v.start_m, end_m: v.end_m, cut_area_m2: i === 0 ? 0 : area, fill_area_m2: i === 0 ? area : 0, crossing_distance_m: null })) });
  return { engine_version: '0.2.0', model_version: 'linear-profile-grading-1', executed_at: '2026-10-13T01:00:00Z', conditions: structuredClone(conditions),
    east_west: areas('east_west',20), south_north: areas('south_north',22.5), volume_m3: null };
}
const parseCSV = (csv: string) => JSON.parse(execFileSync('python3', ['-c', 'import csv,io,json,sys; print(json.dumps(list(csv.DictReader(io.StringIO(sys.stdin.read().lstrip("\\ufeff")), strict=True))))'], { input: csv, encoding: 'utf8' }));

test('grading contracts preserve exact unknown spans and points and reject foreign or nonfinite results', () => {
  const before = structuredClone(sections), request = cityGradingConditions(sections, 100);
  expect(request.east_west.spans[0].ground).toEqual({ status: 'unique', start_elevation_m: 98, end_elevation_m: 100 });
  const run = analyticRun(), checked = inspectGradingRun(run, request); checked.east_west.spans[0].cut_area_m2 = 999;
  expect(run.east_west.spans[0].cut_area_m2).toBe(0); expect(sections).toEqual(before);
  const unknown = structuredClone(sections); unknown[0].intervals[0].status = 'uncovered'; unknown[0].points[1].status = 'ambiguous';
  const transformed = cityGradingConditions(unknown, -2);
  expect(transformed.east_west.spans[0].ground).toEqual({ status: 'uncovered' }); expect(transformed.east_west.unresolved_points_m).toEqual([20]);
  for (const value of [NaN,Infinity,12000.1]) expect(() => cityGradingConditions(sections,value)).toThrow('計画標高');
  const foreign = analyticRun(); foreign.conditions.target_elevation_m=99; expect(() => inspectGradingRun(foreign,request)).toThrow('条件');
  const bad = analyticRun(); bad.east_west.cut_area_m2 = NaN; expect(() => inspectGradingRun(bad,request)).toThrow('数値');
  const invented = analyticRun(); (invented as unknown as {volume_m3:number}).volume_m3=200; expect(() => inspectGradingRun(invented,request)).toThrow('版');
  const source = citySectionSnapshot(input, sections, '2026-10-13T00:30:00Z');
  const mismatched = analyticRun(), ground = mismatched.conditions.east_west.spans[0].ground;
  if (ground.status === 'unique') ground.start_elevation_m += 1;
  expect(() => buildCityGradingReport(source,mismatched)).toThrow('条件');
});

test('grading HTML and independent CSV parsing retain conditions and provenance without executing imported text', async ({ page }) => {
  const malicious = '</pre><script>window.gradingInjected=true</script><img src="https://example.invalid/x">';
  const source = citySectionSnapshot({ ...input, title: malicious, attribution: '=1+1', dataset: { note: malicious } },sections,'2026-10-13T00:30:00Z');
  const report = buildCityGradingReport(source,analyticRun()), rows = parseCSV(report.csv);
  expect(rows).toHaveLength(6); expect(rows[0]).toMatchObject({ status: 'complete', cut_area_m2: '20', fill_area_m2: '20', target_elevation_m: '100', attribution: "'=1+1", volume_calculated: 'false' });
  expect(rows.every((r:Record<string,string>) => r.engine_version==='0.2.0' && r.executed_at_utc==='2026-10-13T01:00:00Z' && r.shared_height_tolerance_m==='0.000001')).toBe(true);
  expect(report.snapshot).toMatchObject({ report_type:'city_centerline_grading_areas', numerical_solver_linked:true, numerical_engine:'doboku-earthwork', hydraulic_solver_linked:false, volume_calculated:false, whole_footprint_coverage_verified:false });
  const requests:string[]=[];page.on('request',r=>requests.push(r.url())); await page.setContent(report.html);
  await expect(page.locator('script,img,iframe')).toHaveCount(0); expect(await page.evaluate(()=>'gradingInjected' in window)).toBe(false);
  const saved=JSON.parse((await page.locator('#city-grading-report-snapshot').textContent())!); expect(saved.title).toBe(malicious);
  await expect(page.getByRole('img',{name:'東西の切土・盛土断面',exact:true}).locator('[data-grading-area="cut"]')).toHaveCount(1);
  const href=await page.getByRole('link',{name:'この結果と同じ条件の断面積CSVを保存',exact:true}).getAttribute('href');expect(decodeURIComponent(href!.split(',').slice(1).join(','))).toBe(report.csv);
  expect(requests).toEqual([]);
});

const xml = `<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:gml="http://www.opengis.net/gml" xmlns:dem="http://www.opengis.net/citygml/relief/2.0" srsName="urn:doboku:crs:local-metre" srsDimension="3"><core:cityObjectMember><dem:ReliefFeature gml:id="plane"><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>-100 -100 70 100 -100 90 100 100 130 -100 100 110 -100 -100 70</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></dem:ReliefFeature></core:cityObjectMember></core:CityModel>`;
async function load(page:Page, data=xml) {
  await page.getByLabel('CityGMLファイル',{exact:true}).setInputFiles({name:'plane.gml',mimeType:'application/xml',buffer:Buffer.from(data)});
  await page.getByRole('button',{name:'CityGMLを点検・プレビュー',exact:true}).click();await page.getByRole('button',{name:'確認して都市モデルを表示',exact:true}).click();
  await page.getByRole('button',{name:'確認して施工範囲を表示',exact:true}).click();await page.getByRole('button',{name:'反映済み範囲の地形断面を表示',exact:true}).click();
}
async function download(page:Page,name:string) {
  const event=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();return readFile((await(await event).path())!,'utf8');
}

test('confirmed Rust grading gives analytic separate areas, exports identical charts and leaves river history unchanged', async ({page,request}) => {
  const errors:string[]=[],posts:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')posts.push(new URL(r.url()).pathname);});
  const river=await(await request.get('/api/projects/sample-river')).json(),history=await(await request.get('/api/projects/sample-river/runs')).json();
  await page.goto('/?view=city');await load(page);
  await page.waitForLoadState('networkidle');
  const gradingPosts = () => posts.filter(path => path === '/api/earthwork/linear-grading');
  const initialOtherPosts = posts.filter(path => path !== '/api/earthwork/linear-grading');
  const target=page.getByLabel('断面積計算の計画標高 (m / 原データ基準)',{exact:true}),calc=page.getByRole('button',{name:'条件を確認して断面の切土・盛土を計算',exact:true});
  const result=page.getByRole('region',{name:'切土・盛土の計算結果',exact:true}),save=page.getByRole('button',{name:'切土・盛土の確認資料HTMLを保存',exact:true});
  await expect(save).toBeDisabled();await target.fill('');await expect(calc).toBeDisabled();await target.fill('100');expect(gradingPosts()).toEqual([]);
  await calc.click();await expect(result).toBeVisible();
  await expect(result.locator('[data-grading-summary="east_west"] td').first()).toHaveText('20 / 20');
  await expect(result.locator('[data-grading-summary="south_north"] td').first()).toHaveText('22.5 / 22.5');
  await page.getByLabel('施工範囲の幅 (m)',{exact:true}).fill('55');await expect(save).toBeEnabled();
  const html=await download(page,'切土・盛土の確認資料HTMLを保存'),json=JSON.parse(await download(page,'切土・盛土の計算JSONを保存')),csv=await download(page,'切土・盛土の断面積CSVを保存');
  expect(json.footprint.width).toBe(40);expect(json.grading.conditions.target_elevation_m).toBe(100);expect(json.grading.volume_m3).toBeNull();expect(parseCSV(csv)[0].cut_area_m2).toBe('20');
  const report=await page.context().newPage();await report.route('**/*',r=>r.abort());await report.setContent(html);
  const stored=JSON.parse((await report.locator('#city-grading-report-snapshot').textContent())!);expect(stored).toEqual(json);
  for(const axis of ['東西','南北']) expect(await report.getByRole('img',{name:`${axis}の切土・盛土断面`,exact:true}).innerHTML()).toBe(await result.getByRole('img',{name:`${axis}の切土・盛土断面`,exact:true}).innerHTML());
  await report.close();
  await target.fill('99');await expect(result).toHaveCount(0);await expect(save).toBeDisabled();expect(gradingPosts()).toHaveLength(1);
  await calc.click();await expect(result.locator('[data-grading-summary="east_west"] td').first()).toHaveText('45 / 5');
  await page.getByRole('button',{name:'確認して施工範囲を表示',exact:true}).click();await expect(result).toHaveCount(0);await expect(save).toHaveCount(0);
  await page.getByRole('button',{name:'反映済み範囲の地形断面を表示',exact:true}).click();await expect(save).toBeDisabled();await expect(target).toHaveValue('100');
  expect(await(await request.get('/api/projects/sample-river')).json()).toEqual(river);expect(await(await request.get('/api/projects/sample-river/runs')).json()).toEqual(history);
  expect(gradingPosts()).toEqual(['/api/earthwork/linear-grading','/api/earthwork/linear-grading']);
  expect(posts.filter(path => path !== '/api/earthwork/linear-grading')).toEqual(initialOtherPosts);expect(errors).toEqual([]);
});

test('overlapping and absent ground return uncomputed totals and blank interval areas instead of zero totals',async({page})=>{
  await page.goto('/?view=city');
  const member=xml.match(/<core:cityObjectMember>[\s\S]*<\/core:cityObjectMember>/)![0];
  const raised=member.replace('gml:id="plane"','gml:id="raised"').replace('70 100 -100 90 100 100 130 -100 100 110 -100 -100 70','80 100 -100 100 100 100 140 -100 100 120 -100 -100 80');
  const absent=xml.replace('srsName=','xmlns:bldg="http://www.opengis.net/citygml/building/2.0" srsName=').replaceAll('dem:ReliefFeature','bldg:Building');
  for(const [data,status]of [[xml.replace('</core:CityModel>',`${raised}</core:CityModel>`),'ambiguous'],[absent,'uncovered']]as const){
    await load(page,data);await page.getByRole('button',{name:'条件を確認して断面の切土・盛土を計算',exact:true}).click();
    const result=page.getByRole('region',{name:'切土・盛土の計算結果',exact:true});await expect(result.locator('[data-grading-summary="east_west"] td').first()).toHaveText('未算定');
    const saved=JSON.parse(await download(page,'切土・盛土の計算JSONを保存')),q=saved.grading.east_west;
    expect(q.cut_area_m2).toBeNull();expect(q.fill_area_m2).toBeNull();expect(q.known_cut_area_m2).toBe(0);expect(q[`${status==='ambiguous'?'ambiguous':'uncovered'}_length_m`]).toBe(40);
    const rows=parseCSV(await download(page,'切土・盛土の断面積CSVを保存'));expect(rows.every((r:Record<string,string>)=>r.cut_area_m2===''&&r.fill_area_m2==='')).toBe(true);
    await expect(result.locator('[data-grading-area]')).toHaveCount(0);await expect(result.locator('[data-terrain-line]')).toHaveCount(0);
  }
});

test('editing, cancellation, failed API and model replacement cannot revive a delayed grading result',async({page})=>{
  await page.goto('/?view=city');await load(page);
  let release:()=>void=()=>{},arrived:()=>void=()=>{};
  let waiting=new Promise<void>(resolve=>{arrived=resolve;});let delayed=new Promise<void>(resolve=>{release=resolve;});let fail=false;
  await page.route('**/api/earthwork/linear-grading',async route=>{
    if(fail){await route.fulfill({status:503,json:{error:'試験用API停止'}});return;}
    const response=await route.fetch();arrived();await delayed;
    try{await route.fulfill({response});}catch{/* cancelled request */}
  });
  const target=page.getByLabel('断面積計算の計画標高 (m / 原データ基準)',{exact:true}),calc=page.getByRole('button',{name:'条件を確認して断面の切土・盛土を計算',exact:true}),result=page.getByRole('region',{name:'切土・盛土の計算結果',exact:true});
  await calc.click();await waiting;await target.fill('99');release();await expect(result).toHaveCount(0);
  fail=true;await calc.click();await expect(page.getByRole('alert')).toContainText('試験用API停止');await expect(result).toHaveCount(0);
  fail=false;waiting=new Promise(resolve=>{arrived=resolve;});delayed=new Promise(resolve=>{release=resolve;});
  await calc.click();await waiting;await page.getByRole('button',{name:'断面積の計算を取消',exact:true}).click();release();await expect(calc).toBeEnabled();await expect(result).toHaveCount(0);
  waiting=new Promise(resolve=>{arrived=resolve;});delayed=new Promise(resolve=>{release=resolve;});
  await calc.click();await waiting;await page.getByRole('button',{name:'合成都市デモを表示',exact:true}).click();release();await expect(result).toHaveCount(0);
  await page.getByRole('button',{name:'確認して施工範囲を表示',exact:true}).click();await page.getByRole('button',{name:'反映済み範囲の地形断面を表示',exact:true}).click();
  await expect(page.getByRole('button',{name:'切土・盛土の計算JSONを保存',exact:true})).toBeDisabled();
});

test('public Yokohama grading preserves negative source heights and licensed provenance and agrees with independent quadrature',async({page})=>{
  await page.goto('/?view=city');
  await page.getByLabel('施工範囲の幅 (m)',{exact:true}).fill('200');await page.getByLabel('施工範囲の長さ (m)',{exact:true}).fill('200');
  await page.getByRole('button',{name:'確認して施工範囲を表示',exact:true}).click();await page.getByRole('button',{name:'反映済み範囲の地形断面を表示',exact:true}).click();
  await page.getByLabel('断面積計算の計画標高 (m / 原データ基準)',{exact:true}).fill('0');await page.getByRole('button',{name:'条件を確認して断面の切土・盛土を計算',exact:true}).click();
  await expect(page.getByRole('region',{name:'切土・盛土の計算結果',exact:true})).toBeVisible();
  const snapshot=JSON.parse(await download(page,'切土・盛土の計算JSONを保存'));
  expect(snapshot.data_kind).toBe('public_city_model');expect(snapshot.dataset.license).toBe('CC BY 4.0');expect(snapshot.attribution).toContain('国土交通省');
  expect(snapshot.terrain_sections.sections.some((s:{points:{elevations:number[]}[]})=>s.points.some(p=>p.elevations.some(h=>h<0)))).toBe(true);
  expect(snapshot.sources).toHaveLength(2);expect(snapshot.grading.volume_m3).toBeNull();
  const reference=JSON.parse(execFileSync('python3',['-c',`import json,math,sys
d=json.load(sys.stdin);result={};n=65536
for axis in ['east_west','south_north']:
 p=d['grading']['conditions'][axis];target=d['grading']['conditions']['target_elevation_m'];cuts=[];fills=[]
 for s in p['spans']:
  if s['ground']['status']!='unique':continue
  a=s['ground']['start_elevation_m'];b=s['ground']['end_elevation_m'];dx=s['end_m']-s['start_m']
  cuts.append(dx/n*math.fsum(max(0,a+(b-a)*(i+.5)/n-target) for i in range(n)))
  fills.append(dx/n*math.fsum(max(0,target-a-(b-a)*(i+.5)/n) for i in range(n)))
 result[axis]=[math.fsum(cuts),math.fsum(fills)]
print(json.dumps(result))`],{input:JSON.stringify(snapshot),encoding:'utf8'}));
  for(const axis of ['east_west','south_north']){
    expect(Math.abs(snapshot.grading[axis].known_cut_area_m2-reference[axis][0])).toBeLessThan(1e-5);
    expect(Math.abs(snapshot.grading[axis].known_fill_area_m2-reference[axis][1])).toBeLessThan(1e-5);
  }
  await page.getByRole('region',{name:'切土・盛土の計算結果',exact:true}).screenshot({path:'../../.local/city-grading-yokohama-20261013.png'});
});
