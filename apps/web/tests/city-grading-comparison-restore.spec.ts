import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { terrainSections } from '../src/citySections';
import { citySectionSnapshot } from '../src/citySectionCSV';
import { cityGradingConditions } from '../src/cityGrading';
import { gradingComparison, buildCityGradingComparisonReport } from '../src/cityGradingComparison';
import { inspectCityGradingComparisonArchive, verifyCityGradingComparisonArchive } from '../src/cityGradingComparisonRestore';
import { cityGradingFileLimit } from '../src/cityGradingRestore';
import type { CityModel } from '../src/cityModel';
import type { GradingRun } from '../src/cityGrading';

const footprint={east:0,north:0,width:40,length:30,elevation:100};
const vertex=(east:number,north:number)=>[east,.1*east+.2*north,-north];
const model:CityModel={crs:'urn:doboku:crs:local-metre',origin:[0,0,100],bounds:{min:[-100,-30,-100],max:[100,30,100]},lod:1,polygonCount:2,features:[{id:'plane',layer:'terrain',triangleCount:2,positions:[vertex(-100,-100),vertex(100,-100),vertex(100,100),vertex(-100,-100),vertex(100,100),vertex(-100,100)].flat()}]};
const sections=terrainSections(model,footprint),source=citySectionSnapshot({title:'合成平面',model,footprint,sources:[{name:'plane.gml',bytes:25,sha256:'a'.repeat(64)}],inspected_at:'2026-10-13T00:00:00Z',source_url:'',attribution:'合成例',usage_terms:'テスト用',data_kind:'synthetic',dataset:null},sections,'2026-10-13T00:30:00Z','2026-10-13T01:00:00Z');
async function run(request:APIRequestContext,h:number):Promise<GradingRun>{const r=await request.post('/api/earthwork/linear-grading',{data:{confirmed:true,conditions:cityGradingConditions(sections,h)}});expect(r.ok()).toBe(true);return r.json();}
function reordered(v:unknown):unknown{if(Array.isArray(v))return v.map(reordered);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).reverse().map(([k,a])=>[k,reordered(a)]));return v;}
test('comparison archives validate every source and difference, preserve historical UTC precision and accept object key order only',async({request})=>{
  const a=await run(request,100),b=await run(request,99);a.executed_at='2026-10-13T01:00:00.123456789+00:00';b.executed_at='2026-10-13T02:00:00Z';
  const saved=buildCityGradingComparisonReport(source,a,b,'2026-10-13T02:01:00Z').snapshot,current={...source,generated_at:'2026-10-13T05:00:00Z',inspected_at:'2026-10-13T04:00:00Z',sections_inspected_at:'2026-10-13T04:30:00Z'};
  const archive=inspectCityGradingComparisonArchive(reordered(saved),current),verified=verifyCityGradingComparisonArchive(archive,{...a,executed_at:'2026-10-13T05:01:00Z'},{...b,executed_at:'2026-10-13T05:01:01Z'});
  expect(buildCityGradingComparisonReport(verified.archive.source,verified.archive.comparison.baseline,verified.archive.comparison.scenario,verified.archive.source.generated_at).snapshot).toEqual(saved);
  expect(verified.verifiedAt).toEqual({baseline:'2026-10-13T05:01:00Z',scenario:'2026-10-13T05:01:01Z'});verified.archive.comparison.baseline.east_west.cut_area_m2=999;expect(archive.comparison.baseline.east_west.cut_area_m2).toBe(20);
  const mutations=[(v:typeof saved)=>{v.difference_direction='baseline_minus_scenario';},(v:typeof saved)=>{v.comparison.differences[0].known_cut_area_delta_m2++;},(v:typeof saved)=>{v.comparison.differences.reverse();},
    (v:typeof saved)=>{v.sources[0].sha256='b'.repeat(64);},(v:typeof saved)=>{v.terrain_sections.sections[0].intervals[0].curves[0].from=99;},(v:typeof saved)=>{v.generated_at='2026-02-30T00:00:00Z';},(v:typeof saved)=>{v.comparison.scenario.executed_at='2026-10-13T00:00:00+09:00';}];
  for(const mutate of mutations){const bad=structuredClone(saved);mutate(bad);expect(()=>inspectCityGradingComparisonArchive(bad,current)).toThrow();}
  expect(()=>inspectCityGradingComparisonArchive({...saved,extra:true},current)).toThrow('項目');expect(()=>inspectCityGradingComparisonArchive({...saved,comparison:{...saved.comparison,extra:true}},current)).toThrow('項目');
});

test('both runs must match fresh Rust even if manipulated results and derived differences are internally consistent',async({request})=>{
  const a=await run(request,100),b=await run(request,99),saved=buildCityGradingComparisonReport(source,a,b).snapshot;
  for(const key of ['baseline','scenario'] as const){
    const bad=structuredClone(saved),q=bad.comparison[key].east_west;q.cut_area_m2!++;q.known_cut_area_m2++;q.spans[0].cut_area_m2!++;
    bad.comparison.differences=gradingComparison(source,bad.comparison.baseline,bad.comparison.scenario).differences;
    expect(()=>verifyCityGradingComparisonArchive(inspectCityGradingComparisonArchive(bad,source),a,b)).toThrow('数値');
  }
  const archive=inspectCityGradingComparisonArchive(saved,source);expect(()=>verifyCityGradingComparisonArchive(archive,a,{...b,engine_version:'other'})).toThrow('エンジン');
});

