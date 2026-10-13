import { test, expect } from '@playwright/test';
import type { Page, APIRequestContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { terrainSections } from '../src/citySections';
import { citySectionSnapshot } from '../src/citySectionCSV';
import { cityGradingConditions } from '../src/cityGrading';
import type { GradingRun } from '../src/cityGrading';
import { gradingComparison, buildCityGradingComparisonReport } from '../src/cityGradingComparison';
import type { CityModel } from '../src/cityModel';

const footprint = { east: 0, north: 0, width: 40, length: 30, elevation: 100 };
const vertex = (east:number,north:number)=>[east,.1*east+.2*north,-north];
const model:CityModel={crs:'urn:doboku:crs:local-metre',origin:[0,0,100],bounds:{min:[-100,-30,-100],max:[100,30,100]},lod:1,polygonCount:2,
  features:[{id:'plane',layer:'terrain',triangleCount:2,positions:[vertex(-100,-100),vertex(100,-100),vertex(100,100),vertex(-100,-100),vertex(100,100),vertex(-100,100)].flat()}]};
const sections=terrainSections(model,footprint);
const source=citySectionSnapshot({title:'合成平面',model,footprint,sources:[{name:'plane.gml',bytes:25,sha256:'a'.repeat(64)}],inspected_at:'2026-10-13T00:00:00Z',source_url:'',attribution:'合成例',usage_terms:'テスト用',data_kind:'synthetic',dataset:null},sections,'2026-10-13T00:30:00Z');
async function run(request:APIRequestContext,h:number):Promise<GradingRun>{const r=await request.post('/api/earthwork/linear-grading',{data:{confirmed:true,conditions:cityGradingConditions(sections,h)}});expect(r.ok()).toBe(true);return r.json();}
const parseCSV=(csv:string)=>JSON.parse(execFileSync('python3',['-c','import csv,io,json,sys; print(json.dumps(list(csv.DictReader(io.StringIO(sys.stdin.read().lstrip("\\ufeff")), strict=True))))'],{input:csv,encoding:'utf8',maxBuffer:16*1024*1024}));
const xml=`<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:gml="http://www.opengis.net/gml" xmlns:dem="http://www.opengis.net/citygml/relief/2.0" srsName="urn:doboku:crs:local-metre" srsDimension="3"><core:cityObjectMember><dem:ReliefFeature gml:id="plane"><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>-100 -100 70 100 -100 90 100 100 130 -100 100 110 -100 -100 70</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></dem:ReliefFeature></core:cityObjectMember></core:CityModel>`;
async function profiles(page:Page){await page.getByRole('button',{name:'確認して施工範囲を表示',exact:true}).click();await page.getByRole('button',{name:'反映済み範囲の地形断面を表示',exact:true}).click();}
async function load(page:Page){await page.goto('/?view=city');await page.getByLabel('CityGMLファイル',{exact:true}).setInputFiles({name:'plane.gml',mimeType:'application/xml',buffer:Buffer.from(xml)});await page.getByRole('button',{name:'CityGMLを点検・プレビュー',exact:true}).click();await page.getByRole('button',{name:'確認して都市モデルを表示',exact:true}).click();await profiles(page);await baseline(page);}
async function baseline(page:Page){await page.getByRole('button',{name:'条件を確認して断面の切土・盛土を計算',exact:true}).click();await expect(page.getByRole('region',{name:'切土・盛土の計算結果',exact:true})).toBeVisible();}
async function download(page:Page,name:string){const event=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();return readFile((await(await event).path())!,'utf8');}
const compareName='2案の条件を確認して断面積を比較';

test('comparison gives analytical area differences, zero for equal plans and refuses other geometry or engine versions',async({request})=>{
  const a=await run(request,100),b=await run(request,99),copy=structuredClone(a),comparison=gradingComparison(source,a,b);
  expect(comparison.differences).toEqual([
    {axis:'east_west',complete:true,cut_area_delta_m2:25,fill_area_delta_m2:-15,known_cut_area_delta_m2:25,known_fill_area_delta_m2:-15},
    {axis:'south_north',complete:true,cut_area_delta_m2:17.5,fill_area_delta_m2:-12.5,known_cut_area_delta_m2:17.5,known_fill_area_delta_m2:-12.5}]);
  expect(a).toEqual(copy);comparison.baseline.east_west.cut_area_m2=999;expect(a.east_west.cut_area_m2).toBe(20);
  expect(gradingComparison(source,a,a).differences.every(d=>d.cut_area_delta_m2===0&&d.fill_area_delta_m2===0)).toBe(true);
  const foreign=structuredClone(b);foreign.conditions.east_west.length_m=41;expect(()=>gradingComparison(source,a,foreign)).toThrow('条件');
  expect(()=>gradingComparison(source,a,{...b,engine_version:'other'})).toThrow('再計算');
  const coverage=structuredClone(b);coverage.east_west.known_length_m=39;coverage.east_west.uncovered_length_m=1;
  expect(()=>gradingComparison(source,a,coverage)).toThrow('被覆');
});

test('comparison reports escape imported metadata and retain complete inputs, signed CSV numbers and offline shared figures',async({page,request})=>{
  const attack='</pre><script>window.comparisonInjected=true</script><img src="https://example.invalid/x">';
  const a=await run(request,100),b=await run(request,99),report=buildCityGradingComparisonReport({...source,title:attack,attribution:'=1+1'},a,b,'2026-10-13T04:00:00Z'),rows=parseCSV(report.csv);
  expect(rows.filter((r:Record<string,string>)=>r.row_type==='summary')).toHaveLength(2);expect(rows[0]).toMatchObject({cut_area_delta_m2:'25',fill_area_delta_m2:'-15',attribution:"'=1+1",volume_calculated:'false'});
  expect(rows.filter((r:Record<string,string>)=>r.row_type==='interval')).toHaveLength(4);expect(rows.filter((r:Record<string,string>)=>r.row_type==='point')).toHaveLength(6);
  expect(JSON.parse(rows[0].source_files_json)).toEqual(source.sources);
  const requests:string[]=[];page.on('request',r=>requests.push(r.url()));await page.setContent(report.html);
  await expect(page.locator('script,img,iframe')).toHaveCount(0);expect(await page.evaluate(()=>'comparisonInjected' in window)).toBe(false);
  expect(JSON.parse((await page.locator('#city-grading-comparison-snapshot').textContent())!)).toEqual(report.snapshot);
  const href=await page.getByRole('link',{name:'この比較結果のCSVを保存',exact:true}).getAttribute('href');expect(decodeURIComponent(href!.split(',').slice(1).join(','))).toBe(report.csv);
  expect(requests).toEqual([]);
});

test('confirmed comparison keeps baseline unchanged, shares plot scales and exports the displayed comparison with both original timestamps',async({page,request})=>{
  const project=await(await request.get('/api/projects/sample-river')).json(),history=await(await request.get('/api/projects/sample-river/runs')).json();
  await load(page);const original=JSON.parse(await download(page,'切土・盛土の計算JSONを保存'));
  const target=page.getByLabel('比較案の計画標高 (m / 原データ基準)',{exact:true}),result=page.getByRole('region',{name:'計画標高2案の比較結果',exact:true});
  await target.fill('');await expect(page.getByRole('button',{name:compareName,exact:true})).toBeDisabled();await target.fill('99');await page.getByRole('button',{name:compareName,exact:true}).click();await expect(result).toBeVisible();
  await expect(result.locator('[data-comparison-axis="east_west"] td').nth(0)).toHaveText('25');await expect(result.locator('[data-comparison-axis="east_west"] td').nth(1)).toHaveText('-15');
  expect(JSON.parse(await download(page,'切土・盛土の計算JSONを保存'))).toEqual(original);await expect(page.getByLabel('断面積計算の計画標高 (m / 原データ基準)',{exact:true})).toHaveValue('100');
  await target.fill('90');await expect(result).toHaveCount(0);await expect(page.getByRole('button',{name:'断面積の比較JSONを保存',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:compareName,exact:true}).click();await expect(result).toBeVisible();
  for(const axis of ['東西','南北']){
    const before=result.getByRole('region',{name:'比較図の基準案',exact:true}).getByRole('img',{name:`${axis}の切土・盛土断面`,exact:true}),after=result.getByRole('region',{name:'比較図の比較案',exact:true}).getByRole('img',{name:`${axis}の切土・盛土断面`,exact:true});
    expect(await before.getAttribute('data-section-height-range')).toBe(await after.getAttribute('data-section-height-range'));
    expect(await before.locator('[data-terrain-line]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('d')))).toEqual(await after.locator('[data-terrain-line]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('d'))));
  }
  const json=JSON.parse(await download(page,'断面積の比較JSONを保存')),html=await download(page,'断面積の比較HTMLを保存'),csv=await download(page,'断面積の比較CSVを保存');
  expect(json.comparison.baseline).toEqual(original.grading);expect(json.comparison.scenario.conditions.target_elevation_m).toBe(90);expect(json.difference_direction).toBe('scenario_minus_baseline');expect(parseCSV(csv)[0].fill_area_delta_m2).toBe('-20');
  const report=await page.context().newPage();await report.route('**/*',r=>r.abort());await report.setContent(html);
  expect(JSON.parse((await report.locator('#city-grading-comparison-snapshot').textContent())!)).toEqual(json);
  for(const plan of ['比較図の基準案','比較図の比較案'])for(const axis of ['東西','南北'])expect(await report.getByRole('region',{name:plan,exact:true}).getByRole('img',{name:`${axis}の切土・盛土断面`,exact:true}).innerHTML()).toBe(await result.getByRole('region',{name:plan,exact:true}).getByRole('img',{name:`${axis}の切土・盛土断面`,exact:true}).innerHTML());
  await report.close();expect(await(await request.get('/api/projects/sample-river')).json()).toEqual(project);expect(await(await request.get('/api/projects/sample-river/runs')).json()).toEqual(history);
});

test('public Yokohama comparison keeps gaps uncomputed, known differences distinct and original provenance and river storage',async({page,request})=>{
  const project=await(await request.get('/api/projects/sample-river')).json(),history=await(await request.get('/api/projects/sample-river/runs')).json();
  await page.goto('/?view=city');for(const label of ['施工範囲の幅 (m)','施工範囲の長さ (m)'])await page.getByLabel(label,{exact:true}).fill('200');await profiles(page);await page.getByLabel('断面積計算の計画標高 (m / 原データ基準)',{exact:true}).fill('0');await baseline(page);
  const original=JSON.parse(await download(page,'切土・盛土の計算JSONを保存'));await page.getByLabel('比較案の計画標高 (m / 原データ基準)',{exact:true}).fill('-1');await page.getByRole('button',{name:compareName,exact:true}).click();
  const result=page.getByRole('region',{name:'計画標高2案の比較結果',exact:true});await expect(result).toBeVisible();await expect(result.locator('[data-comparison-axis="east_west"] td').nth(0)).toHaveText('未算定');
  const json=JSON.parse(await download(page,'断面積の比較JSONを保存')),rows=parseCSV(await download(page,'断面積の比較CSVを保存'));
  expect(json.comparison.baseline).toEqual(original.grading);expect(json.sources).toEqual(original.sources);expect(json.terrain_sections).toEqual(original.terrain_sections);expect(json.attribution).toContain('PLATEAU');expect(json.usage_terms).toContain('CC BY');expect(json.comparison.scenario.conditions.target_elevation_m).toBe(-1);
  expect(rows[0]).toMatchObject({complete:'false',cut_area_delta_m2:'',fill_area_delta_m2:''});expect(Number(rows[0].known_cut_area_delta_m2)).toBeGreaterThan(0);expect(json.comparison.differences[1].cut_area_delta_m2).toBeCloseTo(200,8);
  expect(rows.filter((r:Record<string,string>)=>r.row_type==='interval'&&r.status==='uncovered').every((r:Record<string,string>)=>r.cut_area_delta_m2===''&&r.fill_area_delta_m2==='')).toBe(true);
  const before=result.getByRole('region',{name:'比較図の基準案',exact:true}),after=result.getByRole('region',{name:'比較図の比較案',exact:true});expect(await before.locator('[data-section-status="uncovered"]').count()).toBe(await after.locator('[data-section-status="uncovered"]').count());
  expect(await(await request.get('/api/projects/sample-river')).json()).toEqual(project);expect(await(await request.get('/api/projects/sample-river/runs')).json()).toEqual(history);
});

test('API failure and a foreign engine do not replace the baseline or provide a comparison export',async({page})=>{
  await load(page);const original=JSON.parse(await download(page,'切土・盛土の計算JSONを保存'));
  await page.route('**/api/earthwork/linear-grading',r=>r.fulfill({status:503,json:{error:'比較API停止'}}));await page.getByRole('button',{name:compareName,exact:true}).click();await expect(page.getByRole('alert')).toContainText('比較API停止');
  await expect(page.getByRole('button',{name:'断面積の比較JSONを保存',exact:true})).toBeDisabled();expect(JSON.parse(await download(page,'切土・盛土の計算JSONを保存'))).toEqual(original);
  await page.unroute('**/api/earthwork/linear-grading');await page.route('**/api/earthwork/linear-grading',async r=>{const response=await r.fetch(),value=await response.json();value.engine_version='other';await r.fulfill({json:value});});
  await page.getByRole('button',{name:compareName,exact:true}).click();await expect(page.getByRole('alert')).toContainText('基準案を再計算');expect(JSON.parse(await download(page,'切土・盛土の計算JSONを保存'))).toEqual(original);
});

test('a model without ground never turns a full-area difference into zero',async({page})=>{
  await page.goto('/?view=city');const absent=xml.replace('srsName=','xmlns:bldg="http://www.opengis.net/citygml/building/2.0" srsName=').replaceAll('dem:ReliefFeature','bldg:Building');
  await page.getByLabel('CityGMLファイル',{exact:true}).setInputFiles({name:'no-ground.gml',mimeType:'application/xml',buffer:Buffer.from(absent)});
  await page.getByRole('button',{name:'CityGMLを点検・プレビュー',exact:true}).click();await page.getByRole('button',{name:'確認して都市モデルを表示',exact:true}).click();await profiles(page);await baseline(page);
  await page.getByRole('button',{name:compareName,exact:true}).click();await expect(page.getByRole('region',{name:'計画標高2案の比較結果',exact:true})).toBeVisible();
  const json=JSON.parse(await download(page,'断面積の比較JSONを保存')),rows=parseCSV(await download(page,'断面積の比較CSVを保存'));
  expect(json.comparison.differences.every((d:{complete:boolean;cut_area_delta_m2:number|null;fill_area_delta_m2:number|null;known_cut_area_delta_m2:number})=>!d.complete&&d.cut_area_delta_m2===null&&d.fill_area_delta_m2===null&&d.known_cut_area_delta_m2===0)).toBe(true);
  expect(rows.filter((r:Record<string,string>)=>r.row_type==='summary').every((r:Record<string,string>)=>r.complete==='false'&&r.cut_area_delta_m2===''&&r.fill_area_delta_m2===''&&r.known_cut_area_delta_m2==='0')).toBe(true);
});

test('target edits, cancellation, baseline edits and source replacement cannot revive a delayed comparison',async({page})=>{
  await load(page);let release:()=>void=()=>{},arrived:()=>void=()=>{},waiting=new Promise<void>(r=>{arrived=r;}),delayed=new Promise<void>(r=>{release=r;});
  await page.route('**/api/earthwork/linear-grading',async route=>{const response=await route.fetch();arrived();await delayed;try{await route.fulfill({response});}catch{/* aborted */}});
  for(const action of ['target','cancel','baseline','source']){
    waiting=new Promise(r=>{arrived=r;});delayed=new Promise(r=>{release=r;});await page.getByRole('button',{name:compareName,exact:true}).click();await waiting;
    if(action==='target')await page.getByLabel('比較案の計画標高 (m / 原データ基準)',{exact:true}).fill('98');
    if(action==='cancel')await page.getByRole('button',{name:'断面積の比較を取消',exact:true}).click();
    if(action==='baseline')await page.getByLabel('断面積計算の計画標高 (m / 原データ基準)',{exact:true}).fill('101');
    if(action==='source')await page.getByRole('button',{name:'合成都市デモを表示',exact:true}).click();
    release();await expect(page.getByRole('region',{name:'計画標高2案の比較結果',exact:true})).toHaveCount(0);
    if(action==='baseline'){await page.unroute('**/api/earthwork/linear-grading');await baseline(page);await page.route('**/api/earthwork/linear-grading',async route=>{const response=await route.fetch();arrived();await delayed;try{await route.fulfill({response});}catch{/* aborted */}});}
  }
});
