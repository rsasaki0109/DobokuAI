import { useEffect, useRef, useState } from 'react';
import CityGradingSweepView from './CityGradingSweepView';
import CityGradingComparisonView from './CityGradingComparisonView';
import { buildCityGradingSweepReport, parseGradingTargets } from './cityGradingSweep';
import { buildCityGradingComparisonReport, gradingComparison } from './cityGradingComparison';
import { cityGradingConditions, requestCityGrading } from './cityGrading';
import type { GradingRun } from './cityGrading';
import type { citySectionSnapshot } from './citySectionCSV';
import { saveBlob } from './types';

export default function CityGradingSweep({source,baseline}:{source:ReturnType<typeof citySectionSnapshot>;baseline:GradingRun}){
  const initial=()=>[baseline.conditions.target_elevation_m-1,baseline.conditions.target_elevation_m,baseline.conditions.target_elevation_m+1].filter(h=>Math.abs(h)<=12000).join(', ');
  const [text,setText]=useState(initial),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[error,setError]=useState(''),[selection,setSelection]=useState<number|null>(null);
  const [result,setResult]=useState<{source:typeof source;baseline:GradingRun;text:string;report:ReturnType<typeof buildCityGradingSweepReport>}|null>(null);
  const revision=useRef(0),controller=useRef<AbortController|null>(null);
  const cancel=()=>{revision.current++;controller.current?.abort();setBusy(false);setProgress(0);setError('');setResult(null);setSelection(null);};
  useEffect(()=>{cancel();setText(initial());return()=>{revision.current++;controller.current?.abort();};},[source,baseline]);
  let targets:number[]=[],validation='';try{targets=parseGradingTargets(text);}catch(e){validation=(e as Error).message;}
  const current=result?.source===source&&result.baseline===baseline&&result.text===text?result.report:null;
  const selected=current?.snapshot.sweep.outcomes.find(o=>o.status==='calculated'&&o.target_elevation_m===selection);
  const detail=current&&selected?.status==='calculated'?buildCityGradingComparisonReport(source,baseline,selected.run,current.snapshot.generated_at):null;
  const save=(report:NonNullable<typeof current>|NonNullable<typeof detail>,format:'html'|'csv'|'json',name:string)=>saveBlob(new Blob([format==='json'?JSON.stringify(report.snapshot,null,2):report[format]],{type:format==='html'?'text/html;charset=utf-8':format==='csv'?'text/csv;charset=utf-8':'application/json'}),`${name}.${format}`);
  return <section className="city-review" role="region" aria-label="複数標高の断面積比較">
    <h3>複数の計画標高をまとめて比較</h3><p>基準案 {baseline.conditions.target_elevation_m} mと同じ原断面で、最大9個の水平計画標高を順にRustで計算します。入力した順に全ケースを記録します。</p>
    <label className="field">比較する計画標高 (m / 原データ基準)<textarea aria-label="比較する計画標高 (m / 原データ基準)" rows={2} maxLength={2048} value={text} onChange={e=>{cancel();setText(e.target.value);}}/></label>
    <p className="muted">例：-1, 0, 1。半角カンマか改行で区切り、重複なし・1〜9個・±12000mで指定してください。</p>
    {validation&&<p role="alert">{validation}</p>}
    <button type="button" className="primary" disabled={!!validation||busy} onClick={async()=>{
      cancel();const version=revision.current,abort=new AbortController();controller.current=abort;setBusy(true);
      try{
        const outcomes:unknown[]=[];
        for(let i=0;i<targets.length;i++){
          if(version!==revision.current||abort.signal.aborted)return;
          try{
            const run=await requestCityGrading(cityGradingConditions(source.terrain_sections.sections,targets[i]),abort.signal);
            // Validate the case against the baseline before recording success.
            gradingComparison(source,baseline,run);
            outcomes.push({status:'calculated',target_elevation_m:targets[i],run});
          }catch(e){if(version!==revision.current||abort.signal.aborted)return;outcomes.push({status:'failed',target_elevation_m:targets[i],error:((e as Error).message||'計算失敗').slice(0,4096)});}
          if(version!==revision.current||abort.signal.aborted)return;setProgress(i+1);
        }
        const report=buildCityGradingSweepReport(source,baseline,targets,outcomes);
        if(version===revision.current)setResult({source,baseline,text,report});
      }catch(e){if(version===revision.current&&!abort.signal.aborted)setError((e as Error).message);}
      finally{if(version===revision.current)setBusy(false);}
    }}>{busy?`Rustで標高ケースを計算中… ${progress}/${targets.length}`:'標高一覧を確認して断面積を比較'}</button>
    {busy&&<button type="button" className="secondary" onClick={cancel}>複数標高の比較を取消</button>}{error&&<p role="alert">複数標高を比較できません：{error}</p>}
    <div className="city-actions">{(['html','csv','json'] as const).map(format=><button key={format} type="button" className="secondary" disabled={!current} onClick={()=>current&&save(current,format,'doboku-city-grading-sweep')}>複数標高の比較{format.toUpperCase()}を保存</button>)}</div>
    {current&&<div role="region" aria-label="複数標高の比較結果"><CityGradingSweepView sweep={current.snapshot.sweep} onSelect={setSelection}/></div>}
    {detail&&<div role="region" aria-label="複数標高の選択案詳細"><h4>選択した標高 {selection} mの断面比較</h4><CityGradingComparisonView sections={source.terrain_sections.sections} comparison={detail.snapshot.comparison}/>
      <div className="city-actions">{(['html','csv','json'] as const).map(format=><button key={format} type="button" className="secondary" onClick={()=>save(detail,format,'doboku-city-grading-comparison')}>選択した標高の比較{format.toUpperCase()}を保存</button>)}</div><button type="button" className="secondary" onClick={()=>setSelection(null)}>選択案の詳細を閉じる</button></div>}
    <p className="muted">失敗した標高は理由を記録し、次の標高を計算します。取消・入力編集・基準案/断面変更では結果を無効にします。成功した点だけを表示し、未知の全長は未算定。土量・施工可否・工期・費用は未算定。複数標高JSONの読込み復元・DB保存は未対応です。</p>
  </section>;
}
