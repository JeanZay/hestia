import test from 'node:test';
import assert from 'node:assert/strict';
import {percentile,summarizeTimings,summarizeReduction} from './metrics.mjs';
const cases=Array.from({length:30},(_,i)=>({id:`case-${i}`,group:'main',bytes:1000,sha256:`sha-${i}`}));
const manifest={quick:false,plannedMainCases:30,cases};
const outputs=()=>cases.map(c=>({id:c.id,sourceSha256:c.sha256,retainedBytes:300,status:'PASS'}));
test('p95 includes the slow sample and never silently drops failed attempts',()=>{
  const result=summarizeTimings([...Array.from({length:29},()=>({status:'PASS',durationMs:10})),{status:'PASS',durationMs:9000},{status:'ERROR'}]);
  assert.equal(result.maxMs,9000);assert.equal(result.failed,1);assert.equal(result.planned,31);assert.equal(result.status,'INCOMPLETE');
  assert.equal(percentile([10,20,30,40,50],.95),50);
});
test('error and fallback stay in the fixed denominator; errors forbid a success claim',()=>{
  const results=outputs();results[0]={...results[0],status:'ERROR'};results[1]={...results[1],retainedBytes:1000,fallback:true};
  const report=summarizeReduction(manifest,results);assert.equal(report.planned,30);assert.equal(report.values[0].reduction,0);assert.equal(report.values[1].reduction,0);assert.equal(report.weightTargetMet,false);
});
test('missing case, changed source or a quick corpus cannot become the main benchmark',()=>{
  assert.throws(()=>summarizeReduction(manifest,outputs().slice(1)));
  const results=outputs();results[2].sourceSha256='changed';assert.throws(()=>summarizeReduction(manifest,results));
  assert.throws(()=>summarizeReduction({...manifest,quick:true},outputs()));
});
test('fallback and heavier outputs cannot silently misstate savings',()=>{
  const results=outputs();results[0].fallback=true;assert.throws(()=>summarizeReduction(manifest,results));
  results[0]={...results[0],fallback:false,retainedBytes:1001};assert.throws(()=>summarizeReduction(manifest,results));
  assert.equal(summarizeReduction(manifest,outputs()).weightTargetMet,true);
});
