export function percentile(values, rank) {
  if (!values.length || values.some(v => !Number.isFinite(v) || v < 0) || rank <= 0 || rank > 1) throw Error('Invalid sample set');
  return [...values].sort((a,b)=>a-b)[Math.ceil(values.length*rank)-1];
}
export function summarizeTimings(attempts) {
  if (!attempts.length) throw Error('No attempts');
  const complete=attempts.filter(a=>a.status==='PASS');
  const values=complete.map(a=>a.durationMs);
  if (values.some(v=>!Number.isFinite(v)||v<0))throw Error('Invalid duration');
  return {planned:attempts.length,completed:complete.length,failed:attempts.length-complete.length,
    p50Ms:values.length?percentile(values,.5):null,p95Ms:values.length?percentile(values,.95):null,maxMs:values.length?Math.max(...values):null,
    status:complete.length===attempts.length?'COMPLETE':'INCOMPLETE'};
}
export function summarizeReduction(manifest, results) {
  const main=manifest.cases.filter(c=>c.group==='main');
  if(manifest.quick||main.length!==manifest.plannedMainCases||new Set(main.map(c=>c.id)).size!==main.length)throw Error('Incomplete or ambiguous primary corpus');
  if(results.length!==main.length||new Set(results.map(c=>c.id)).size!==results.length)throw Error('Each planned main case needs one result');
  const values=main.map(source=>{
    const result=results.find(r=>r.id===source.id);
    if(!result||!Number.isSafeInteger(source.bytes)||source.bytes<=0||result.sourceSha256!==source.sha256)throw Error('Missing or changed source');
    if(result.status==='ERROR')return {id:source.id,reduction:0,status:'ERROR'};
    if(!Number.isSafeInteger(result.retainedBytes)||result.retainedBytes<=0)throw Error('Invalid output size');
    if(result.fallback&&result.retainedBytes!==source.bytes)throw Error('Fallback changed bytes');
    if(result.retainedBytes>source.bytes)throw Error('Heavier conversion was retained');
    return {id:source.id,reduction:1-result.retainedBytes/source.bytes,status:result.status};
  });
  const sorted=values.map(v=>v.reduction).sort((a,b)=>a-b), n=sorted.length;
  const median=n%2?sorted[Math.floor(n/2)]:(sorted[n/2-1]+sorted[n/2])/2;
  const failures=values.filter(v=>v.status!=='PASS').length;
  return {planned:n,failures,medianReduction:median,weightTargetMet:failures===0&&median>=.6,quality:'NOT_ASSESSED',values};
}
