import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { citySectionSnapshot } from '../src/citySectionCSV';
import { terrainSections } from '../src/citySections';
import { cityGradingConditions } from '../src/cityGrading';
import type { GradingRun } from '../src/cityGrading';
import { buildCityGradingReport } from '../src/cityGradingReport';
import { cityGradingFileLimit, inspectCityGradingArchive, verifyCityGradingArchive } from '../src/cityGradingRestore';
import type { CityModel } from '../src/cityModel';

const footprint = { east: 0, north: 0, width: 40, length: 30, elevation: 100 };
const vertex = (east: number, north: number) => [east, .1 * east + .2 * north, -north];
const model: CityModel = { crs: 'urn:doboku:crs:local-metre', origin: [0, 0, 100], bounds: { min: [-100, -30, -100], max: [100, 30, 100] }, lod: 1, polygonCount: 2,
  features: [{ id: 'plane', layer: 'terrain', triangleCount: 2, positions: [vertex(-100,-100),vertex(100,-100),vertex(100,100),vertex(-100,-100),vertex(100,100),vertex(-100,100)].flat() }] };
const input = { title: '合成平面', model, footprint, sources: [{ name: 'plane.gml', bytes: 25, sha256: 'a'.repeat(64) }], inspected_at: '2026-10-13T00:00:00Z',
  source_url: '', attribution: '合成例', usage_terms: 'テスト用', data_kind: 'synthetic' as const, dataset: null };
const sections = terrainSections(model,footprint), source = citySectionSnapshot(input,sections,'2026-10-13T00:30:00Z','2026-10-13T01:00:00Z');
function analyticRun(): GradingRun {
  const conditions = cityGradingConditions(sections,100);
  const areas = (axis:'east_west'|'south_north', area:number) => ({complete:true,known_length_m:conditions[axis].length_m,uncovered_length_m:0,ambiguous_length_m:0,unresolved_point_count:0,
    cut_area_m2:area,fill_area_m2:area,known_cut_area_m2:area,known_fill_area_m2:area,spans:conditions[axis].spans.map((v,i)=>({start_m:v.start_m,end_m:v.end_m,cut_area_m2:i?area:0,fill_area_m2:i?0:area,crossing_distance_m:null}))});
  return {engine_version:'0.2.0',model_version:'linear-profile-grading-1',executed_at:'2026-10-13T01:00:00Z',conditions,east_west:areas('east_west',20),south_north:areas('south_north',22.5),volume_m3:null};
}
function reordered(value:unknown):unknown {
  if(Array.isArray(value))return value.map(reordered);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reordered(v)]));
  return value;
}
test('saved grading matches source geometry and every numeric field while retaining historical time and tolerating object key order',()=>{
  const saved=buildCityGradingReport(source,analyticRun()).snapshot;
  const current={...source,generated_at:'2026-10-13T04:00:00Z',inspected_at:'2026-10-13T03:00:00Z',sections_inspected_at:'2026-10-13T03:30:00Z'};
  const archive=inspectCityGradingArchive(reordered(saved),current),fresh={...analyticRun(),executed_at:'2026-10-13T04:01:00Z'};
  const verified=verifyCityGradingArchive(archive,reordered(fresh));expect(verified.verifiedAt).toBe(fresh.executed_at);
  expect(buildCityGradingReport(verified.archive.source,verified.archive.run).snapshot).toEqual(saved);
  verified.archive.run.east_west.spans[0].cut_area_m2=999;expect(archive.run.east_west.spans[0].cut_area_m2).toBe(0);
  const bad=structuredClone(saved);bad.grading.east_west.cut_area_m2=21;bad.grading.east_west.known_cut_area_m2=21;bad.grading.east_west.spans[1].cut_area_m2=21;
  expect(()=>verifyCityGradingArchive(inspectCityGradingArchive(bad,current),fresh)).toThrow('数値');
  for(const change of [
    (v:typeof saved)=>{v.footprint.width=41;},(v:typeof saved)=>{v.sources[0].sha256='b'.repeat(64);},
    (v:typeof saved)=>{v.terrain_sections.sections[0].points[0].elevations[0]=99;},(v:typeof saved)=>{v.attribution='別出典';},
    (v:typeof saved)=>{v.generated_at='2026-02-30T00:00:00Z';},(v:typeof saved)=>{v.grading.executed_at='yesterday';}
  ]){const bad=structuredClone(saved);change(bad);expect(()=>inspectCityGradingArchive(bad,current)).toThrow();}
  const extras={...saved,unexpected:{volume_m3:200}};expect(()=>inspectCityGradingArchive(extras,current)).toThrow('項目');
  const engine={...fresh,engine_version:'different'};expect(()=>verifyCityGradingArchive(archive,engine)).toThrow('エンジン');
  expect(()=>inspectCityGradingArchive(null,current)).toThrow('JSON');
});

