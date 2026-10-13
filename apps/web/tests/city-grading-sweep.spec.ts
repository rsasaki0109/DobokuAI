import { test, expect } from '@playwright/test';
import type { Page, APIRequestContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { terrainSections } from '../src/citySections';
import { citySectionSnapshot } from '../src/citySectionCSV';
import { cityGradingConditions } from '../src/cityGrading';
import type { GradingRun } from '../src/cityGrading';
import type { CityModel } from '../src/cityModel';
import { parseGradingTargets, validateGradingTargets, inspectGradingSweep, buildCityGradingSweepReport } from '../src/cityGradingSweep';

const footprint={east:0,north:0,width:40,length:30,elevation:100},vertex=(east:number,north:number)=>[east,.1*east+.2*north,-north];
const model:CityModel={crs:'urn:doboku:crs:local-metre',origin:[0,0,100],bounds:{min:[-100,-30,-100],max:[100,30,100]},lod:1,polygonCount:2,features:[{id:'plane',layer:'terrain',triangleCount:2,positions:[vertex(-100,-100),vertex(100,-100),vertex(100,100),vertex(-100,-100),vertex(100,100),vertex(-100,100)].flat()}]};
const sections=terrainSections(model,footprint),source=citySectionSnapshot({title:'合成平面',model,footprint,sources:[{name:'plane.gml',bytes:25,sha256:'a'.repeat(64)}],inspected_at:'2026-10-13T00:00:00Z',source_url:'',attribution:'合成例',usage_terms:'テスト用',data_kind:'synthetic',dataset:null},sections,'2026-10-13T00:30:00Z');
async function run(request:APIRequestContext,h:number):Promise<GradingRun>{const r=await request.post('/api/earthwork/linear-grading',{data:{confirmed:true,conditions:cityGradingConditions(sections,h)}});expect(r.ok()).toBe(true);return r.json();}
const parseCSV=(csv:string)=>JSON.parse(execFileSync('python3',['-c','import csv,io,json,sys; print(json.dumps(list(csv.DictReader(io.StringIO(sys.stdin.read().lstrip("\\ufeff")), strict=True))))'],{input:csv,encoding:'utf8',maxBuffer:16*1024*1024}));
test('height lists preserve input order and strictly reject gaps duplicates invalid numbers and incomplete or foreign outcomes',async({request})=>{
  expect(parseGradingTargets('-.25\n2e1, +0')).toEqual([-.25,20,0]);expect(validateGradingTargets([-12000,12000])).toEqual([-12000,12000]);expect(parseGradingTargets('1,2,3,4,5,6,7,8,9')).toHaveLength(9);
  for(const text of ['','1,,2','1,','0,-0','NaN','Infinity','0x10','1 2','12001','1,2,3,4,5,6,7,8,9,10','1'.repeat(2049)])expect(()=>parseGradingTargets(text)).toThrow();
  expect(()=>validateGradingTargets(new Array(1))).toThrow();
  const a=await run(request,100),b=await run(request,99),values=[{status:'calculated',target_elevation_m:99,run:b},{status:'failed',target_elevation_m:101,error:'試験用API停止'}],sweep=inspectGradingSweep(source,a,[99,101],values);
  expect(sweep.outcomes[0]).toMatchObject({status:'calculated',differences:[{axis:'east_west',cut_area_delta_m2:25,fill_area_delta_m2:-15},{axis:'south_north',cut_area_delta_m2:17.5,fill_area_delta_m2:-12.5}]});
  expect(()=>inspectGradingSweep(source,a,[99,101],values.slice(0,1))).toThrow('全標高');expect(()=>inspectGradingSweep(source,a,[101,99],values)).toThrow('順序');
  expect(()=>inspectGradingSweep(source,a,[99],[{...values[0],run:{...b,engine_version:'other'}}])).toThrow('再計算');expect(()=>inspectGradingSweep(source,a,[101],[{...values[1],run:b}])).toThrow('失敗');
  const output=sweep.outcomes[0];if(output.status==='calculated')output.run.east_west.cut_area_m2=999;expect(b.east_west.cut_area_m2).toBe(45);
});

test('offline sweep reports preserve failed cases with blank numbers signed CSV differences exact JSON and safe metadata',async({page,request})=>{
  const attack='</pre><script>window.sweepInjected=true</script><img src="https://example.invalid/x">',a=await run(request,100),b=await run(request,99),c=await run(request,101);
  const report=buildCityGradingSweepReport({...source,title:attack,attribution:'=1+1'},a,[99,100,101],[{status:'calculated',target_elevation_m:99,run:b},{status:'failed',target_elevation_m:100,error:'=1+1'},{status:'calculated',target_elevation_m:101,run:c}],'2026-10-13T04:00:00Z'),rows=parseCSV(report.csv);
  expect(rows).toHaveLength(6);expect(rows[0]).toMatchObject({cut_area_m2:'45',fill_area_m2:'5',fill_area_delta_m2:'-15',attribution:"'=1+1"});expect(rows[2]).toMatchObject({status:'failed',cut_area_m2:'',fill_area_m2:'',known_cut_area_m2:'',executed_at_utc:'',error:"'=1+1"});
  const requests:string[]=[];page.on('request',r=>requests.push(r.url()));await page.setContent(report.html);await expect(page.locator('script,img,iframe')).toHaveCount(0);expect(await page.evaluate(()=>'sweepInjected' in window)).toBe(false);
  expect(JSON.parse((await page.locator('#city-grading-sweep-snapshot').textContent())!)).toEqual(report.snapshot);await expect(page.locator('[data-sweep-target="100"]')).toHaveCount(0);await expect(page.locator('[data-sweep-target]')).toHaveCount(8);await expect(page.locator('polyline')).toHaveCount(0);
  const href=await page.getByRole('link',{name:'この複数標高比較のCSVを保存',exact:true}).getAttribute('href');expect(decodeURIComponent(href!.split(',').slice(1).join(','))).toBe(report.csv);expect(requests).toEqual([]);
});

const xml=`<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:gml="http://www.opengis.net/gml" xmlns:dem="http://www.opengis.net/citygml/relief/2.0" srsName="urn:doboku:crs:local-metre" srsDimension="3"><core:cityObjectMember><dem:ReliefFeature gml:id="plane"><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>-100 -100 70 100 -100 90 100 100 130 -100 100 110 -100 -100 70</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></dem:ReliefFeature></core:cityObjectMember></core:CityModel>`;
async function profiles(page:Page){await page.getByRole('button',{name:'確認して施工範囲を表示',exact:true}).click();await page.getByRole('button',{name:'反映済み範囲の地形断面を表示',exact:true}).click();}
async function baseline(page:Page){await page.getByRole('button',{name:'条件を確認して断面の切土・盛土を計算',exact:true}).click();await expect(page.getByRole('region',{name:'切土・盛土の計算結果',exact:true})).toBeVisible();}
async function load(page:Page){await page.goto('/?view=city');await page.getByLabel('CityGMLファイル',{exact:true}).setInputFiles({name:'plane.gml',mimeType:'application/xml',buffer:Buffer.from(xml)});await page.getByRole('button',{name:'CityGMLを点検・プレビュー',exact:true}).click();await page.getByRole('button',{name:'確認して都市モデルを表示',exact:true}).click();await profiles(page);await baseline(page);}
async function download(page:Page,name:string){const event=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();return readFile((await(await event).path())!,'utf8');}
const compareName='標高一覧を確認して断面積を比較';

test('analytic sweep computes each reviewed target once and cached selected diagrams export a restorable two-plan record without changing baseline',async({page,request})=>{
  const project=await(await request.get('/api/projects/sample-river')).json(),history=await(await request.get('/api/projects/sample-river/runs')).json();await load(page);
  const original=JSON.parse(await download(page,'切土・盛土の計算JSONを保存')),posts:number[]=[];page.on('request',r=>{if(new URL(r.url()).pathname==='/api/earthwork/linear-grading')posts.push(r.postDataJSON().conditions.target_elevation_m);});
  const input=page.getByLabel('比較する計画標高 (m / 原データ基準)',{exact:true});await input.fill('99,,101');await expect(page.getByRole('button',{name:compareName,exact:true})).toBeDisabled();expect(posts).toEqual([]);
  await input.fill('101, 99, 100');await page.getByRole('button',{name:compareName,exact:true}).click();const result=page.getByRole('region',{name:'複数標高の比較結果',exact:true});await expect(result).toBeVisible();expect(posts).toEqual([101,99,100]);
  for(const [h,areas]of [[99,'45 / 5'],[100,'20 / 20'],[101,'5 / 45']]as const)await expect(result.locator(`[data-sweep-row="${h}:east_west"] td`).nth(2)).toHaveText(areas);
  for(const [h,cut,fill]of [[99,40,10],[100,22.5,22.5],[101,10,40]]as const){const actual=(await result.locator(`[data-sweep-row="${h}:south_north"] td`).nth(2).textContent())!.split('/').map(Number);expect(Math.abs(actual[0]-cut)).toBeLessThan(1e-10);expect(Math.abs(actual[1]-fill)).toBeLessThan(1e-10);}
  const json=JSON.parse(await download(page,'複数標高の比較JSONを保存')),html=await download(page,'複数標高の比較HTMLを保存');expect(json.sweep.targets).toEqual([101,99,100]);expect(json.sweep.baseline).toEqual(original.grading);
  const report=await page.context().newPage();await report.route('**/*',r=>r.abort());await report.setContent(html);expect(JSON.parse((await report.locator('#city-grading-sweep-snapshot').textContent())!)).toEqual(json);
  for(const axis of ['東西','南北'])expect(await report.getByRole('img',{name:`${axis}の標高と断面積の比較`,exact:true}).innerHTML()).toBe(await result.getByRole('img',{name:`${axis}の標高と断面積の比較`,exact:true}).innerHTML());await report.close();
  await page.getByRole('button',{name:'標高99mの断面比較を表示',exact:true}).click();await expect(page.getByRole('region',{name:'複数標高の選択案詳細',exact:true})).toBeVisible();expect(posts).toEqual([101,99,100]);
  const selected=JSON.parse(await download(page,'選択した標高の比較JSONを保存'));expect(selected.comparison.scenario.conditions.target_elevation_m).toBe(99);expect(selected.comparison.baseline).toEqual(original.grading);
  await page.getByLabel('2案比較の保存結果JSON',{exact:true}).setInputFiles({name:'selected.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(selected))});await page.getByRole('button',{name:'比較JSONを点検・両案をRustで照合',exact:true}).click();await page.getByRole('button',{name:'確認して保存した2案比較を表示',exact:true}).click();
  expect(JSON.parse(await download(page,'復元した比較JSONを保存'))).toEqual(selected);expect(JSON.parse(await download(page,'切土・盛土の計算JSONを保存'))).toEqual(original);expect(await(await request.get('/api/projects/sample-river')).json()).toEqual(project);expect(await(await request.get('/api/projects/sample-river/runs')).json()).toEqual(history);
});

test('nine public Yokohama heights retain uncomputed totals licensed provenance and monotone known cut and fill without changing river storage',async({page,request})=>{
  const project=await(await request.get('/api/projects/sample-river')).json(),history=await(await request.get('/api/projects/sample-river/runs')).json();await page.goto('/?view=city');for(const label of ['施工範囲の幅 (m)','施工範囲の長さ (m)'])await page.getByLabel(label,{exact:true}).fill('200');await profiles(page);await page.getByLabel('断面積計算の計画標高 (m / 原データ基準)',{exact:true}).fill('0');await baseline(page);
  await page.getByLabel('比較する計画標高 (m / 原データ基準)',{exact:true}).fill('-4,-3,-2,-1,0,1,2,3,4');await page.getByRole('button',{name:compareName,exact:true}).click();const result=page.getByRole('region',{name:'複数標高の比較結果',exact:true});await expect(result).toBeVisible();
  const json=JSON.parse(await download(page,'複数標高の比較JSONを保存')),rows=parseCSV(await download(page,'複数標高の比較CSVを保存'));expect(json.sweep.outcomes).toHaveLength(9);expect(rows).toHaveLength(18);expect(json.attribution).toContain('PLATEAU');expect(json.usage_terms).toContain('CC BY');
  expect(rows.filter((r:Record<string,string>)=>r.axis==='east_west').every((r:Record<string,string>)=>r.complete==='false'&&r.cut_area_m2===''&&r.fill_area_m2==='')).toBe(true);
  await expect(result.getByRole('img',{name:'東西の標高と断面積の比較',exact:true})).toHaveAttribute('data-area-kind','known_subtotal');await expect(result.locator('[data-sweep-target]')).toHaveCount(36);
  for(let i=0;i<9;i++){const o=json.sweep.outcomes[i];expect(o.status).toBe('calculated');expect(o.run.east_west.cut_area_m2).toBeNull();expect(o.run.conditions.target_elevation_m).toBe(i-4);if(i>0){expect(o.run.east_west.known_cut_area_m2).toBeLessThanOrEqual(json.sweep.outcomes[i-1].run.east_west.known_cut_area_m2);expect(o.run.east_west.known_fill_area_m2).toBeGreaterThanOrEqual(json.sweep.outcomes[i-1].run.east_west.known_fill_area_m2);}}
  expect(json.sources.map((s:{sha256:string})=>s.sha256).every((s:string)=>s.length===64)).toBe(true);expect(await(await request.get('/api/projects/sample-river')).json()).toEqual(project);expect(await(await request.get('/api/projects/sample-river/runs')).json()).toEqual(history);
});

test('failed and foreign-version cases remain recorded with no numeric point while later heights continue',async({page})=>{
  await load(page);const original=JSON.parse(await download(page,'切土・盛土の計算JSONを保存')),requested:number[]=[];
  await page.route('**/api/earthwork/linear-grading',async r=>{const h=r.request().postDataJSON().conditions.target_elevation_m;requested.push(h);if(h===100)await r.fulfill({status:503,json:{error:'試験用標高100停止'}});else if(h===101){const response=await r.fetch(),value=await response.json();value.engine_version='foreign';await r.fulfill({json:value});}else await r.continue();});
  await page.getByLabel('比較する計画標高 (m / 原データ基準)',{exact:true}).fill('100,99,101');await page.getByRole('button',{name:compareName,exact:true}).click();const result=page.getByRole('region',{name:'複数標高の比較結果',exact:true});await expect(result).toBeVisible();expect(requested).toEqual([100,99,101]);
  const json=JSON.parse(await download(page,'複数標高の比較JSONを保存')),rows=parseCSV(await download(page,'複数標高の比較CSVを保存'));expect(json.sweep.outcomes.map((o:{status:string})=>o.status)).toEqual(['failed','calculated','failed']);
  expect(rows.filter((r:Record<string,string>)=>r.status==='failed').every((r:Record<string,string>)=>r.cut_area_m2===''&&r.known_cut_area_m2===''&&r.executed_at_utc==='')).toBe(true);await expect(result.locator('[data-sweep-target="100"],[data-sweep-target="101"]')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'標高100mの断面比較を表示',exact:true})).toBeDisabled();await expect(result).toContainText('試験用標高100停止');await expect(result).toContainText('基準案を再計算');expect(JSON.parse(await download(page,'切土・盛土の計算JSONを保存'))).toEqual(original);
  await page.unroute('**/api/earthwork/linear-grading');await page.route('**/api/earthwork/linear-grading',r=>r.fulfill({status:503,json:{error:'全ケース停止'}}));
  await page.getByRole('button',{name:compareName,exact:true}).click();await expect(result).toContainText('計算成功 0・失敗 3');await expect(result.locator('svg')).toHaveCount(0);
  expect(JSON.parse(await download(page,'複数標高の比較JSONを保存')).sweep.outcomes.every((o:{status:string})=>o.status==='failed')).toBe(true);
});

test('editing targets cancellation baseline changes and source replacement stop the sweep before later requests and cannot revive results',async({page})=>{
  await load(page);let release:()=>void=()=>{},arrived:()=>void=()=>{},waiting=new Promise<void>(r=>{arrived=r;}),delayed=new Promise<void>(r=>{release=r;});const calls:number[]=[];
  const route=async(r:import('@playwright/test').Route)=>{calls.push(r.request().postDataJSON().conditions.target_elevation_m);const response=await r.fetch();arrived();await delayed;try{await r.fulfill({response});}catch{/* aborted */}};
  await page.route('**/api/earthwork/linear-grading',route);
  for(const action of ['text','cancel','baseline','source']){
    waiting=new Promise(r=>{arrived=r;});delayed=new Promise(r=>{release=r;});await page.getByLabel('比較する計画標高 (m / 原データ基準)',{exact:true}).fill('99,100,101');const before=calls.length;await page.getByRole('button',{name:compareName,exact:true}).click();await waiting;
    if(action==='text')await page.getByLabel('比較する計画標高 (m / 原データ基準)',{exact:true}).fill('98,100');if(action==='cancel')await page.getByRole('button',{name:'複数標高の比較を取消',exact:true}).click();if(action==='baseline')await page.getByLabel('断面積計算の計画標高 (m / 原データ基準)',{exact:true}).fill('101');if(action==='source')await page.getByRole('button',{name:'合成都市デモを表示',exact:true}).click();
    release();await expect(page.getByRole('region',{name:'複数標高の比較結果',exact:true})).toHaveCount(0);expect(calls.slice(before)).toEqual([99]);
    if(action==='baseline'){await page.unroute('**/api/earthwork/linear-grading',route);await baseline(page);await page.route('**/api/earthwork/linear-grading',route);}
  }
});