const xml=`<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:gml="http://www.opengis.net/gml" xmlns:dem="http://www.opengis.net/citygml/relief/2.0" srsName="urn:doboku:crs:local-metre" srsDimension="3"><core:cityObjectMember><dem:ReliefFeature gml:id="plane"><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>-100 -100 70 100 -100 90 100 100 130 -100 100 110 -100 -100 70</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></dem:ReliefFeature></core:cityObjectMember></core:CityModel>`;
async function profiles(page:Page){await page.getByRole('button',{name:'確認して施工範囲を表示',exact:true}).click();await page.getByRole('button',{name:'反映済み範囲の地形断面を表示',exact:true}).click();}
async function load(page:Page){await page.goto('/?view=city');await page.getByLabel('CityGMLファイル',{exact:true}).setInputFiles({name:'plane.gml',mimeType:'application/xml',buffer:Buffer.from(xml)});await page.getByRole('button',{name:'CityGMLを点検・プレビュー',exact:true}).click();await page.getByRole('button',{name:'確認して都市モデルを表示',exact:true}).click();await profiles(page);await calculate(page);}
async function calculate(page:Page){await page.getByRole('button',{name:'条件を確認して断面の切土・盛土を計算',exact:true}).click();await expect(page.getByRole('region',{name:'切土・盛土の計算結果',exact:true})).toBeVisible();await page.getByRole('button',{name:'2案の条件を確認して断面積を比較',exact:true}).click();await expect(page.getByRole('region',{name:'計画標高2案の比較結果',exact:true})).toBeVisible();}
async function download(page:Page,name:string){const event=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();return readFile((await(await event).path())!,'utf8');}
async function file(page:Page,value:unknown,name='comparison.json'){await page.getByLabel('2案比較の保存結果JSON',{exact:true}).setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});}
const reviewName='比較JSONを点検・両案をRustで照合',confirmName='確認して保存した2案比較を表示';

test('Yokohama comparison reopens after reload without a baseline calculation and keeps original CSV JSON times and river storage',async({page,request})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const project=await(await request.get('/api/projects/sample-river')).json(),history=await(await request.get('/api/projects/sample-river/runs')).json();
  await page.goto('/?view=city');for(const label of ['施工範囲の幅 (m)','施工範囲の長さ (m)'])await page.getByLabel(label,{exact:true}).fill('200');await profiles(page);await page.getByLabel('断面積計算の計画標高 (m / 原データ基準)',{exact:true}).fill('0');await calculate(page);
  const original=JSON.parse(await download(page,'断面積の比較JSONを保存')),csv=await download(page,'断面積の比較CSVを保存');expect(original.comparison.baseline.east_west.complete).toBe(false);
  await page.reload();for(const label of ['施工範囲の幅 (m)','施工範囲の長さ (m)'])await page.getByLabel(label,{exact:true}).fill('200');await profiles(page);const target=page.getByLabel('断面積計算の計画標高 (m / 原データ基準)',{exact:true});await target.fill('5');
  const posts:number[]=[];page.on('request',r=>{if(new URL(r.url()).pathname==='/api/earthwork/linear-grading')posts.push(JSON.parse(r.postData()!).conditions.target_elevation_m);});
  const preview=page.getByRole('region',{name:'2案比較結果の復元確認',exact:true}),result=page.getByRole('region',{name:'復元した2案比較の結果',exact:true});
  await file(page,reordered(original));await page.getByRole('button',{name:reviewName,exact:true}).click();await expect(preview).toBeVisible();expect(posts.sort()).toEqual([-1,0]);await expect(target).toHaveValue('5');await expect(result).toHaveCount(0);
  await expect(page.getByRole('button',{name:'切土・盛土の計算JSONを保存',exact:true})).toBeDisabled();await page.getByRole('button',{name:'2案比較の復元を取消',exact:true}).click();await expect(preview).toHaveCount(0);
  await page.getByRole('button',{name:reviewName,exact:true}).click();await expect(preview).toBeVisible();await page.getByRole('button',{name:confirmName,exact:true}).click();await expect(result).toBeVisible();await expect(target).toHaveValue('5');
  expect(JSON.parse(await download(page,'復元した比較JSONを保存'))).toEqual(original);expect(await download(page,'復元した比較CSVを保存')).toBe(csv);
  await expect(result.locator('[data-comparison-axis="east_west"] td').first()).toHaveText('未算定');await expect(result).toContainText(original.generated_at);await expect(result).toContainText(original.comparison.baseline.executed_at);await expect(result).toContainText(original.comparison.scenario.executed_at);
  const html=await download(page,'復元した比較HTMLを保存'),report=await page.context().newPage();await report.route('**/*',r=>r.abort());await report.setContent(html);
  expect(JSON.parse((await report.locator('#city-grading-comparison-snapshot').textContent())!)).toEqual(original);
  for(const plan of ['比較図の基準案','比較図の比較案'])for(const axis of ['東西','南北'])expect(await report.getByRole('region',{name:plan,exact:true}).getByRole('img',{name:`${axis}の切土・盛土断面`,exact:true}).innerHTML()).toBe(await result.getByRole('region',{name:plan,exact:true}).getByRole('img',{name:`${axis}の切土・盛土断面`,exact:true}).innerHTML());await report.close();
  expect(await(await request.get('/api/projects/sample-river')).json()).toEqual(project);expect(await(await request.get('/api/projects/sample-river/runs')).json()).toEqual(history);expect(errors).toEqual([]);
});