const xml = `<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:gml="http://www.opengis.net/gml" xmlns:dem="http://www.opengis.net/citygml/relief/2.0" srsName="urn:doboku:crs:local-metre" srsDimension="3"><core:cityObjectMember><dem:ReliefFeature gml:id="plane"><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>-100 -100 70 100 -100 90 100 100 130 -100 100 110 -100 -100 70</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></dem:ReliefFeature></core:cityObjectMember></core:CityModel>`;
async function loadPlane(page:Page){
  await page.getByLabel('CityGMLファイル',{exact:true}).setInputFiles({name:'plane.gml',mimeType:'application/xml',buffer:Buffer.from(xml)});
  await page.getByRole('button',{name:'CityGMLを点検・プレビュー',exact:true}).click();await page.getByRole('button',{name:'確認して都市モデルを表示',exact:true}).click();
  await profiles(page);
}
async function profiles(page:Page){await page.getByRole('button',{name:'確認して施工範囲を表示',exact:true}).click();await page.getByRole('button',{name:'反映済み範囲の地形断面を表示',exact:true}).click();}
async function saved(page:Page){const event=page.waitForEvent('download');await page.getByRole('button',{name:'切土・盛土の計算JSONを保存',exact:true}).click();return JSON.parse(await readFile((await(await event).path())!,'utf8'));}
async function file(page:Page,value:unknown,name='grading.json'){await page.getByLabel('切土・盛土の保存結果JSON',{exact:true}).setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});}
const reviewName='切土・盛土JSONを点検・Rustで照合';
const confirmName='確認して保存した切土・盛土結果を表示';

test('Yokohama saved partial results survive reload, require review and confirmation, keep original report time and preserve river storage',async({page,request})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const project=await(await request.get('/api/projects/sample-river')).json(),history=await(await request.get('/api/projects/sample-river/runs')).json();
  await page.goto('/?view=city');
  for(const label of ['施工範囲の幅 (m)','施工範囲の長さ (m)'])await page.getByLabel(label,{exact:true}).fill('200');await profiles(page);
  const target=page.getByLabel('断面積計算の計画標高 (m / 原データ基準)',{exact:true}),calc=page.getByRole('button',{name:'条件を確認して断面の切土・盛土を計算',exact:true});
  const result=page.getByRole('region',{name:'切土・盛土の計算結果',exact:true}),preview=page.getByRole('region',{name:'切土・盛土結果の復元確認',exact:true});
  await target.fill('0');await calc.click();await expect(result).toBeVisible();const original=await saved(page);
  expect(original.grading.east_west.complete).toBe(false);expect(original.grading.east_west.cut_area_m2).toBeNull();
  await page.reload();for(const label of ['施工範囲の幅 (m)','施工範囲の長さ (m)'])await page.getByLabel(label,{exact:true}).fill('200');await profiles(page);
  await target.fill('1');await calc.click();await expect(result).toBeVisible();const existing=await saved(page);
  await file(page,reordered(original));await page.getByRole('button',{name:reviewName,exact:true}).click();await expect(preview).toBeVisible();
  await expect(preview).toContainText(original.grading.executed_at);await expect(target).toHaveValue('1');expect(await saved(page)).toEqual(existing);
  await page.getByRole('button',{name:'保存結果の復元を取消',exact:true}).click();await expect(preview).toHaveCount(0);expect(await saved(page)).toEqual(existing);
  await page.getByRole('button',{name:reviewName,exact:true}).click();await expect(preview).toBeVisible();await page.getByRole('button',{name:confirmName,exact:true}).click();
  await expect(target).toHaveValue('0');await expect(page.getByRole('status',{name:'切土・盛土結果の復元状況',exact:true})).toBeVisible();
  expect(await saved(page)).toEqual(original);await expect(result.locator('[data-grading-summary="east_west"] td').first()).toHaveText('未算定');
  expect(await(await request.get('/api/projects/sample-river')).json()).toEqual(project);expect(await(await request.get('/api/projects/sample-river/runs')).json()).toEqual(history);
  expect(errors).toEqual([]);
});

