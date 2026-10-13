import {test,expect,type Page} from "@playwright/test";
import {readFile,mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
import type {CaptureDto} from "../../src/shared/capture-contract";

type Fixture={id:string;group:string;file:string;bytes:number;sha256:string;width?:number;height?:number};
type Manifest={quick:boolean;plannedMainCases:number;cases:Fixture[]};
type Attempt={id:string;status:"NOT_RUN"|"RUNNING"|"PASS"|"FAIL";stage:string;failureType?:string;observations:Record<string,unknown>};
type PhotoUploadWitness={originalFetch:typeof fetch;chunks:Map<number,Uint8Array>;uploads:Set<string>;pending:Promise<void>[];failed:boolean};
type WitnessWindow=Window&{__photoUploadWitness?:PhotoUploadWitness};
const attempt=(id:string):Attempt=>({id,status:"NOT_RUN",stage:"not-started",observations:{}});
function failActive(attempts:Attempt[],error:unknown){const kind=error instanceof Error&&error.name==="TimeoutError"?"TIMEOUT":error instanceof Error&&error.name==="AssertionError"?"ASSERTION_FAILED":"OPERATION_FAILED";for(const row of attempts)if(row.status==="RUNNING"){row.status="FAIL";row.failureType=kind;}return kind;}
const sha=(b:Buffer|string)=>createHash("sha256").update(b).digest("hex");
const origin={origin:"http://127.0.0.1:3210"};
const percentile=(values:number[],p:number)=>[...values].sort((a,b)=>a-b)[Math.ceil(p*values.length)-1];
function owned(){
  if(["DEBUG","PWDEBUG","NODE_DEBUG","NODE_DEBUG_NATIVE"].some(key=>process.env[key]))throw Error("Diagnostic network logging is prohibited for authenticated qualification");
  const run=process.env.HESTIA_TEST_RUN_ID,password=process.env.HESTIA_TEST_PASSWORD,phase=process.env.HESTIA_PHOTO_PHASE;
  if(process.env.HESTIA_ENVIRONMENT!=="local"||!/^hestia-app-[a-f0-9]{16}$/.test(run??"")||!password||!["before","after"].includes(phase??""))throw Error("Owned local runtime and explicit HESTIA_PHOTO_PHASE=before|after required");
  const directory=path.resolve(process.env.HESTIA_PHOTO_CORPUS??"artifacts/mobile-photos-corpus/main-r2");
  if(!directory.startsWith(path.resolve("artifacts/mobile-photos-corpus")+path.sep))throw Error("Only the owned synthetic corpus is accepted");
  return{run:run!,password,phase:phase!,directory};
}
async function corpus(){const env=owned(),bytes=await readFile(path.join(env.directory,"manifest.json")),manifest=JSON.parse(bytes.toString()) as Manifest;
  if(manifest.quick||manifest.cases.filter(c=>c.group==="main").length!==manifest.plannedMainCases||manifest.plannedMainCases<30)throw Error("The complete frozen corpus is required");
  return{...env,manifest,manifestSha256:sha(bytes)};
}
function candidate(){return JSON.parse(execFileSync(process.execPath,["--input-type=module","-e","import {captureCandidate} from './scripts/lib/verification-evidence.mjs'; const m=captureCandidate({root:process.cwd(),runId:'photo-measurement',phase:'before'}); console.log(JSON.stringify({commit:m.commit,sourceDigest:m.sourceDigest}));"],{encoding:"utf8",windowsHide:true}));}
async function login(page:Page,password:string){
  await page.addInitScript(()=>document.addEventListener("change",event=>{const input=event.target;if(input instanceof HTMLInputElement&&input.type==="file"&&input.hasAttribute("capture")&&input.files?.length){performance.clearResourceTimings();(window as unknown as {__photoFileAt:number}).__photoFileAt=performance.now();}},true));
  await page.goto("/");await page.getByLabel("Adresse e-mail").fill("camille@hestia.invalid");await page.getByLabel("Mot de passe",{exact:true}).fill(password);
  const signed=page.waitForResponse(r=>r.url().endsWith("/api/auth/sign-in/email"));await page.getByRole("button",{name:"Se connecter",exact:true}).click();expect((await signed).status()).toBe(200);
  await expect(page.getByRole("heading",{name:"Dossiers",exact:true})).toBeVisible();
}
async function take(page:Page,file:string,observation:Attempt,retainBytes=true){
  observation.stage="open-camera";
  await page.getByRole("button",{name:"Photo",exact:true}).click();
  const chosen=page.waitForEvent("filechooser");await page.getByRole("button",{name:"Prendre la première page",exact:true}).click();const chooser=await chosen;
  // Chromium's passive request event omits native Blob bodies. Observe only
  // these synthetic upload Blobs in memory; forward the exact fetch arguments
  // immediately, without awaiting the copy or intercepting network traffic.
  if(retainBytes)await page.evaluate(()=>{
    const target=window as WitnessWindow;
    if(target.__photoUploadWitness)throw Error("Photo upload witness already installed");
    const state:PhotoUploadWitness={originalFetch:window.fetch,chunks:new Map(),uploads:new Set(),pending:[],failed:false};target.__photoUploadWitness=state;
    window.fetch=function(input,init){
      const url=new URL(input instanceof Request?input.url:String(input),location.href),method=init?.method??(input instanceof Request?input.method:"GET");
      const match=/\/capture\/[^/]+\/pages\/([^/]+)\/chunks\/(\d+)$/.exec(url.pathname);
      if(url.origin===location.origin&&method==="PUT"&&match){
        const body=init?.body,index=Number(match[2]);state.uploads.add(match[1]);
        if(!(body instanceof Blob)||body.size>20*1024*1024||state.uploads.size!==1||state.pending.length>=1024||index>=1024)state.failed=true;
        else state.pending.push(body.arrayBuffer().then(buffer=>{
          const bytes=new Uint8Array(buffer),total=[...state.chunks].reduce((sum,[key,value])=>sum+(key===index?0:value.byteLength),bytes.byteLength);
          if(total>20*1024*1024)state.failed=true;else state.chunks.set(index,bytes);
        }).catch(()=>{state.failed=true;}));
      }
      return state.originalFetch.call(this,input,init);
    };
  });
  try{
    const reserved=page.waitForResponse(r=>/\/capture\/[^/]+\/pages$/.test(new URL(r.url()).pathname)&&r.request().method()==="POST");
    const completed=page.waitForResponse(r=>/\/pages\/[^/]+\/complete$/.test(new URL(r.url()).pathname)&&r.request().method()==="POST");
    observation.stage="select-and-upload";await chooser.setFiles(file);const reservation=await reserved;observation.observations.reservationStatus=reservation.status();expect(reservation.status()).toBe(200);observation.stage="complete-upload";
    const response=await completed;observation.observations.completionStatus=response.status();expect(response.status()).toBe(200);await response.finished();observation.stage="saved-visible";const capture=(await response.json()).capture as CaptureDto;
    await expect(page.getByText("Page sauvegardée.",{exact:true})).toBeVisible({timeout:120_000});
    observation.stage="saved-clock";const timing=await page.evaluate(()=>{const started=(window as unknown as {__photoFileAt:number}).__photoFileAt;if(!Number.isFinite(started))throw Error("File availability clock missing");return{durationMs:performance.now()-started,http:performance.getEntriesByType("resource").filter(e=>e.startTime>=started&&e.name.includes("/api/hestia/")).map(e=>{const r=e as PerformanceResourceTiming;return{path:new URL(r.name).pathname.replace(/[a-f0-9-]{36}/g,":id"),durationMs:r.duration,bodyBytes:r.encodedBodySize};})};});
    observation.observations.savedMs=timing.durationMs;observation.stage="saved-metadata";
    const identity=reservation.request().postDataJSON() as {size:number;sha256:string};
    expect(capture.pages).toHaveLength(1);expect(capture.pages[0].size).toBe(identity.size);
    observation.observations.reservedBytes=identity.size;observation.observations.reservedSha256=identity.sha256;observation.observations.savedDtoBytes=capture.pages[0].size;
    if(!retainBytes)return{capture,retained:null,identity,timing};
    observation.stage="upload-witness-read";
    const witness=await page.evaluate(async()=>{
      const state=(window as WitnessWindow).__photoUploadWitness;if(!state)throw Error("Photo upload witness missing");await Promise.all(state.pending);
      const indices=[...state.chunks.keys()].sort((a,b)=>a-b);
      return{failed:state.failed,uploadCount:state.uploads.size,indices,chunks:indices.map(index=>{const bytes=state.chunks.get(index)!;let binary="";for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));return btoa(binary);})};
    });
    observation.observations.uploadCount=witness.uploadCount;observation.observations.chunkCount=witness.indices.length;observation.observations.witnessReadFailed=witness.failed;observation.stage="upload-witness-identity";
    expect(witness.failed).toBe(false);expect(witness.uploadCount).toBe(1);expect(witness.indices).toEqual(witness.indices.map((_,i)=>i));
    const retained=Buffer.concat(witness.chunks.map(chunk=>Buffer.from(chunk,"base64")));
    observation.observations.retainedBytes=retained.length;observation.observations.reservedBytes=identity.size;observation.observations.retainedHashMatches=sha(retained)===identity.sha256;
    expect(retained.length).toBe(identity.size);expect(sha(retained)).toBe(identity.sha256);return{capture,retained,identity,timing};
  }finally{if(retainBytes)await page.evaluate(()=>{const target=window as WitnessWindow,state=target.__photoUploadWitness;if(state){window.fetch=state.originalFetch;state.chunks.clear();delete target.__photoUploadWitness;}}).catch(()=>{throw new Error("Photo upload witness cleanup failed; raw errors suppressed.");});}
}
async function getContent(page:Page,capture:CaptureDto,query:string){const chunks:Buffer[]=[];let offset=0,total=0;do{const response=await page.request.get(`/api/hestia/capture/${capture.id}/content?${query}&offset=${offset}&length=2097152`,{headers:{"X-Hestia-Activity":"passive"}});expect(response.status()).toBe(206);const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers()["content-range"]??"");expect(match).not.toBeNull();expect(Number(match![1])).toBe(offset);const bytes=await response.body();const nextTotal=Number(match![3]);expect(nextTotal).toBeLessThanOrEqual(20*1024*1024);if(total)expect(nextTotal).toBe(total);total=nextTotal;expect(bytes.length).toBe(Number(match![2])-offset+1);chunks.push(bytes);offset+=bytes.length;}while(offset<total);return Buffer.concat(chunks);}
async function finishReport(out:string,report:{harnessCandidate:unknown;status:string},extra:Record<string,unknown>={}){const after=candidate(),unchanged=JSON.stringify(after)===JSON.stringify(report.harnessCandidate);Object.assign(report,{...extra,harnessCandidateAfter:after,harnessCandidateUnchanged:unchanged});if(!unchanged)report.status="SOURCE_CHANGED";await writeFile(path.join(out,"result.json"),JSON.stringify(report,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({report:path.join(out,"result.json"),status:report.status}));expect(unchanged,"Sources must remain frozen throughout the observation").toBe(true);}
const reportDir=async(name:string)=>{const dir=path.join("artifacts/performance",`${name}-${Date.now()}-${randomUUID().slice(0,8)}`);await mkdir(dir,{recursive:true});return dir;};

test("Photos real API: frozen30-image corpus, exact retained bytes and cropped final PDF",async({page},info)=>{
  test.skip(!info.project.name.startsWith("performance-photos"),"Explicit synthetic photo qualification; no timing/quality claim in regular E2E.");
  const source=await corpus(),out=await reportDir(`photo-quality-${source.phase}`),identity=candidate();
  const fixtures=source.manifest.cases.filter(c=>["main","complement"].includes(c.group)),attempts=fixtures.map(c=>attempt(c.id));
  const results:{id:string;file:string;sha256:string;pdf?:string;pdfSha256?:string;sourceSha256:string;retainedBytes:number;status:string;fallback:boolean}[]=[];
  const report={kind:"real-local-camera-quality",phase:source.phase,harnessCandidate:identity,applicationIdentity:"NOT_PROVEN_BY_THIS_TEST; separate operator custody required",corpusSha256:source.manifestSha256,planned:33,plannedMain:30,cases:results,attempts,status:"INCOMPLETE",limits:["Camera File injected into the real picker; not a physical Pixel10 or Browser Use.","Exact outgoing synthetic upload Blobs are copied asynchronously in page memory (20MiB bound), outside the latency campaign; no auth bodies or headers logged. Quality-run timings are not used for latency claims.","PDFs are fetched through authenticated real API after crop; offline QR/raster/readability witnesses are separate."]};
  try{
    await login(page,source.password);
    for(const fixture of fixtures){
      const observation=attempts.find(a=>a.id===fixture.id)!;observation.status="RUNNING";observation.stage="verify-fixture";await writeFile(path.join(out,"progress.json"),JSON.stringify(report,null,2)+"\n");
      const file=path.join(source.directory,fixture.file);expect(sha(await readFile(file))).toBe(fixture.sha256);
      const result=await take(page,file,observation),retainedFile=fixture.id+"-retained.jpg";if(!result.retained)throw Error("Quality upload witness missing");await writeFile(path.join(out,retainedFile),result.retained,{flag:"wx"});
      const row={id:fixture.id,file:retainedFile,sha256:sha(result.retained),sourceSha256:fixture.sha256,retainedBytes:result.retained.length,status:"PARTIAL",fallback:sha(result.retained)===fixture.sha256,pdf:fixture.id+"-cropped.pdf",pdfSha256:""};results.push(row);
      let current=result.capture;observation.stage="derivative-witnesses";
      if(source.phase==="after")for(const variant of ["thumbnail","settings"]){const bytes=await getContent(page,current,`pageId=${current.pages[0].id}&variant=${variant}&pageVersion=${current.pages[0].version}`);await writeFile(path.join(out,`${fixture.id}-${variant}.jpg`),bytes,{flag:"wx"});}
      observation.stage="crop-and-prepare";const changed=await page.request.patch(`/api/hestia/capture/${current.id}`,{headers:origin,data:{version:current.version,title:`Synthetic quality ${fixture.id}`,format:"pdf",pages:current.pages.map(p=>({id:p.id,rotation:0,crop:{t:5,r:0,b:0,l:0}}))}});expect(changed.status()).toBe(200);current=(await changed.json()).capture;
      const prepared=await page.request.post(`/api/hestia/capture/${current.id}/prepare`,{headers:origin,data:{version:current.version}});expect(prepared.status()).toBe(200);const preparedResult=await prepared.json();current=preparedResult.capture;
      const pdf=await getContent(page,current,`artifactId=${preparedResult.artifact.id}`);expect(sha(pdf)).toBe(preparedResult.artifact.sha256);row.pdfSha256=sha(pdf);await writeFile(path.join(out,row.pdf),pdf,{flag:"wx"});
      observation.stage="abandon-own-draft";const abandoned=await page.request.delete(`/api/hestia/capture/${current.id}`,{headers:origin,data:{version:current.version}});expect(abandoned.status()).toBe(200);
      await page.goto("/");await expect(page.getByRole("heading",{name:"Dossiers",exact:true})).toBeVisible();row.status="PASS";observation.status="PASS";observation.stage="complete";
      await writeFile(path.join(out,"progress.json"),JSON.stringify(report,null,2)+"\n");
    }
    expect(results).toHaveLength(33);const reductions=results.filter(r=>source.manifest.cases.find(c=>c.id===r.id)!.group==="main").map(r=>1-r.retainedBytes/source.manifest.cases.find(c=>c.id===r.id)!.bytes).sort((a,b)=>a-b);const median=(reductions[14]+reductions[15])/2;
    Object.assign(report,{medianReduction:median,weightTargetMet:median>=.6,completed:results.length,status:"COMPLETE"});
  }catch(error){Object.assign(report,{failureType:failActive(attempts,error)});throw new Error("Synthetic photo qualification failed; see the bounded receipt. Raw transport errors are suppressed.");}finally{await finishReport(out,report,{completed:attempts.filter(a=>a.status==="PASS").length,failed:attempts.filter(a=>a.status==="FAIL").length,notRun:attempts.filter(a=>a.status==="NOT_RUN").length});}
});

test("Photos real API: JPEG saved and newly recorded one-page PDF visibly opened,5warm30samples",async({page},info)=>{
  test.skip(!info.project.name.startsWith("performance-photos"),"Explicit exclusive benchmark, not regular browser verification.");
  const source=await corpus(),out=await reportDir(`photo-latency-${source.phase}`),identity=candidate(),fixture=source.manifest.cases.find(c=>c.id==="main-01")!;
  const file=path.join(source.directory,fixture.file);expect(sha(await readFile(file))).toBe(fixture.sha256);
  const attempts=Array.from({length:35},(_,i)=>attempt(String(i)));
  const samples:{index:number;warmup:boolean;savedMs:number;thumbnailReadyMs:number;pdfPrepareMs:number;pdfOpenMs:number;uploadedBytes:number;uploadedSha256:string;http:unknown;status:string}[]=[];
  const report={kind:"real-local-photo-latency",phase:source.phase,harnessCandidate:identity,applicationIdentity:"NOT_PROVEN_BY_THIS_TEST; separate operator custody required",corpusSha256:source.manifestSha256,fixture:fixture.id,planned:35,warmup:5,samples,attempts,status:"INCOMPLETE",limits:["Local loopback, emulatedPixel7; not Dev, physicalPixel10 or Browser Use.","Saved begins at native input change with File available and ends after accepted completion plus visible saved state.","Latency copies no upload bodies and leaves fetch unwrapped: reserved size/hash and saved DTO size are metadata, not an independent byte audit. The quality campaign audits bytes separately.","Thumbnail readiness is a separate File-to-visible-and-decoded observation after savedMs is frozen, without a new acceptance threshold.","PDF opening starts at document row click and ends at canvas[data-rendered=true]; metadata alone is not success.","Preparation and human destination confirmation are separate; no AI call is used.","HTTP durations include server queues/DB/storage/validation and are not pure network latency. DB and object-storage costs are NON_ISOLATED. File-to-reservation includes conversion/hash/scheduling; IA is absent.","Automation observation adds IPC/locator overhead. No CPU or network throttling; clocks and window attribution are identical before/after.","p95 is a technical indicator, not a percentile specified by the human5s/3s target. Maximum and every failed/unfinished attempt stay visible."]};
  try{
    await login(page,source.password);const name=`Photo bench ${randomUUID().slice(0,8)}`;const created=await page.request.post("/api/hestia/folders",{headers:origin,data:{name,parentId:null,idempotencyKey:randomUUID()}});expect(created.status()).toBe(201);const folder=(await created.json()).folder;
    for(let index=0;index<35;index++){
      const observation=attempts[index];observation.status="RUNNING";observation.stage="camera";await writeFile(path.join(out,"progress.json"),JSON.stringify(report,null,2)+"\n");
      const photo=await take(page,file,observation,false);observation.stage="thumbnail-ready";
      const thumbnail=page.getByRole("list",{name:"Pages du document",exact:true}).getByRole("img",{name:"Page 1, ajustements appliqués",exact:true});
      await expect(thumbnail).toBeVisible({timeout:120_000});await expect.poll(()=>thumbnail.evaluate((image:HTMLImageElement)=>image.complete&&image.naturalWidth>0),{timeout:120_000}).toBe(true);
      const thumbnailReadyMs=await page.evaluate(()=>performance.now()-(window as unknown as {__photoFileAt:number}).__photoFileAt);observation.observations.thumbnailReadyMs=thumbnailReadyMs;observation.stage="title-and-prepare";await page.getByRole("button",{name:"Continuer",exact:true}).click();const title=`Photo bench ${String(index).padStart(2,"0")}`;await page.getByLabel("Titre du document").fill(title);
      const preparing=await page.evaluate(()=>performance.now());await page.getByRole("button",{name:"Choisir où ranger",exact:true}).click();await expect(page.getByRole("heading",{name:"Où ranger ce document ?",exact:true})).toBeVisible({timeout:120_000});const pdfPrepareMs=await page.evaluate(s=>performance.now()-s,preparing);observation.observations.pdfPrepareMs=pdfPrepareMs;observation.stage="choose-destination";
      await page.getByRole("button",{name:"Parcourir les dossiers",exact:true}).click();await page.getByRole("radio",{name:folder.name,exact:true}).click();await page.getByRole("button",{name:"Vérifier avant d’enregistrer",exact:true}).click();await expect(page.getByRole("heading",{name:"Qui pourra accéder au document",exact:true})).toBeVisible();
      const duplicate=page.getByLabel("Conserver quand même ce doublon",{exact:true});if(await duplicate.isVisible())await duplicate.check();await expect(page.getByRole("button",{name:"Enregistrer le document",exact:true})).toBeEnabled();
      observation.stage="record-document";await page.getByRole("button",{name:"Enregistrer le document",exact:true}).click();await expect(page.getByText("Enregistré.",{exact:true})).toBeVisible({timeout:120_000});await page.getByRole("button",{name:"Ouvrir le dossier",exact:true}).click();await expect(page.getByRole("heading",{name:folder.name,exact:true})).toBeVisible();
      observation.stage="open-recorded-pdf";const began=await page.evaluate(()=>{performance.clearResourceTimings();return performance.now();});await page.getByRole("main").getByRole("button",{name:new RegExp(`^${title}`)}).click();const detail=page.getByRole("complementary",{name:"Document",exact:true});await expect(detail.locator("canvas[data-rendered=true]")).toBeVisible({timeout:120_000});const pdfOpenMs=await page.evaluate(s=>performance.now()-s,began);
      observation.observations.pdfOpenMs=pdfOpenMs;observation.stage="close-pdf";samples.push({index,warmup:index<5,savedMs:photo.timing.durationMs,thumbnailReadyMs,pdfPrepareMs,pdfOpenMs,uploadedBytes:photo.identity.size,uploadedSha256:photo.identity.sha256,http:photo.timing.http,status:"PASS"});await detail.getByRole("button",{name:"Fermer",exact:true}).click();observation.status="PASS";observation.stage="complete";await writeFile(path.join(out,"progress.json"),JSON.stringify(report,null,2)+"\n");
    }
    const measured=samples.filter(s=>!s.warmup),summary=(key:"savedMs"|"thumbnailReadyMs"|"pdfOpenMs"|"pdfPrepareMs")=>({p50:percentile(measured.map(s=>s[key]),.5),p95:percentile(measured.map(s=>s[key]),.95),max:Math.max(...measured.map(s=>s[key]))});Object.assign(report,{saved:summary("savedMs"),thumbnailReady:summary("thumbnailReadyMs"),pdfOpen:summary("pdfOpenMs"),pdfPrepare:summary("pdfPrepareMs"),status:"COMPLETE"});
  }catch(error){Object.assign(report,{failureType:failActive(attempts,error)});throw new Error("Synthetic photo qualification failed; see the bounded receipt. Raw transport errors are suppressed.");}finally{await finishReport(out,report,{completed:attempts.filter(a=>a.status==="PASS").length,failed:attempts.filter(a=>a.status==="FAIL").length,notRun:attempts.filter(a=>a.status==="NOT_RUN").length});}
});

test("Archived originals real API: byte-identical image/PDF volumes and visible first page",async({page},info)=>{
  test.skip(!info.project.name.startsWith("performance-photos"),"Explicit archive benchmark; archived latency remains a separate result.");
  test.setTimeout(1_800_000);
  const env=owned(),directory=path.resolve(process.env.HESTIA_PHOTO_ARCHIVES??"artifacts/mobile-photos-corpus/archive-r2");
  if(!directory.startsWith(path.resolve("artifacts/mobile-photos-corpus")+path.sep))throw Error("Owned synthetic archives required");
  const manifestBytes=await readFile(path.join(directory,"manifest.json")),manifest=JSON.parse(manifestBytes.toString()) as {dataPolicy:string;cases:(Fixture&{mediaType:string;pages?:number})[]};expect(manifest.dataPolicy).toBe("synthetic-only");expect(manifest.cases.length).toBeGreaterThanOrEqual(20);
  const out=await reportDir(`archive-latency-${env.phase}`),identity=candidate();
  const attempts=manifest.cases.flatMap(c=>Array.from({length:35},(_,i)=>attempt(`${c.id}:${i}`))),setup=manifest.cases.map(c=>attempt(c.id));
  const records:{id:string;bytes:number;sha256:string;mediaType:string;pages?:number;samples:{index:number;warmup:boolean;durationMs:number;http:unknown}[];p50Ms?:number;p95Ms?:number;maxMs?:number}[]=[];
  const report={kind:"real-local-archive-latency",phase:env.phase,harnessCandidate:identity,applicationIdentity:"NOT_PROVEN_BY_THIS_TEST; separate operator custody required",corpusSha256:sha(manifestBytes),plannedCases:manifest.cases.length,warmup:5,samplesPerCase:30,cases:records,attempts,setup,status:"INCOMPLETE",limits:["Actual valid originals created through real upload/chunk/complete endpoints; bytes are never recompressed by this fixture setup.","Each image is decoded or first PDF canvas rendered before the timer ends; metadata alone does not qualify opening.","First open is retained among warmups, and each measured open follows a close. HTTP cache is governed by product; no fabricated warm cache.","Local loopback/emulated mobile only. Archived residual latency remains open even if new-camera targets pass.","All synthetic durable documents stay in the disposable owned harness until its owner performs its normal cleanup; no general delete endpoint is used."]};
  try{
    await login(page,env.password);const name=`Archive bench ${randomUUID().slice(0,8)}`;const created=await page.request.post("/api/hestia/folders",{headers:origin,data:{name,idempotencyKey:randomUUID()}});expect(created.status()).toBe(201);const folder=(await created.json()).folder;
    const docs:{fixture:typeof manifest.cases[number];title:string;id:string}[]=[];
    for(const fixture of manifest.cases){const setupRow=setup.find(a=>a.id===fixture.id)!;setupRow.status="RUNNING";setupRow.stage="archive-upload";await writeFile(path.join(out,"progress.json"),JSON.stringify(report,null,2)+"\n");const bytes=await readFile(path.join(directory,fixture.file));expect(sha(bytes)).toBe(fixture.sha256);expect(bytes.length).toBe(fixture.bytes);const title=`Archive ${fixture.id}`;
      const reserved=await page.request.post("/api/hestia/uploads",{headers:origin,data:{folderId:folder.id,idempotencyKey:randomUUID(),fileName:fixture.file,title,size:bytes.length,mediaType:fixture.mediaType,sha256:fixture.sha256,source:"import"}});expect(reserved.status()).toBe(201);const operation=(await reserved.json()).operation;
      for(let offset=0,index=0;offset<bytes.length;offset+=operation.chunkSize,index++){const sent=await page.request.put(`/api/hestia/uploads/${operation.id}/chunks/${index}`,{headers:{...origin,"content-type":"application/octet-stream"},data:bytes.subarray(offset,offset+operation.chunkSize)});expect(sent.status()).toBe(200);}
      const completed=await page.request.post(`/api/hestia/uploads/${operation.id}/complete`,{headers:origin,data:{keepDuplicate:false}});expect(completed.status()).toBe(200);const doc=(await completed.json()).document;expect(doc.sha256).toBe(fixture.sha256);expect(doc.size).toBe(fixture.bytes);docs.push({fixture,title,id:doc.id});setupRow.status="PASS";setupRow.stage="complete";
    }
    await writeFile(path.join(out,"dataset.json"),JSON.stringify({folderId:folder.id,documents:docs.map(d=>({id:d.id,fixtureId:d.fixture.id,sha256:d.fixture.sha256,bytes:d.fixture.bytes}))},null,2)+"\n",{flag:"wx"});
    await page.reload();await expect(page.getByRole("heading",{name:"Dossiers",exact:true})).toBeVisible();await page.locator("button.h-document-row").filter({has:page.getByText(folder.name,{exact:true})}).click();await expect(page.getByRole("heading",{name:folder.name,exact:true})).toBeVisible();
    for(const {fixture,title}of docs){const record={id:fixture.id,bytes:fixture.bytes,sha256:fixture.sha256,mediaType:fixture.mediaType,pages:fixture.pages,samples:[] as {index:number;warmup:boolean;durationMs:number;http:unknown}[],p50Ms:0,p95Ms:0,maxMs:0};records.push(record);
      for(let index=0;index<35;index++){const observation=attempts.find(a=>a.id===`${fixture.id}:${index}`)!;observation.status="RUNNING";observation.stage="open-archive";await writeFile(path.join(out,"progress.json"),JSON.stringify(report,null,2)+"\n");const began=await page.evaluate(()=>{performance.clearResourceTimings();return performance.now();});await page.getByRole("main").getByRole("button",{name:new RegExp(`^${title}(?:\\s|$)`)}).click();const detail=page.getByRole("complementary",{name:"Document",exact:true});
        if(fixture.mediaType==="application/pdf")await expect(detail.locator("canvas[data-rendered=true]").first()).toBeVisible({timeout:120_000});else{const image=detail.getByRole("img",{name:`Aperçu de ${title}`,exact:true});await expect(image).toBeVisible({timeout:120_000});await expect.poll(()=>image.evaluate((i:HTMLImageElement)=>i.complete&&i.naturalWidth>0),{timeout:120_000}).toBe(true);}
        const result=await page.evaluate(s=>({durationMs:performance.now()-s,http:performance.getEntriesByType("resource").filter(e=>e.startTime>=s&&e.name.includes("/api/hestia/")).map(e=>{const r=e as PerformanceResourceTiming;return{path:new URL(r.name).pathname.replace(/[a-f0-9-]{36}/g,":id"),durationMs:r.duration,bodyBytes:r.encodedBodySize};})}),began);observation.observations.durationMs=result.durationMs;observation.stage="close-archive";record.samples.push({index,warmup:index<5,...result});await detail.getByRole("button",{name:"Fermer",exact:true}).click();await expect(detail).toHaveCount(0);observation.status="PASS";observation.stage="complete";
      }
      const measured=record.samples.filter(s=>!s.warmup).map(s=>s.durationMs);record.p50Ms=percentile(measured,.5);record.p95Ms=percentile(measured,.95);record.maxMs=Math.max(...measured);await writeFile(path.join(out,"progress.json"),JSON.stringify(report,null,2)+"\n");
    }
    report.status="COMPLETE";
  }catch(error){Object.assign(report,{failureType:failActive([...setup,...attempts],error)});throw new Error("Synthetic photo qualification failed; see the bounded receipt. Raw transport errors are suppressed.");}finally{await finishReport(out,report,{completed:attempts.filter(a=>a.status==="PASS").length,failed:attempts.filter(a=>a.status==="FAIL").length,notRun:attempts.filter(a=>a.status==="NOT_RUN").length});}
});
