"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { CaptureArtifactDto, CaptureDestination, CaptureDto, CaptureFinalizeInput, CaptureOperationDto, CapturePageDto, CapturePreviewDto, ClassificationAnalysisDto, ClassificationResultDto } from "../../shared/capture-contract";
import { Banner, Button, Checkbox, Dialog, EmptyState, Icon, PageHeader, RadioGroup, TextField } from "./design-system";
import { StatusPill, StepHeader } from "./family-ui";
import { PickRow } from "./move-design";
import type { TreeFolder } from "./folder-tree";
import { captureRequest, CaptureError, uploadCapturePage, registerCaptureClientWork, type PendingPage } from "./capture-client";
import { cameraNormalizer } from "./camera-normalize";
import { capturePreviews } from "./capture-preview-cache";
import { CaptureCropStepper, CaptureIconButton, CapturePageTile } from "./capture-pages";
import { hasNativeCamera, isNativePickerOpen, requestCaptureFlow, type CaptureResult } from "./native-capture";
import { CaptureDestinations, capturePathDrafts, type CapturePathDraft } from "./capture-destinations";
import { CapturePathPlan, type CapturePathSegment } from "./capture-path-plan";
import { CaptureComment, type CaptureCommentHandle, type CommentSaved } from "./capture-comment";
import "./capture.css";

type Step="pages"|"title"|"destination"|"review";
type Notice={title:string;text?:string;tone?:"info"|"warning"|"danger"|"success"};
export type CapturePendingFinal={userId:string;captureId:string;body:CaptureFinalizeInput;capture:CaptureDto;preview:CapturePreviewDto};
const expiry=(c:CaptureDto)=>new Date(c.expiresAt).toLocaleString("fr-FR");
const allowed=(f:TreeFolder|undefined,create=false)=>!!f&&f.capabilities.includes("consulter")&&f.capabilities.includes("déposer")&&(!create||f.capabilities.includes("modifier"));
const folderLabel=(f:TreeFolder)=>f.breadcrumbs.map(p=>p.name).join(" / ")||f.name;