test('foreign geometry, altered results, unsupported files and unavailable verification never replace current grading',async({page})=>{
  await page.goto('/?view=city');await loadPlane(page);await page.getByRole('button',{name:'条件を確認して断面の切土・盛土を計算',exact:true}).click();
  const result=page.getByRole('region',{name:'切土・盛土の計算結果',exact:true});await expect(result).toBeVisible();const original=await saved(page);
  const mutations=[(v:typeof original)=>{v.footprint.width=41;},(v:typeof original)=>{v.sources[0].sha256='b'.repeat(64);},
    (v:typeof original)=>{v.grading.east_west.cut_area_m2=21;v.grading.east_west.known_cut_area_m2=21;v.grading.east_west.spans[1].cut_area_m2=21;},
    (v:typeof original)=>{v.grading.engine_version='foreign';},(v:typeof original)=>{v.extra={volume_m3:200};}];
  for(const mutate of mutations){const bad=structuredClone(original);mutate(bad);await file(page,bad);await page.getByRole('button',{name:reviewName,exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('保存結果を復元できません');await expect(page.getByRole('button',{name:confirmName,exact:true})).toHaveCount(0);
    await expect(result.locator('[data-grading-summary="east_west"] td').first()).toHaveText('20 / 20');}
  await page.getByLabel('切土・盛土の保存結果JSON',{exact:true}).setInputFiles({name:'too-large.json',mimeType:'application/json',buffer:Buffer.alloc(cityGradingFileLimit+1,32)});
  await page.getByRole('button',{name:reviewName,exact:true}).click();await expect(page.getByRole('alert')).toContainText('8MiB');
  await page.getByLabel('切土・盛土の保存結果JSON',{exact:true}).setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{')});
  await page.getByRole('button',{name:reviewName,exact:true}).click();await expect(page.getByRole('alert')).toContainText('保存結果を復元できません');
  await page.route('**/api/earthwork/linear-grading',r=>r.fulfill({status:503,json:{error:'試験用照合API停止'}}));
  await file(page,original);await page.getByRole('button',{name:reviewName,exact:true}).click();await expect(page.getByRole('alert')).toContainText('試験用照合API停止');
  expect(await saved(page)).toEqual(original);
});

test('changed file, target, cancelled inspection and source replacement cannot revive an obsolete restore preview',async({page})=>{
  await page.goto('/?view=city');await loadPlane(page);await page.getByRole('button',{name:'条件を確認して断面の切土・盛土を計算',exact:true}).click();
  await expect(page.getByRole('region',{name:'切土・盛土の計算結果',exact:true})).toBeVisible();const original=await saved(page);await file(page,original);
  let release:()=>void=()=>{},arrived:()=>void=()=>{};
  let waiting=new Promise<void>(resolve=>{arrived=resolve;});let delayed=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/earthwork/linear-grading',async route=>{const response=await route.fetch();arrived();await delayed;try{await route.fulfill({response});}catch{/* cancelled request */}});
  const review=page.getByRole('button',{name:reviewName,exact:true}),preview=page.getByRole('region',{name:'切土・盛土結果の復元確認',exact:true});
  for(const action of ['file','target','cancel','source']){
    waiting=new Promise(resolve=>{arrived=resolve;});delayed=new Promise(resolve=>{release=resolve;});await file(page,original);await review.click();await waiting;
    if(action==='file')await file(page,original,'replacement.json');
    if(action==='target')await page.getByLabel('断面積計算の計画標高 (m / 原データ基準)',{exact:true}).fill('99');
    if(action==='cancel')await page.getByRole('button',{name:'保存結果の点検を取消',exact:true}).click();
    if(action==='source')await page.getByRole('button',{name:'合成都市デモを表示',exact:true}).click();
    release();await expect(preview).toHaveCount(0);await expect(page.getByRole('button',{name:confirmName,exact:true})).toHaveCount(0);
  }
  await profiles(page);await expect(page.getByRole('button',{name:'切土・盛土の計算JSONを保存',exact:true})).toBeDisabled();
});