test('foreign metadata, differences, tampered plans and unavailable second verification keep existing normal and restored results',async({page})=>{
  await load(page);const original=JSON.parse(await download(page,'断面積の比較JSONを保存')),baseline=JSON.parse(await download(page,'切土・盛土の計算JSONを保存'));
  await file(page,original);await page.getByRole('button',{name:reviewName,exact:true}).click();await page.getByRole('button',{name:confirmName,exact:true}).click();
  const mutations=[(v:typeof original)=>{v.sources[0].sha256='b'.repeat(64);},(v:typeof original)=>{v.comparison.differences[0].known_cut_area_delta_m2++;},(v:typeof original)=>{v.difference_direction='other';},(v:typeof original)=>{v.comparison.scenario.engine_version='foreign';},
    (v:typeof original)=>{const q=v.comparison.scenario.east_west;q.cut_area_m2++;q.known_cut_area_m2++;q.spans[0].cut_area_m2++;v.comparison.differences=gradingComparison(v,v.comparison.baseline,v.comparison.scenario).differences;}];
  for(const mutate of mutations){const bad=structuredClone(original);mutate(bad);await file(page,bad);await page.getByRole('button',{name:reviewName,exact:true}).click();await expect(page.getByRole('alert')).toContainText('保存した比較を復元できません');await expect(page.getByRole('button',{name:confirmName,exact:true})).toHaveCount(0);}
  await page.getByLabel('2案比較の保存結果JSON',{exact:true}).setInputFiles({name:'too-large.json',mimeType:'application/json',buffer:Buffer.alloc(cityGradingFileLimit+1,32)});await page.getByRole('button',{name:reviewName,exact:true}).click();await expect(page.getByRole('alert')).toContainText('8MiB');
  await page.getByLabel('2案比較の保存結果JSON',{exact:true}).setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{')});await page.getByRole('button',{name:reviewName,exact:true}).click();await expect(page.getByRole('alert')).toContainText('保存した比較を復元できません');
  await page.route('**/api/earthwork/linear-grading',async r=>{if(r.request().postDataJSON().conditions.target_elevation_m===99)await r.fulfill({status:503,json:{error:'比較案の照合API停止'}});else await r.continue();});
  await file(page,original);await page.getByRole('button',{name:reviewName,exact:true}).click();await expect(page.getByRole('alert')).toContainText('比較案の照合API停止');
  expect(JSON.parse(await download(page,'復元した比較JSONを保存'))).toEqual(original);expect(JSON.parse(await download(page,'切土・盛土の計算JSONを保存'))).toEqual(baseline);
});

test('changing file, cancelling either pending plan, confirming a footprint or replacing source cannot revive a comparison preview',async({page})=>{
  await load(page);const original=JSON.parse(await download(page,'断面積の比較JSONを保存'));let release:()=>void=()=>{},arrived:()=>void=()=>{},waiting=new Promise<void>(r=>{arrived=r;}),delayed=new Promise<void>(r=>{release=r;}),count=0;
  await page.route('**/api/earthwork/linear-grading',async r=>{const response=await r.fetch();if(++count===2)arrived();await delayed;try{await r.fulfill({response});}catch{/* both requests aborted */}});
  for(const action of ['file','cancel','footprint','source']){
    count=0;waiting=new Promise(r=>{arrived=r;});delayed=new Promise(r=>{release=r;});await file(page,original);await page.getByRole('button',{name:reviewName,exact:true}).click();await waiting;
    if(action==='file')await file(page,original,'replacement.json');if(action==='cancel')await page.getByRole('button',{name:'2案比較の点検を取消',exact:true}).click();
    if(action==='footprint')await page.getByRole('button',{name:'確認して施工範囲を表示',exact:true}).click();if(action==='source')await page.getByRole('button',{name:'合成都市デモを表示',exact:true}).click();
    release();await expect(page.getByRole('region',{name:'2案比較結果の復元確認',exact:true})).toHaveCount(0);await expect(page.getByRole('region',{name:'復元した2案比較の結果',exact:true})).toHaveCount(0);
    if(action==='footprint')await page.getByRole('button',{name:'反映済み範囲の地形断面を表示',exact:true}).click();
  }
});