export function CaptureWorkspace({userId,privacyEpoch,folders:providedFolders,currentFolderId,mode="photo",initial,pendingRef,onConsumed,onClose,onDone,onCommitted,onMutationStart,onAccessLost}:{userId:string;privacyEpoch:number;folders:TreeFolder[];currentFolderId:string|null;mode?:"photo"|"drafts";initial?:CaptureResult|null;pendingRef:RefObject<CapturePendingFinal|null>;onConsumed:()=>void;onClose:()=>void;onDone:(folderId:string)=>void;onCommitted:()=>Promise<boolean>;onMutationStart:()=>void;onAccessLost:()=>void}) {
  const [refreshedFolders,setRefreshedFolders]=useState<TreeFolder[]|null>(null);
  const folders=refreshedFolders??providedFolders;
  const [pathDrafts,setPathDrafts]=useState<CapturePathDraft[]>([]);
  const [capture,setCapture]=useState<CaptureDto|null>(null),[drafts,setDrafts]=useState<CaptureDto[]>([]),[step,setStep]=useState<Step>("pages");
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[notice,setNotice]=useState<Notice|null>(null),[camera,setCamera]=useState(false);
  const [title,setTitle]=useState(""),[format,setFormat]=useState<"pdf"|"image"|"original">("pdf"),[editPage,setEditPage]=useState<string|null>(null);
  const [pending,setPending]=useState<PendingPage|null>(null),[progress,setProgress]=useState(0),[artifact,setArtifact]=useState<CaptureArtifactDto|null>(null);
  const [destination,setDestination]=useState<CaptureDestination|null>(null),[browse,setBrowse]=useState(false),[parent,setParent]=useState<string|null>(null);
  const [suggestions,setSuggestions]=useState<ClassificationResultDto|null>(null),[analyzing,setAnalyzing]=useState(false),[late,setLate]=useState(false);
  const [emptyFeedback,setEmptyFeedback]=useState(false);
  const commentHandle=useRef<CaptureCommentHandle|null>(null), destinationSource=useRef<"manual"|"suggested"|null>(null);
  const [commentValid,setCommentValid]=useState(true),[commentPresent,setCommentPresent]=useState(false),[commentChanged,setCommentChanged]=useState(false);
  const [preview,setPreview]=useState<CapturePreviewDto|null>(null),[keepDuplicate,setKeepDuplicate]=useState(false),[uncertain,setUncertain]=useState(false),[abandon,setAbandon]=useState<CaptureDto|null>(null);
  const controller=useRef<AbortController|null>(null),current=useRef<CaptureDto|null>(null),running=useRef(false),analysisEpoch=useRef(0),choiceEpoch=useRef(0),seen=useRef(new Set<string>()),heading=useRef<HTMLDivElement>(null);
  const [stale,setStale]=useState(false),[expiredId,setExpiredId]=useState<string|null>(null);
  const [done,setDone]=useState<{folderId:string;title:string}|null>(null);
  const createKey=useRef(crypto.randomUUID());
  const accept=(value:CaptureDto)=>{if(current.current?.id!==value.id){setExpiredId(null);setCommentValid(true);setCommentPresent(!!value.comment);setCommentChanged(false);}if(current.current&&current.current.id!==value.id)capturePreviews.invalidateCapture(current.current.id);capturePreviews.reconcile(userId,privacyEpoch,value);current.current=value;setCapture(value);setTitle(value.title);setFormat(value.format);};
  const resetDerived=()=>{destinationSource.current=null;setArtifact(null);setPreview(null);setSuggestions(null);setEmptyFeedback(false);setPathDrafts([]);setDestination(null);setKeepDuplicate(false);analysisEpoch.current++;setAnalyzing(false);choiceEpoch.current++;};
  function fail(error:unknown) {
    if(controller.current?.signal.aborted)return;
    if(error instanceof CaptureError&&[401,403].includes(error.status)){capturePreviews.revoke();cameraNormalizer.clear();onAccessLost();return;}
    if(error instanceof CaptureError&&[404,409,410].includes(error.status)){if(current.current)capturePreviews.invalidateCapture(current.current.id);setStale(true);}
    setNotice({tone:"danger",title:error instanceof CaptureError&&error.status===409?"Le document a changé.":"L’action n’a pas abouti.",text:error instanceof Error?error.message:"Réessayez."});
  }
  async function list(signal:AbortSignal){const r=await captureRequest<{captures:CaptureDto[]}>("/capture",signal);if(!signal.aborted)setDrafts(r.captures);}
  useEffect(()=>{
    const ac=new AbortController();controller.current=ac;const unregister=registerCaptureClientWork(ac);
    void Promise.resolve().then(()=>{if(ac.signal.aborted)return;setCamera(hasNativeCamera());const op=pendingRef.current;if(op?.userId===userId){accept(op.capture);setArtifact(op.preview.artifact);setDestination(op.body.destination);setPreview(op.preview);setKeepDuplicate(op.body.keepDuplicate);setStep("review");setUncertain(true);setNotice({tone:"warning",title:"Résultat incertain.",text:"Vérifiez le résultat de l’enregistrement précédent avant de recommencer."});}});
    // A restored uncertain finalization already has its review payload. Loading
    // the hidden draft list here would count an automatic return as activity.
    void Promise.resolve().then(()=>{if(!ac.signal.aborted&&pendingRef.current?.userId!==userId)return list(ac.signal);}).catch(fail).finally(()=>{if(!ac.signal.aborted)setLoading(false);});
    return()=>{
      unregister();ac.abort();cameraNormalizer.clear();capturePreviews.clear();
      const c=current.current;
      // Camera sources remain private server drafts. Imports never become seven-day drafts.
      if(c?.kind==="import"&&c.state==="open"&&!pendingRef.current&&!isNativePickerOpen())void fetch(`/api/hestia/capture/${c.id}`,{method:"DELETE",credentials:"same-origin",cache:"no-store",keepalive:true,headers:{"Content-Type":"application/json"},body:JSON.stringify({version:c.version})}).catch(()=>{});
      current.current=null;
    };
    // User identity keys the component; callbacks do not own its lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[userId]);
  useEffect(()=>{
    if(!capture)return;
    const id=capture.id;
    const timer=setTimeout(()=>{capturePreviews.invalidateCapture(id);cameraNormalizer.clear();if(current.current?.id!==id)return;setExpiredId(id);setCommentPresent(false);setCommentValid(false);const operation=pendingRef.current;if(operation?.captureId===id){const redacted={...operation.capture,comment:"",pages:[]};operation.capture=redacted;current.current=redacted;setCapture(redacted);setUncertain(true);setNotice({tone:"warning",title:"Préparation expirée.",text:"Un enregistrement a déjà été demandé. Vérifiez son résultat avant de recommencer."});return;}current.current=null;setCapture(null);setPending(null);setTitle("");resetDerived();setDrafts(values=>values.filter(value=>value.id!==id));setNotice({tone:"warning",title:"Préparation expirée.",text:"Ses pages et son commentaire ne sont plus disponibles. Aucun nouveau document n’a été créé."});},Math.max(0,Date.parse(capture.expiresAt)-Date.now()));
    return()=>clearTimeout(timer);
    // Text edits do not change the original expiry or reschedule this lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[capture?.id,capture?.expiresAt]);
  useEffect(()=>{heading.current?.querySelector<HTMLElement>("h1")?.focus();},[step,capture?.id]);
  async function resume(c:CaptureDto){if(running.current||!controller.current)return;running.current=true;setBusy(true);setNotice(null);try{const r=await captureRequest<{capture:CaptureDto}>(`/capture/${c.id}`,controller.current.signal,"GET",undefined,{activity:"interactive"});if(!controller.current.signal.aborted){resetDerived();accept(r.capture);setPending(null);setStale(false);setCommentValid(true);setCommentPresent(!!r.capture.comment);setCommentChanged(false);setStep(r.capture.kind==="camera"?"pages":"title");}}catch(e){fail(e);}finally{running.current=false;setBusy(false);}}
  async function send(file:PendingPage,c:CaptureDto,signal:AbortSignal){
    setPending(file);setProgress(0);
    const saved=await uploadCapturePage(c,file,signal,setProgress);
    if(signal.aborted)return;
    resetDerived();accept(saved);setPending(null);setNotice({tone:"success",title:"Page sauvegardée.",text:saved.kind==="camera"?`Récupérable jusqu’au ${expiry(saved)}.`:"Le fichier importé reste intact."});
  }
  useEffect(()=>{
    if(!initial?.flow||seen.current.has(initial.id)||!controller.current)return;
    const input=initial;const flow=input.flow!;const signal=controller.current.signal;
    void Promise.resolve().then(async()=>{
      if(signal.aborted||seen.current.has(input.id))return;
      seen.current.add(input.id);running.current=true;setBusy(true);setLoading(false);
      try{
        let c=flow.captureId?(await captureRequest<{capture:CaptureDto}>(`/capture/${flow.captureId}`,signal)).capture:null;
        const file=input.file||input.files?.[0];
        if(!file){if(c)accept(c);setNotice({title:"Prise ou sélection annulée.",text:"Aucun document n’a été créé."});return;}
        if(!c)c=(await captureRequest<{capture:CaptureDto}>("/capture",signal,"POST",{kind:flow.kind,idempotencyKey:createKey.current,currentFolderId:input.folderId||null})).capture;
        if(signal.aborted)return;accept(c);setStep(flow.kind==="camera"?"pages":"title");
        await send({file,key:crypto.randomUUID(),replacePageId:flow.replacePageId},c,signal);
        if(input.files&&input.files.length>1&&!signal.aborted)setNotice({tone:"warning",title:"Un document à la fois.",text:"Seul le premier fichier est sélectionné. Importez les suivants après son classement."});
      }catch(e){if(!signal.aborted)fail(e);}finally{running.current=false;if(!signal.aborted){setBusy(false);onConsumed();}}
    });
    // The native result is consumed once; runtime state is held in refs while sending.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[initial]);
  async function retry(){if(!pending||!current.current||running.current||!controller.current)return;running.current=true;setBusy(true);setNotice(null);try{await send(pending,current.current,controller.current.signal);}catch(e){fail(e);}finally{running.current=false;setBusy(false);}}
  async function patch(pages=capture?.pages,titleValue=title,formatValue=format):Promise<CaptureDto|null>{
    const c=current.current,signal=controller.current?.signal;if(!c||!pages||!signal)return null;
    // Even an identical visible manifest can cancel an uploading selection
    // hidden from this DTO. The server alone decides no-op under its lock.
    const r=await captureRequest<{capture:CaptureDto}>(`/capture/${c.id}`,signal,"PATCH",{version:c.version,title:titleValue,format:pages.length>1&&c.kind==="camera"?"pdf":formatValue,pages:pages.map(p=>({id:p.id,rotation:p.rotation,crop:p.crop}))});
    if(signal.aborted)return null;resetDerived();accept(r.capture);return r.capture;
  }
  async function changePages(pages:CapturePageDto[]){if(running.current)return;running.current=true;setBusy(true);setNotice(null);try{await patch(pages);}catch(e){fail(e);}finally{running.current=false;setBusy(false);}}
  const adjust=(id:string,delta:Partial<CapturePageDto>)=>void changePages(capture!.pages.map(p=>p.id===id?{...p,...delta}:p));
  function commentEdited(valid:boolean,nonempty:boolean){setCommentValid(valid);setCommentPresent(nonempty);setCommentChanged(true);setPreview(null);setSuggestions(null);setEmptyFeedback(false);setPathDrafts(values=>values.length?[]:values);setKeepDuplicate(false);analysisEpoch.current++;setAnalyzing(false);if(destinationSource.current==="suggested"){setDestination(null);destinationSource.current=null;}choiceEpoch.current++;}
  function commentSaved(value:CommentSaved){if(current.current)current.current={...current.current,...value};}
  function pick(value:CaptureDestination,source:"manual"|"suggested"="manual"){destinationSource.current=source;choiceEpoch.current++;setDestination(value);setPreview(null);setKeepDuplicate(false);}
  async function prepare(){
    if(running.current||!capture||!controller.current)return;
    if(!title.trim()){setNotice({tone:"danger",title:"Donnez un titre au document."});return;}
    running.current=true;setBusy(true);setNotice(null);
    try{const saved=await patch();if(!saved)return;const r=await captureRequest<{capture:CaptureDto;artifact:CaptureArtifactDto}>(`/capture/${saved.id}/prepare`,controller.current.signal,"POST",{version:saved.version});if(!controller.current.signal.aborted){accept(r.capture);setArtifact(r.artifact);setStep("destination");}}catch(e){fail(e);}finally{running.current=false;setBusy(false);}
  }
  async function analyze(){
    if(!capture||!artifact||analyzing||!controller.current)return;
    const signal=controller.current.signal,epoch=++analysisEpoch.current,chosen=choiceEpoch.current,id=capture.id,version=capture.version,deadline=Date.now()+90_000;
    setAnalyzing(true);setEmptyFeedback(false);setNotice(null);setLate(false);
    try{
      const comment=await commentHandle.current?.flush();if(signal.aborted||epoch!==analysisEpoch.current)return;setCommentChanged(false);
      let result=await captureRequest<ClassificationAnalysisDto>(`/capture/${id}/analyze`,signal,"POST",{version,artifactId:artifact.id,commentVersion:comment?.commentVersion??capture.commentVersion,idempotencyKey:crypto.randomUUID()});
      while(result.status==="pending"&&epoch===analysisEpoch.current&&!signal.aborted&&Date.now()<deadline){await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);signal.removeEventListener("abort",done);resolve();};const timer=setTimeout(done,1500);signal.addEventListener("abort",done,{once:true});});if(signal.aborted||epoch!==analysisEpoch.current)return;result=await captureRequest<ClassificationAnalysisDto>(`/capture/${id}/analyses/${result.analysisId}`,signal);}
      if(signal.aborted||epoch!==analysisEpoch.current||current.current?.version!==version)return;
      if(result.status==="complete"&&result.result){setSuggestions(result.result);setEmptyFeedback(!result.result.existing.length&&!result.result.created.length);setPathDrafts(capturePathDrafts(result.result));setLate(chosen!==choiceEpoch.current);}else setNotice({tone:"warning",title:"Suggestions indisponibles.",text:"Vous pouvez choisir un dossier vous-même."});
    }catch(e){if(epoch===analysisEpoch.current&&!signal.aborted){if(e instanceof CaptureError&&e.status===401)onAccessLost();else setNotice({tone:"warning",title:"Suggestions indisponibles.",text:"Vous pouvez choisir un dossier vous-même. Une nouvelle demande nécessite votre action."});}}
    finally{if(epoch===analysisEpoch.current&&!signal.aborted)setAnalyzing(false);}
  }
  async function destinationFailure(error:unknown) {
    if(!(error instanceof CaptureError) || !(error.status===403||error.status===404||["ACCESS_CHANGED","PATH_CHANGED","NAME_UNAVAILABLE","AMBIGUOUS_PATH"].includes(error.code))) {fail(error);return;}
    setPreview(null);setDestination(null);setKeepDuplicate(false);setStale(false);setStep("destination");choiceEpoch.current++;
    setPathDrafts(values=>values.map(value=>({...value,picks:{}})));
    // Refresh only the authorized folder projection. Never rerun paid analysis.
    setRefreshedFolders([]);
    try { const result=await captureRequest<{folders:TreeFolder[]}>("/folders",controller.current!.signal);if(!controller.current!.signal.aborted)setRefreshedFolders(result.folders); }
    catch(refreshError){if(refreshError instanceof CaptureError&&refreshError.status===401){onAccessLost();return;}}
    if(!controller.current?.signal.aborted)setNotice({tone:"warning",title:error.code==="ACCESS_CHANGED"?"Accès modifiés.":"Chemin à vérifier.",text:"Rien n’a été enregistré. Relisez le chemin et les accès, puis choisissez et confirmez à nouveau. Le document reste disponible dans ce parcours."});
  }
  async function review(duplicate=keepDuplicate){if(!capture||!artifact||!destination||running.current||!controller.current)return;const chosen=choiceEpoch.current;running.current=true;setBusy(true);setNotice(null);try{await commentHandle.current?.flush(true);if(controller.current.signal.aborted||chosen!==choiceEpoch.current)return;const r=await captureRequest<{preview:CapturePreviewDto}>(`/capture/${capture.id}/preview`,controller.current.signal,"POST",{version:capture.version,artifactId:artifact.id,destination,keepDuplicate:duplicate});if(!controller.current.signal.aborted&&chosen===choiceEpoch.current){setPreview(r.preview);setKeepDuplicate(duplicate);setStep("review");}}catch(e){await destinationFailure(e);setPreview(null);}finally{running.current=false;setBusy(false);}}
  async function finalize(reconcile=false){
    if(!capture||!artifact||!destination||!preview||running.current||!controller.current)return;
    if(uncertain&&!reconcile)return;
    const signal=controller.current.signal;
    onMutationStart();
    pendingRef.current??={userId,captureId:capture.id,capture,preview,body:{version:capture.version,artifactId:artifact.id,destination,keepDuplicate,previewToken:preview.previewToken,idempotencyKey:crypto.randomUUID()}};
    const op=pendingRef.current;running.current=true;setBusy(true);setNotice(null);
    let recorded=false;
    try{const r=await captureRequest<CaptureOperationDto>(reconcile?`/capture-operations/${op.body.idempotencyKey}`:`/capture/${op.captureId}/finalize`,signal,"POST",reconcile?{captureId:op.captureId,...op.body}:op.body);
      if(signal.aborted)return;
      if(r.status==="recorded"){capturePreviews.invalidateCapture(op.captureId);recorded=true;pendingRef.current=null;current.current=null;setCapture(null);setDone({folderId:r.document.folderId,title:r.document.title});}
      else if(r.status==="not-recorded"){pendingRef.current=null;setUncertain(false);setPreview(null);setStep("destination");setNotice({title:"Non enregistré.",text:"Relisez la destination et les accès avant de réessayer."});}
      else{setUncertain(true);setNotice({tone:"warning",title:"Enregistrement en cours.",text:"Vérifiez le résultat avant de recommencer."});}
    }catch(e){if(signal.aborted)return;if(e instanceof CaptureError&&e.status<500){pendingRef.current=null;setUncertain(false);setPreview(null);setStep("destination");await destinationFailure(e);}else{setUncertain(true);setNotice({tone:"warning",title:"Résultat incertain.",text:"La réponse a été perdue. Vérifiez le résultat avant de recommencer."});}}
    finally{running.current=false;if(!signal.aborted)setBusy(false);}
    // A confirmed document stays confirmed even if its following read fails.
    // Keep that read outside the mutation's uncertain-result handling.
    if(recorded&&!signal.aborted)await onCommitted().catch(()=>{if(!signal.aborted)setNotice({tone:"warning",title:"Action enregistrée. Actualisation indisponible.",text:"Le document est enregistré. Actualisez la liste avant de poursuivre."});});
  }
  async function discard(){if(!abandon||running.current||!controller.current)return;running.current=true;setBusy(true);try{await captureRequest(`/capture/${abandon.id}`,controller.current.signal,"DELETE",{version:abandon.version});if(!controller.current.signal.aborted){capturePreviews.invalidateCapture(abandon.id);if(current.current?.id===abandon.id){current.current=null;setCapture(null);setPending(null);createKey.current=crypto.randomUUID();resetDerived();}setAbandon(null);await list(controller.current.signal);}}catch(e){fail(e);}finally{running.current=false;setBusy(false);}}
  function close(){if(busy||uncertain)return;onClose();}
  const startFolder=folders.find(f=>f.id===(capture?.currentFolderId??currentFolderId));
  const menu=notice&&<Banner tone={notice.tone} title={notice.title} action={stale&&capture?"Actualiser le brouillon":undefined} onAction={()=>{if(capture)void resume(capture);}}>{notice.text}</Banner>;
  const ordered=["pages","title","destination","review"] as const;
  const pageEditDisabled=busy||!!pending;
  if(done)return <div className="hc-stack"><Banner tone="success" title="Enregistré.">{done.title}</Banner>{menu}<div className="hc-row"><Button icon="folder-open" onClick={()=>onDone(done.folderId)}>Ouvrir le dossier</Button>{camera&&<Button variant="secondary" icon="camera" onClick={()=>{setDone(null);setPreview(null);setArtifact(null);setDestination(null);setPending(null);setUncertain(false);createKey.current=crypto.randomUUID();requestCaptureFlow(userId,currentFolderId,"camera");}}>Photographier un autre document</Button>}</div></div>;
  return <div ref={heading} className="hc-stack hc-flow">{menu}{!capture?<><PageHeader title={mode==="photo"?"Photo":"Brouillons"} summary={mode==="photo"?"Photographiez une ou plusieurs pages : elles forment un seul document. Vous choisissez ensuite où le ranger.":""}/>{mode==="photo"&&<>{startFolder&&<span className="hc-muted">Depuis {folderLabel(startFolder)}. Vous choisirez la destination ensuite.</span>}{camera?<div><Button icon="camera" disabled={busy} onClick={()=>requestCaptureFlow(userId,currentFolderId,"camera")}>Prendre la première page</Button></div>:<Banner title="Photo sur téléphone ou tablette.">Vous pouvez reprendre un brouillon ou importer un fichier depuis cet appareil.</Banner>}</>}<div><Button variant="secondary" icon="upload" disabled={busy} onClick={()=>requestCaptureFlow(userId,currentFolderId,"import")}>Importer un fichier</Button></div><h2 className="hc-section-heading">Brouillons en cours</h2><p className="hc-muted"><Icon name="lock" size={16}/> Visibles par vous seul. Chaque brouillon est conservé 7 jours après sa création.</p>{loading?<p role="status">Chargement des brouillons…</p>:drafts.length?<ul className="hc-list">{drafts.map(d=><li className="hc-card hc-row" key={d.id}><div className="hc-grow"><strong>{d.title||"Nouveau document"}</strong><div className="hc-muted">{d.pages.length} page(s) sauvegardée(s){d.comment?" · commentaire enregistré":""} · expire le {expiry(d)}</div></div><Button variant="secondary" compact disabled={busy} onClick={()=>void resume(d)}>Reprendre</Button><Button variant="tertiary" compact icon="trash" disabled={busy} onClick={()=>setAbandon(d)}>Abandonner</Button></li>)}</ul>:<EmptyState icon="file-text" title="Aucun brouillon">Vos pages sauvegardées apparaîtront ici.</EmptyState>}</>:<>
      <div className="hc-row" style={{justifyContent:"space-between"}}><Button variant="tertiary" compact icon="x" disabled={busy||uncertain} onClick={close}>Fermer</Button><span className="hc-muted">{capture.kind==="camera"?`Brouillon privé · expire le ${expiry(capture)}`:"Import temporaire · sélection perdue à la fermeture"}</span></div>
      <StepHeader step={capture.kind==="import"?ordered.indexOf(step):ordered.indexOf(step)+1} total={capture.kind==="import"?3:4} label={step==="pages"?"Pages":step==="title"?"Titre et format":step==="destination"?"Rangement":"Vérification"}/><h1 tabIndex={-1} className="hc-heading">{step==="pages"?"Les pages du document":step==="title"?"Titre et format":step==="destination"?"Où ranger ce document ?":"Vérifier avant d’enregistrer"}</h1>
      {pending&&<Banner tone={busy?"info":"warning"} title={busy?`Envoi de la page : ${progress} %` : "Page non sauvegardée."}>Seules les pages confirmées sont récupérables.{!busy&&<Button variant="secondary" compact onClick={()=>void retry()}>Réessayer l’envoi</Button>}</Banner>}
      {step==="pages"&&<><ol className="hc-list" aria-label="Pages du document">{capture.pages.map((p,index)=><li className="hc-card hc-stack" key={p.id}><div className="hc-row" style={{alignItems:"flex-start",flexWrap:"nowrap"}}><CapturePageTile userId={userId} privacyEpoch={privacyEpoch} onFailure={fail} captureId={capture.id} page={p}/><div className="hc-grow"><strong>Page {index+1}</strong><StatusPill>Sauvegardée</StatusPill></div><div className="hc-row" style={{gap:4,flexWrap:"nowrap"}}><CaptureIconButton icon="arrow-up" label={`Monter la page ${index+1}`} disabled={pageEditDisabled||index===0} onClick={()=>{const pages=[...capture.pages];[pages[index-1],pages[index]]=[pages[index],pages[index-1]];void changePages(pages);}}/><CaptureIconButton icon="arrow-down" label={`Descendre la page ${index+1}`} disabled={pageEditDisabled||index===capture.pages.length-1} onClick={()=>{const pages=[...capture.pages];[pages[index+1],pages[index]]=[pages[index],pages[index+1]];void changePages(pages);}}/></div></div><div><Button variant="secondary" compact icon="crop" aria-expanded={editPage===p.id} disabled={pageEditDisabled} onClick={()=>setEditPage(editPage===p.id?null:p.id)}>{editPage===p.id?"Fermer les ajustements":"Ajuster la page"}</Button></div>{editPage===p.id&&<div className="hc-edit" role="group" aria-label={`Ajuster la page ${index+1}`}><CapturePageTile userId={userId} privacyEpoch={privacyEpoch} onFailure={fail} captureId={capture.id} page={p} variant="settings" width={180}/><div className="hc-stack hc-edit-controls"><div className="hc-row"><Button variant="secondary" compact icon="rotate-ccw" disabled={pageEditDisabled} onClick={()=>adjust(p.id,{rotation:((p.rotation+270)%360) as CapturePageDto["rotation"]})}>Tourner à gauche</Button><Button variant="secondary" compact icon="rotate-cw" disabled={pageEditDisabled} onClick={()=>adjust(p.id,{rotation:((p.rotation+90)%360) as CapturePageDto["rotation"]})}>Tourner à droite</Button></div><CaptureCropStepper crop={p.crop} disabled={pageEditDisabled} onChange={crop=>adjust(p.id,{crop})}/><div className="hc-row">{camera&&<Button variant="secondary" compact icon="camera" disabled={pageEditDisabled} onClick={()=>requestCaptureFlow(userId,capture.currentFolderId,"camera",capture.id,p.id)}>Reprendre la photo</Button>}<Button variant="tertiary" compact icon="trash" disabled={pageEditDisabled} onClick={()=>void changePages(capture.pages.filter(page=>page.id!==p.id))}>Retirer la page</Button></div></div></div>}</li>)}</ol>{!capture.pages.length&&<EmptyState icon="camera" title="Aucune page pour l’instant">Prenez la première page de votre document.</EmptyState>}<div className="hc-row">{camera?<Button variant="secondary" icon="camera" disabled={pageEditDisabled} onClick={()=>requestCaptureFlow(userId,capture.currentFolderId,"camera",capture.id)}>Ajouter une page</Button>:<span className="hc-muted">Ajouter ou reprendre une page : sur téléphone ou tablette.</span>}<Button variant="tertiary" icon="trash" disabled={busy} onClick={()=>setAbandon(capture)}>Abandonner le brouillon</Button></div></>}
      {step==="title"&&<><TextField label="Titre du document" value={title} maxLength={200} disabled={busy} onChange={e=>setTitle(e.target.value)}/>{capture.kind==="camera"&&capture.pages.length===1&&<RadioGroup label="Format" name="capture-format" value={format} disabled={busy} options={[{value:"pdf",label:"PDF"},{value:"image",label:"Image"}]} onChange={value=>setFormat(value as "pdf"|"image")}/>}{capture.kind==="camera"?<><strong>Aperçu final</strong><span className="hc-muted">{capture.pages.length>1?"Plusieurs pages forment un seul PDF, dans cet ordre.":"Les ajustements affichés seront appliqués au fichier final."}</span><div className="hc-previews">{capture.pages.map(p=><CapturePageTile userId={userId} privacyEpoch={privacyEpoch} onFailure={fail} key={p.id} captureId={capture.id} page={p} width={150}/>)}</div><div><Button variant="tertiary" compact icon="pencil" disabled={busy} onClick={()=>setStep("pages")}>Modifier les pages</Button></div></>:<div className="hc-note"><Icon name="file-text"/><span>Le fichier importé est conservé tel quel. Fermer ce parcours perd la sélection ; aucun brouillon de 7 jours n’est conservé.</span></div>}</>}
      <div hidden={step!=="destination"} className={step==="destination"?"hc-stack":undefined}>
        <section className="hc-stack"><h2 className="hc-section-heading">1. Choisir un dossier vous-même</h2>
          <div><Button variant="secondary" icon="folder-open" disabled={busy} aria-expanded={browse} onClick={()=>setBrowse(!browse)}>Parcourir les dossiers</Button></div>
          {allowed(startFolder)&&<div className="hc-card" style={{padding:0}} role="radiogroup" aria-label="Dossier courant"><PickRow label={folderLabel(startFolder!)} meta="Dossier courant" selected={destination?.kind==="existing"&&destination.folderId===startFolder!.id} disabled={busy} onPick={()=>pick({kind:"existing",folderId:startFolder!.id})} last/></div>}
          {browse&&<div className="hc-stack hc-card" role="group" aria-label="Choisir un dossier"><strong>Parcourir les dossiers</strong>
            <div className="hc-row">{parent&&<Button variant="tertiary" compact icon="chevron-left" onClick={()=>setParent(folders.find(f=>f.id===parent)?.visibleParentId??null)}>Remonter</Button>}<span className="hc-muted">{parent&&folders.find(f=>f.id===parent)?folderLabel(folders.find(f=>f.id===parent)!):"Dossiers"}</span></div>
            <div role="radiogroup" aria-label="Destinations accessibles" className="hc-card" style={{padding:0}}>{folders.filter(f=>f.visibleParentId===parent).map((f,index,rows)=><PickRow key={f.id} label={f.name} disabled={busy||!allowed(f)} reason={!allowed(f)?"Droits insuffisants pour déposer ici.":undefined} selected={destination?.kind==="existing"&&destination.folderId===f.id} last={index===rows.length-1} onPick={()=>{pick({kind:"existing",folderId:f.id});setBrowse(false);}} onOpen={f.childCount>0?()=>setParent(f.id):undefined}/>)}</div>
          </div>}
        </section>
        <section className="hc-stack"><h2 className="hc-section-heading">2. Suggestions de dossiers existants</h2>{expiredId!==capture.id&&<CaptureComment key={capture.id} capture={capture} active={step==="destination"} handleRef={commentHandle} onEdited={commentEdited} onSaved={commentSaved} onAccessLost={onAccessLost}/>}<p className="hc-muted">Sur votre demande, le document{commentPresent||capture.comment?", votre commentaire et":" et"} les noms des dossiers accessibles où vous pouvez déposer sont transmis au fournisseur. Rien n’est classé automatiquement.</p>
          <div className="hc-row"><Button variant="secondary" icon="lightbulb" disabled={busy||!commentValid} loading={analyzing} onClick={()=>void analyze()}>{suggestions?"Redemander (nouvelle analyse)":"Demander des suggestions"}</Button>{analyzing&&<Button variant="tertiary" onClick={()=>{analysisEpoch.current++;setAnalyzing(false);setNotice({title:"Vous n’attendez plus les suggestions.",text:"La demande peut continuer chez le fournisseur ; son éventuel coût n’est pas annulé."});}}>Ne plus attendre</Button>}</div>
          {!commentValid&&<span className="hc-muted">Raccourcissez le commentaire à 2 000 caractères pour demander des suggestions.</span>}{commentChanged&&<span className="hc-muted">Le commentaire a changé : les suggestions précédentes ne s’appliquent plus. Un dossier choisi vous-même reste sélectionné.</span>}{suggestions?.contradiction&&<Banner tone="warning" title="Divergence signalée.">{suggestions.contradiction} Les alternatives sont proposées ci-dessous : choisissez celle qui convient, ou un dossier vous-même. Toutes les divergences ne sont pas forcément repérées.</Banner>}
          {emptyFeedback&&!analyzing&&<span className="hc-muted" role="status" aria-live="polite" aria-label="Aucune suggestion pertinente.">Aucune suggestion pertinente pour ce document. Choisissez un dossier vous-même.</span>}
          {suggestions?.existing.filter(s=>allowed(folders.find(f=>f.id===s.folderId))).map(s=><div className="hc-card" style={{padding:0}} key={s.folderId} role="radiogroup" aria-label="Suggestion"><PickRow label={folderLabel(folders.find(f=>f.id===s.folderId)!)} meta={s.reason} selected={destination?.kind==="existing"&&destination.folderId===s.folderId} disabled={busy} onPick={()=>pick({kind:"existing",folderId:s.folderId},"suggested")} last/></div>)}
          {late&&<span className="hc-muted">Suggestions arrivées après votre choix : votre sélection n’a pas changé.</span>}
        </section>
        {!!pathDrafts.length&&<CaptureDestinations drafts={pathDrafts} folders={folders} title={title} destination={destination} disabled={busy} onChange={(index,value)=>{setPathDrafts(drafts=>drafts.map((item,i)=>i===index?value:item));setDestination(null);setPreview(null);setKeepDuplicate(false);choiceEpoch.current++;}} onPick={value=>pick(value,"suggested")}/>}
        {destination&&<Banner title="Destination choisie.">{destination.kind==="existing"?folders.find(f=>f.id===destination.folderId)?.name:destination.levels.join(" / ")}</Banner>}
      </div>
      {step==="review"&&preview&&<><dl className="hc-card hc-review"><dt>Document</dt><dd>{preview.title}</dd><dt>Format</dt><dd>{preview.artifact.mediaType==="application/pdf"?"PDF":"Image"}</dd><dt>Pages</dt><dd>{preview.artifact.pageCount}</dd><dt>Destination</dt><dd>{preview.path.map(p=>`${p.name}${p.isNew?" (à créer)":""}`).join(" / ")}</dd></dl><section className="hc-stack hc-card"><h2 className="hc-section-heading">Chemin exact</h2><CapturePathPlan label="Chemin exact" segments={[...(!preview.path.some(p=>!p.isNew)?[{name:"Votre espace",status:"root" as const}]:[]),...preview.path.map((p,index):CapturePathSegment=>({name:p.name,status:p.isNew?"new":index===0?"start":"reused"})),{name:preview.title,status:"doc"}]}/><span className="hc-muted">{preview.path.filter(p=>p.isNew).length?"Les dossiers manquants seront créés avec le document, ensemble, seulement si l’enregistrement réussit.":"Aucun dossier ne sera créé."} Les noms des dossiers ne donnent aucun accès et ne créent aucun compte.</span></section><section className="hc-stack"><h2 className="hc-section-heading">Qui pourra accéder au document</h2><p className="hc-muted">{preview.access.message}</p><span className="hc-muted">Vous pouvez : {preview.access.capabilities.join(", ")}</span>{preview.access.people?.map(person=><div className="hc-card" key={person.id}><strong>{person.name}</strong><div className="hc-muted">{person.capabilities.join(", ")}</div></div>)}</section><div className="hc-note"><Icon name="info"/><span>{capture.kind==="camera"?"Le fichier final validé devient l’original. Les photos sources et rendus temporaires seront supprimés après son enregistrement durable.":"Votre fichier importé sera conservé intact."} Le commentaire de préparation n’est pas conservé avec le document.</span></div>{preview.duplicate&&<><Banner tone="warning" title="Un document identique existe déjà dans cette destination."/><Checkbox label="Conserver quand même ce doublon" description="La confirmation est nécessaire pour créer un second document identique." checked={keepDuplicate} disabled={busy||uncertain} onChange={value=>void review(value)}/></>}</>}
      <div className="hc-footer">{step!=="pages"&&!(capture.kind==="import"&&step==="title")&&<Button variant="tertiary" disabled={busy||uncertain} onClick={()=>{setPreview(null);setStep(step==="review"?"destination":step==="destination"?"title":"pages");}}>Retour</Button>}{step==="pages"&&<Button disabled={busy||!!pending||!capture.pages.length} onClick={()=>{setNotice(null);setStep("title");}}>Continuer</Button>}{step==="title"&&<Button loading={busy} disabled={!!pending||!capture.pages.length} onClick={()=>void prepare()}>Choisir où ranger</Button>}{step==="destination"&&<Button loading={busy} disabled={!destination} onClick={()=>void review()}>Vérifier avant d’enregistrer</Button>}{step==="review"&&(uncertain?<Button variant="secondary" loading={busy} onClick={()=>void finalize(true)}>Vérifier le résultat</Button>:<Button icon="check" loading={busy} disabled={!preview||(preview.duplicate&&!keepDuplicate)} onClick={()=>void finalize()}>Enregistrer le document</Button>)}</div>
    </>}{abandon&&<Dialog title="Abandonner ce brouillon ?" confirmLabel="Abandonner le brouillon" confirmVariant="danger" busy={busy} onConfirm={()=>void discard()} onCancel={()=>setAbandon(null)}>Ses pages et son commentaire seront supprimés. Aucun document ne sera créé.</Dialog>}</div>;
}
