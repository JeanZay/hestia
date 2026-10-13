// Explicit three-phase HTTP rehearsal; root owns the exclusive synthetic runtime.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {request} from '@playwright/test';
import sharp from 'sharp';
const hash=b=>createHash('sha256').update(b).digest('hex');
const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1];
const phase=option('--phase'),out=option('--out');
if(!args.includes('--phase')||!['prime','legacy','return'].includes(phase)||!args.includes('--out'))throw Error('Use --phase prime|legacy|return --out new-evidence.json [--previous evidence.json]');
if(['DEBUG','PWDEBUG','NODE_DEBUG','NODE_DEBUG_NATIVE'].some(key=>process.env[key]))throw Error('Diagnostic network logging is prohibited for authenticated qualification');
const runId=process.env.HESTIA_TEST_RUN_ID,password=process.env.HESTIA_TEST_PASSWORD;
if(process.env.HESTIA_ENVIRONMENT!=='local'||!/^hestia-app-[a-f0-9]{16}$/.test(runId??'')||!password)throw Error('Owned local synthetic runtime required');
const output=path.resolve(out),root=path.resolve('artifacts');
if(!output.startsWith(root+path.sep))throw Error('Evidence must remain under local artifacts');
try{await stat(output);throw Error('Refusing existing output before any HTTP effect');}catch(error){if(error.code!=='ENOENT')throw error;}
const priorBytes=phase==='prime'?null:await readFile(option('--previous'));
const prior=priorBytes?JSON.parse(priorBytes.toString()):null;
if(prior&&(prior.runId!==runId||prior.phase!==(phase==='legacy'?'prime':'legacy')||prior.status!=='PASS'||prior.protocolRevision!==5))throw Error('Wrong predecessor/runtime/protocol');
const receipt={kind:'local-real-http-rollback-phase',protocolRevision:5,phase,runId,previousSha256:priorBytes?hash(priorBytes):null,createdAtUtc:new Date().toISOString(),status:'RUNNING',stage:'initialization',expectedLegacyHead:'d8caeaff941de1d563fa65baba06dd20e3aa2b96',runtimeIdentity:'OWNER_MUST_BIND_EACH_RUNNING_BUILD',scenarios:prior?structuredClone(prior.scenarios):{},checks:[],limits:['Real API and objects, not in-process mocks.','Root must bind running builds N / exact d8 N-1 / N and the same exclusive owned DB/S3; no identity is inferred from this checkout.','Source DTO does not expose its SHA or raw bytes. Source integrity, object ledger, quotas and physical purge require the separate scoped SQL/S3 audit.','No family/distant data. Only this receipt\u2019s synthetic captures are mutated.','A phase PASS alone is not a complete rollback qualification.']};
await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
const persist=()=>writeFile(output,JSON.stringify(receipt,null,2)+'\n');
const view=c=>({id:c.id,version:c.version,state:c.state,title:c.title,format:c.format,pages:c.pages.map(p=>({id:p.id,version:p.version,width:p.width,height:p.height,size:p.size,rotation:p.rotation,crop:p.crop}))});
let api;
async function json(method,url,body,status=200){const response=await api.fetch(url,{method,data:body});assert.equal(response.status(),status,'Unexpected HTTP status');return response.json();}
async function readCapture(id){return(await json('GET',`/api/hestia/capture/${id}`)).capture;}
async function fixture(label,width,height,color){return sharp({create:{width,height,channels:3,background:color}}).composite([{input:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="80" y="80" width="400" height="300" fill="white"/><path d="M100 100 L430 300 L150 330Z" fill="black"/><text x="90" y="430" font-size="40">SYNTHETIC ${label}</text></svg>`)}]).png().toBuffer();}
async function upload(scenario,label,width,height,color,replacePageId){
 const bytes=await fixture(label,width,height,color),source={pageId:null,sha256:hash(bytes),size:bytes.length,width,height,label,reservationKey:randomUUID(),replacePageId:replacePageId??null};scenario.sources.push(source);receipt.stage=`${scenario.name}:reserve-${label}`;await persist();
 const c=await readCapture(scenario.capture.id),body={version:c.version,idempotencyKey:source.reservationKey,fileName:`synthetic-${label}.png`,mediaType:'image/png',size:bytes.length,sha256:source.sha256};if(replacePageId)body.replacePageId=replacePageId;
 const reserved=await json('POST',`/api/hestia/capture/${c.id}/pages`,body);source.pageId=reserved.upload.id;await persist();
 for(let offset=0,index=0;offset<bytes.length;offset+=reserved.upload.chunkSize,index++){const response=await api.put(`/api/hestia/capture/${c.id}/pages/${reserved.upload.id}/chunks/${index}`,{headers:{'content-type':'application/octet-stream'},data:bytes.subarray(offset,offset+reserved.upload.chunkSize)});assert.equal(response.status(),200);}
 const completed=await json('POST',`/api/hestia/capture/${c.id}/pages/${reserved.upload.id}/complete`,{version:reserved.captureVersion});scenario.capture=view(completed.capture);assert.ok(scenario.capture.pages.some(p=>p.id===source.pageId));await persist();return source;
}
async function content(c,p,variant){const chunks=[];let offset=0,total;
 do{const response=await api.get(`/api/hestia/capture/${c.id}/content?pageId=${p.id}${variant?`&variant=${variant}&pageVersion=${p.version}`:''}&offset=${offset}&length=2097152`);assert.equal(response.status(),206);const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers()['content-range']??'');assert.ok(range);assert.equal(Number(range[1]),offset);const bytes=await response.body();assert.equal(bytes.length,Number(range[2])-offset+1);total??=Number(range[3]);assert.equal(Number(range[3]),total);assert.ok(total<=20*1024*1024);chunks.push(bytes);offset+=bytes.length;}while(offset<total);
 const bytes=Buffer.concat(chunks),meta=await sharp(bytes).metadata();return{sha256:hash(bytes),bytes:bytes.length,width:meta.width,height:meta.height};}
async function variants(c,p){const found={};for(const variant of ['thumbnail','settings']){const v=await content(c,p,variant);assert.equal(Math.max(v.width,v.height),variant==='thumbnail'?640:1600);found[variant]=v;}return found;}
async function denied(captureId,pageId,version,status){const result=await api.get(`/api/hestia/capture/${captureId}/content?pageId=${pageId}&variant=thumbnail&pageVersion=${version}&offset=0&length=2097152`);assert.equal(result.status(),status);return result.status();}
async function patch(scenario,pages){const c=await readCapture(scenario.capture.id);const result=await json('PATCH',`/api/hestia/capture/${c.id}`,{version:c.version,title:c.title,format:c.format,pages});scenario.capture=view(result.capture);await persist();return result.capture;}
try{
 api=await request.newContext({baseURL:'http://127.0.0.1:3210',extraHTTPHeaders:{origin:'http://127.0.0.1:3210'},ignoreHTTPSErrors:false});receipt.stage='login';await persist();await json('POST','/api/auth/sign-in/email',{email:'camille@hestia.invalid',password});
 if(phase==='prime'){
  for(const name of ['adjust','replace','remove','abandon']){const scenario={name,captureCreationKey:randomUUID(),capture:null,sources:[],prime:{}};receipt.scenarios[name]=scenario;receipt.stage=`${name}:create`;await persist();scenario.capture=view((await json('POST','/api/hestia/capture',{kind:'camera',idempotencyKey:scenario.captureCreationKey,currentFolderId:null},201)).capture);await persist();
   await upload(scenario,`${name}-original`,2400,1800,{r:220,g:230,b:240});if(name==='remove')await upload(scenario,'remove-survivor',2000,2400,{r:225,g:245,b:210});
   const c=await readCapture(scenario.capture.id);for(const p of c.pages){receipt.stage=`${name}:prime-derivatives`;scenario.prime[p.id]=await variants(c,p);await persist();}scenario.capture=view(c);
   if(name==='adjust'){scenario.legacy=await content(c,c.pages[0]);assert.equal(Math.max(scenario.legacy.width,scenario.legacy.height),2400);}
  }
  receipt.checks.push('N generated dedicated640/1600 for all five source pages, across adjustment/replacement/removal/abandonment scenarios');
 }else if(phase==='legacy'){
  const a=receipt.scenarios.adjust,c=await readCapture(a.capture.id);const changed=await patch(a,c.pages.map(p=>({id:p.id,rotation:90,crop:{t:0,r:0,b:0,l:10}})));a.legacy=await content(changed,changed.pages[0]);assert.equal(a.legacy.width,1620);assert.equal(a.legacy.height,2400);
  const r=receipt.scenarios.replace;r.oldPageId=r.sources[0].pageId;const replaced=await upload(r,'replacement-distinct',1800,2400,{r:245,g:190,b:170},r.oldPageId);r.newPageId=replaced.pageId;assert.notEqual(r.newPageId,r.oldPageId);assert.deepEqual(r.capture.pages.map(p=>p.id),[r.newPageId]);r.legacy=await content(await readCapture(r.capture.id),r.capture.pages[0]);
  const removed=receipt.scenarios.remove;removed.removedId=removed.sources[0].pageId;removed.survivorId=removed.sources[1].pageId;const before=await readCapture(removed.capture.id);await patch(removed,before.pages.filter(p=>p.id===removed.survivorId).map(p=>({id:p.id,rotation:p.rotation,crop:p.crop})));assert.deepEqual(removed.capture.pages.map(p=>p.id),[removed.survivorId]);
  const abandoned=receipt.scenarios.abandon;const current=await readCapture(abandoned.capture.id);abandoned.capture=view((await json('DELETE',`/api/hestia/capture/${current.id}`,{version:current.version})).capture);assert.equal(abandoned.capture.state,'abandoned');
  receipt.checks.push('Exact N-1 APIs performed crop/rotation, replacement with a distinct source, page removal preserving another source, and capture abandonment');
 }else{
  for(const name of ['adjust','replace','remove']){const s=receipt.scenarios[name];const c=await readCapture(s.capture.id);s.capture=view(c);s.returned={};receipt.stage=`${name}:return-check`;
   if(name==='adjust'){const p=c.pages[0];s.returned[p.id]=await variants(c,p);for(const v of ['thumbnail','settings']){const value=s.returned[p.id][v];assert.ok(Math.abs(value.width/value.height-1620/2400)<.003);assert.notEqual(value.sha256,s.prime[p.id][v].sha256);}s.staleStatus=await denied(c.id,p.id,p.version-1,409);const legacy=await content(c,p);assert.equal(legacy.sha256,s.legacy.sha256);}
   if(name==='replace'){assert.deepEqual(c.pages.map(p=>p.id),[s.newPageId]);const p=c.pages[0];assert.equal(p.width,1800);assert.equal(p.height,2400);s.returned[p.id]=await variants(c,p);for(const v of ['thumbnail','settings'])assert.notEqual(s.returned[p.id][v].sha256,s.prime[s.oldPageId][v].sha256);s.oldPageStatus=await denied(c.id,s.oldPageId,1,404);}
   if(name==='remove'){assert.deepEqual(c.pages.map(p=>p.id),[s.survivorId]);const p=c.pages[0];s.returned[p.id]=await variants(c,p);for(const v of ['thumbnail','settings'])assert.equal(s.returned[p.id][v].sha256,s.prime[s.survivorId][v].sha256);s.removedPageStatus=await denied(c.id,s.removedId,1,404);}
   await persist();
  }
  const s=receipt.scenarios.abandon;s.closedStatus=await denied(s.capture.id,s.sources[0].pageId,1,410);const unavailable=await api.get(`/api/hestia/capture/${s.capture.id}`);assert.equal(unavailable.status(),410);
  receipt.checks.push('N rebuilds adjusted/replaced derivatives; old/removed pages404, abandoned capture410; untouched survivor derivatives stay byte-identical');
 }
 const a=receipt.scenarios.adjust;receipt.capture=a.capture;receipt.sourceSha256=a.sources[0].sha256;receipt.prime=a.prime[a.sources[0].pageId];receipt.legacy=a.legacy;receipt.stage='complete';receipt.status='PASS';
}catch(error){receipt.status='FAIL';receipt.failure=error instanceof assert.AssertionError?'ASSERTION_FAILED':error?.name==='TimeoutError'?'TIMEOUT':'OPERATION_FAILED';throw new Error('Synthetic rollback phase failed; see the bounded receipt. Raw transport errors are suppressed.');}
finally{try{await api?.dispose();}catch{receipt.status='FAIL';receipt.cleanupFailure='CONTEXT_DISPOSE_FAILED';}await persist();if(receipt.cleanupFailure)throw new Error('Synthetic rollback context cleanup failed; see the bounded receipt.');}
