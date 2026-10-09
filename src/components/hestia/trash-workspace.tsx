"use client";

import {useCallback, useEffect, useRef, useState, type RefObject} from "react";
import {createPortal} from "react-dom";
import {Banner, Button, Dialog, EmptyState, Icon, PageHeader, Skeleton, TextField} from "./design-system";
import {StatusPill} from "./family-ui";
import {AccessImpact, PickRow, type MoveImpactGroup} from "./move-design";
import type {TreeFolder} from "./folder-tree";
import type {FileDocument} from "./file-workspace";

type Group = {id:string;folderId:string;name:string;trashedAt:string;restorableUntil:string;trashedByName:string;originalDestinationAvailable:boolean};
type TrashedDocument = FileDocument & {trashedAt:string;restorableUntil:string;trashedByName:string};
type RestoreBody = {destinationId?:string|null;name?:string};
export type PendingTrash = {key:string;userId:string;body:RestoreBody & {action:"trash"|"restore";sourceId:string;previewToken:string}};
type Preview = {previewToken:string|null;allowed:boolean;source:{id:string;name:string};counts?:{folders:number;documents:number};destination?:{id:string|null;name:string;breadcrumbs?:{id:string;name:string}[]};groups?:MoveImpactGroup[];impactNote?:string;collision?:boolean;needDestination?:boolean;refusal?:{code:string;title:string;message:string}};
class TrashError extends Error {constructor(public status:number,public code:string,message:string){super(message);}}
async function request<T>(path:string,signal:AbortSignal,body?:unknown):Promise<T>{
  const response=await fetch(`/api/hestia/${path}`,{method:body===undefined?"GET":"POST",credentials:"same-origin",cache:"no-store",signal,headers:body===undefined?undefined:{"Content-Type":"application/json"},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new TrashError(response.status,data.error?.code??"UNAVAILABLE",data.error?.message??"L’action n’a pas pu aboutir. Réessayez.");
  return data;
}
const date=(value:string)=>new Date(value).toLocaleString("fr-FR",{dateStyle:"short",timeStyle:"short"});
const countText=(counts:NonNullable<Preview["counts"]>)=>[(counts.folders>1)?`${counts.folders-1} sous-dossier${counts.folders>2?"s":""}`:"",counts.documents?`${counts.documents} document${counts.documents>1?"s":""}`:""].filter(Boolean).join(", ");

// Technical integration of validated Documents v2: grouped trash, neutral
// refusals, restore review and the existing 1.3 destination/impact components.
export function TrashWorkspace({userId,folders,source,showList,host,pendingRef,onClose,onDone,onAccessLost,onUnavailable}:{userId:string;folders:TreeFolder[];source:TreeFolder|null;showList:boolean;host:HTMLElement|null;pendingRef:RefObject<PendingTrash|null>;onClose:()=>void;onDone:(action:"trash"|"restore")=>Promise<void>;onAccessLost:()=>void;onUnavailable:()=>void}){
  const [groups,setGroups]=useState<Group[]>([]),[documents,setDocuments]=useState<TrashedDocument[]>([]);
  const [active,setActive]=useState<Group|null>(null),[preview,setPreview]=useState<Preview|null>(null);
  const [loading,setLoading]=useState(showList),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
  const [notice,setNotice]=useState<{title:string;text?:string;tone:"info"|"warning"|"danger"|"success"}|null>(null);
  const [picking,setPicking]=useState(false),[browse,setBrowse]=useState<string|null>(null),[destination,setDestination]=useState<string|null|undefined>(undefined);
  const [name,setName]=useState(""),[reviewName,setReviewName]=useState("");
  const [failedLoad,setFailedLoad]=useState(false);
  const [displayedAt,setDisplayedAt]=useState<string>();
  const [qualifiedFolders,setQualifiedFolders]=useState(folders);
  const control=useRef(new AbortController()),running=useRef(false),epoch=useRef(0),panel=useRef<HTMLElement>(null);
  const sourceId=source?.id;
  const permitted=!source||folders.some(f=>f.id===source.id&&f.capabilities.includes("consulter")&&f.capabilities.includes("supprimer"));
  const resetReview=()=>{setPreview(null);setName("");setReviewName("");setDestination(undefined);setBrowse(null);setPicking(false);};
  const fail=useCallback((error:unknown)=>{
    if(error instanceof TrashError&&error.status===401){onAccessLost();return;}
    if(error instanceof TrashError&&[403,404,410].includes(error.status)){
      setPreview(null);setActive(null);setGroups([]);setDocuments([]);setName("");setBrowse(null);setDestination(undefined);onUnavailable();
      setNotice({tone:"warning",title:error.status===410?"Délai dépassé.":"Accès indisponible.",text:error.status===410?"Cet élément ne peut plus être consulté ni récupéré. La liste a été actualisée.":"Cet élément n’est plus disponible avec vos accès. Rien n’a été restauré."});return;
    }
    setNotice({tone:"danger",title:"L’action n’a pas pu aboutir.",text:error instanceof Error?error.message:"Impossible de joindre Hestia. Réessayez."});
  },[onAccessLost,onUnavailable]);
  const load=useCallback(async()=>{
    const current=++epoch.current;control.current.abort();control.current=new AbortController();const signal=control.current.signal;
    // Invalidate every private field before requalifying, including descendants
    // whose rights may change without changing the root's public listing.
    setPreview(null);setActive(null);setName("");setReviewName("");setBrowse(null);setDestination(undefined);setPicking(false);setGroups([]);setDocuments([]);setLoading(true);setFailedLoad(false);setNotice(previous=>previous?.tone==="danger"?null:previous);setQualifiedFolders(folders);running.current=false;setBusy(false);
    if(pendingRef.current)setUncertain(true);
    try{
      const [listing,docs]=await Promise.all([request<{groups:Group[];now?:string}>("trash",signal),request<{documents:TrashedDocument[];now?:string}>("documents?trash=true",signal)]);
      if(signal.aborted||current!==epoch.current)return;
      setQualifiedFolders(folders);setGroups(listing.groups);setDocuments(docs.documents);setDisplayedAt(listing.now??new Date().toISOString());setNotice(previous=>previous&&previous.tone!=="info"?previous:{tone:"info",title:"La corbeille a été mise à jour."});
    }catch(error){if(!signal.aborted&&current===epoch.current){setFailedLoad(true);fail(error);}}
    finally{if(!signal.aborted&&current===epoch.current)setLoading(false);}
  },[fail,pendingRef,folders]);
  useEffect(()=>{const sequence=epoch;control.current=new AbortController();return()=>{++sequence.current;control.current.abort();};},[]);
  useEffect(()=>{if(!showList)return;const timer=setTimeout(()=>void load(),0);return()=>clearTimeout(timer);},[showList,folders,load]);
  useEffect(()=>{if(!active&&!uncertain)return;panel.current?.querySelector<HTMLElement>("h2")?.focus();},[active,uncertain,picking]);
  const review=useCallback(async(id:string,action:"trash"|"restore",body:RestoreBody={})=>{
    if(running.current||pendingRef.current)return;const signal=control.current.signal;running.current=true;setBusy(true);setPreview(null);setNotice(null);
    try{const result=await request<Preview>(action==="trash"?`folders/${id}/trash/preview`:`trash/${id}/restore/preview`,signal,body);if(signal.aborted)return;setQualifiedFolders(folders);setPreview(result);setReviewName(body.name??"");if(result.needDestination||result.refusal?.code==="DESTINATION_UNAVAILABLE"){setPicking(true);setPreview(null);setNotice({tone:"warning",title:"Emplacement indisponible.",text:"L’emplacement d’origine n’est plus disponible. Choisissez une autre destination. Le groupe reste à la corbeille sans prolongation."});}}
    catch(error){if(!signal.aborted)fail(error);}finally{if(!signal.aborted){running.current=false;setBusy(false);}}
  },[fail,pendingRef,folders]);
  useEffect(()=>{if(!sourceId)return;control.current.abort();control.current=new AbortController();const timer=setTimeout(()=>{setPreview(null);setQualifiedFolders(folders);running.current=false;setBusy(false);if(pendingRef.current){setUncertain(true);return;}void review(sourceId,"trash");},0);return()=>clearTimeout(timer);},[sourceId,folders,review,pendingRef]);
  const restoreBody=():RestoreBody=>({...destination!==undefined?{destinationId:destination}:{},...name.trim()?{name:name.trim()}: {}});
  async function completed(action:"trash"|"restore"){
    pendingRef.current=null;setUncertain(false);setActive(null);resetReview();await onDone(action);setNotice({tone:"success",title:action==="trash"?"Mis à la corbeille.":"Restauré.",text:action==="restore"?"Aucun accès retiré ou expiré n’est rétabli. Les éléments supprimés avant cette opération gardent leur échéance.":undefined});
  }
  async function confirm(){
    if(running.current||uncertain||!preview?.allowed||!preview.previewToken)return;
    const action=source?"trash":"restore",id=source?.id??active?.id;if(!id)return;
    if(action==="restore"&&name.trim()!==reviewName){await review(id,action,restoreBody());return;}
    const operation:PendingTrash={key:crypto.randomUUID(),userId,body:{action,sourceId:id,...action==="restore"?restoreBody():{},previewToken:preview.previewToken}};
    pendingRef.current=operation;running.current=true;setBusy(true);setNotice(null);const signal=control.current.signal;
    try{const {action:kind,sourceId:target,...body}=operation.body;await request(kind==="trash"?`folders/${target}/trash`:`trash/${target}/restore`,signal,{...body,idempotencyKey:operation.key});if(!signal.aborted)await completed(action);}
    catch(error){if(signal.aborted)return;setPreview(null);
      if(error instanceof TrashError&&error.status<500){pendingRef.current=null;if(error.code.includes("STALE")){setNotice({tone:"warning",title:action==="trash"?"Contenu modifié.":"Effets modifiés.",text:"Rien n’a été modifié. Relisez les effets actuels, puis confirmez de nouveau."});}else fail(error);}
      else{setUncertain(true);setActive(null);setName("");setNotice(null);}
    }finally{if(!signal.aborted){running.current=false;setBusy(false);}}
  }
  async function reconcile(){
    const operation=pendingRef.current;if(!operation||operation.userId!==userId||running.current)return;running.current=true;setBusy(true);const signal=control.current.signal;
    try{const result=await request<{status:"committed"|"not-recorded"}>(`trash/operations/${operation.key}`,signal,operation.body);if(signal.aborted)return;
      pendingRef.current=null;setUncertain(false);if(result.status==="committed")await completed(operation.body.action);
      else{setActive(null);resetReview();setNotice({tone:"info",title:"Non enregistré.",text:"L’opération n’a pas été enregistrée. Vérifiez les effets avant de recommencer."});if(source)onClose();}
    }catch(error){if(!signal.aborted)fail(error);}finally{if(!signal.aborted){running.current=false;setBusy(false);}}
  }
  async function restoreDocument(document:TrashedDocument){
    if(running.current||uncertain)return;running.current=true;setBusy(true);const signal=control.current.signal;
    try{await request(`documents/${document.id}/restore`,signal,{version:document.version});if(!signal.aborted){await onDone("restore");setNotice({tone:"success",title:"Restauré.",text:"Les accès retirés entre-temps ne sont pas rétablis."});}}
    catch(error){if(!signal.aborted){await load();fail(error);}}finally{if(!signal.aborted){running.current=false;setBusy(false);}}
  }
  const banner=notice&&<Banner tone={notice.tone} title={notice.title}>{notice.text}</Banner>;
  const uncertainBanner=<Banner tone="warning" title="Résultat incertain." action={busy?undefined:"Vérifier le résultat"} onAction={()=>void reconcile()}>Vérifiez le résultat de l’opération précédente avant de recommencer.</Banner>;
  const current=folders.find(f=>f.id===browse),children=folders.filter(f=>f.visibleParentId===(current?.id??null)).sort((a,b)=>a.name.localeCompare(b.name,"fr")),rows=current?[current,...children]:children;
  const restorePanel=(active||uncertain)&&!source&&<aside ref={panel} className="h-panel h-files-panel" aria-label={uncertain?"Restauration":`Restaurer « ${active?.name} »`} onKeyDown={event=>{if(event.key==="Escape"&&!busy&&!uncertain){setActive(null);resetReview();}}}><Button variant="tertiary" compact icon="x" disabled={busy||uncertain} onClick={()=>{setActive(null);resetReview();}}>Fermer</Button><h2 tabIndex={-1} style={{margin:0,overflowWrap:"anywhere"}}>{uncertain?"Restauration":`Restaurer « ${active?.name} »`}</h2>{uncertain?uncertainBanner:<><p style={{margin:0,color:"var(--cdv-ink-2)"}}>{picking?"Choisissez où le remettre. Les règles d’un déplacement s’appliquent.":"Retour à son emplacement d’origine, avec tout ce qui a été supprimé en même temps."}</p>{banner}
    {picking&&!preview?<><div className="h-actions"><strong>{current?.name??"Tous les dossiers"}</strong>{current&&<Button variant="tertiary" compact icon="chevron-left" onClick={()=>setBrowse(current.visibleParentId)}>Tous les dossiers</Button>}</div><div role="radiogroup" aria-label="Destination" style={{border:"1.5px solid var(--cdv-border)",borderRadius:"var(--cdv-radius-l)",overflow:"hidden"}}>{!current&&<PickRow label="À la racine (Dossiers)" icon="home" meta="Il n’héritera plus d’aucun accès" selected={destination===null} disabled={busy} onPick={()=>setDestination(null)} last={!rows.length}/>} {rows.map((folder,index)=>{const can=folder.capabilities.includes("consulter")&&folder.capabilities.includes("modifier");const count=folders.filter(f=>f.visibleParentId===folder.id).length;return <PickRow key={folder.id} label={folder.id===current?.id?`Dans « ${folder.name} »`:folder.name} selected={destination===folder.id} disabled={busy||!can} reason={!can?"Il faut pouvoir modifier ce dossier":undefined} meta={count?`${count} sous-dossier${count>1?"s":""}`:"Aucun sous-dossier"} onPick={()=>setDestination(folder.id)} onOpen={count&&folder.id!==current?.id?()=>setBrowse(folder.id):undefined} last={index===rows.length-1}/>;})}</div><Button icon="eye" loading={busy} disabled={destination===undefined} onClick={()=>void review(active!.id,"restore",restoreBody())}>Vérifier les effets</Button></>:preview?<>
    {preview.destination&&<div style={{padding:"12px 14px",background:"var(--cdv-bg)",borderRadius:"var(--cdv-radius-l)"}}><span>{destination===undefined?"Emplacement d’origine":"Destination"}</span><strong style={{display:"block",overflowWrap:"anywhere"}}>{preview.destination.id?(preview.destination.breadcrumbs?.slice(-3).map(c=>c.name).join(" › ")||preview.destination.name):"À la racine (Dossiers)"}</strong></div>}{preview.refusal&&<Banner tone="danger" title={preview.refusal.title}>{preview.refusal.message}</Banner>}
    {preview.allowed&&<><strong>Effets sur les accès</strong><AccessImpact key={preview.previewToken} groups={preview.groups??[]} note={preview.impactNote}/>{preview.counts&&<p>Sera restauré avec ce qui a été supprimé en même temps{countText(preview.counts)?` : ${countText(preview.counts)}`:""}.</p>}<p>Les documents d’origine, leurs auteurs et les exceptions locales encore valables sont conservés.</p><p>La gestion et l’espace déjà compté ne changent pas.</p><p>Les éléments supprimés avant cette opération restent à la corbeille, avec leur échéance.</p></>}
    {(preview.collision||name)&&<TextField label={`Nouveau nom pour « ${active?.name} »`} value={name} maxLength={120} disabled={busy} onChange={e=>setName(e.target.value)} error={preview.collision&&name.trim()===reviewName?"Ce nom n’est pas disponible à cet endroit. Choisissez un autre nom.":undefined} hint="Rien ne sera fusionné ni remplacé."/>}
    <div className="h-actions">{name.trim()!==reviewName?<Button icon="eye" loading={busy} onClick={()=>void review(active!.id,"restore",restoreBody())}>Vérifier les effets</Button>:preview.allowed&&<Button icon="rotate-ccw" loading={busy} onClick={()=>void confirm()}>Restaurer ici</Button>}{(picking||preview.collision||(preview.refusal&&preview.refusal.code!=="RIGHTS_UNAVAILABLE"))&&<Button variant="secondary" disabled={busy} onClick={()=>{setPicking(true);setPreview(null);setNotice(null);}}>Choisir une autre destination</Button>}<Button variant="tertiary" disabled={busy} onClick={()=>{setActive(null);resetReview();}}>Annuler</Button></div></>:<Button icon="eye" loading={busy} onClick={()=>void review(active!.id,"restore",restoreBody())}>Vérifier les effets</Button>}</>}{uncertain&&banner}</aside>;
  if(qualifiedFolders!==folders)return showList?<Skeleton/>:null;
  return <>{showList&&<><PageHeader title="Corbeille" summary=""/><p style={{margin:0,fontSize:16,lineHeight:1.5,color:"var(--cdv-ink-2)",maxWidth:680}}>Seuls apparaissent les éléments que vous pouvez aujourd’hui consulter et supprimer. Ils restent récupérables 7 jours (7 × 24 heures). Passé ce délai, ils ne peuvent plus être consultés ni récupérés.</p><div className="h-actions">{displayedAt&&<span>Liste affichée le {date(displayedAt)}</span>}<Button variant="tertiary" compact icon="refresh-cw" disabled={busy} onClick={()=>void load()}>Actualiser</Button></div>{!active&&!uncertain&&banner}{loading?<Skeleton/>:failedLoad?<Button variant="secondary" onClick={()=>void load()}>Réessayer</Button>:!groups.length&&!documents.length?<EmptyState title="La corbeille est vide">Les dossiers et documents que vous mettez à la corbeille apparaissent ici pendant 7 jours, si vous pouvez toujours les consulter et les supprimer.</EmptyState>:<ul className="h-document-list">{[...groups.map(group=>({id:group.id,name:group.name,meta:`Dossier et son contenu${group.trashedByName?` · Mis à la corbeille par ${group.trashedByName}`:""}`,until:group.restorableUntil,icon:"folder",run:()=>{resetReview();setActive(group);void review(group.id,"restore");}})),...documents.map(doc=>({id:doc.id,name:doc.title,meta:`Document${doc.trashedByName?` · Mis à la corbeille par ${doc.trashedByName}`:""}`,until:doc.restorableUntil,icon:"file",run:()=>void restoreDocument(doc)}))].map(row=><li key={row.id} style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap",padding:"12px 16px",borderBottom:"1.5px solid var(--cdv-border-subtle)"}}><Icon name={row.icon}/><div style={{flex:1,minWidth:200,display:"flex",flexDirection:"column",gap:6}}><strong style={{overflowWrap:"anywhere"}}>{row.name}</strong><span style={{fontSize:14,color:"var(--cdv-ink-3)"}}>{row.meta}</span><div><StatusPill icon="clock">Récupérable jusqu’au {date(row.until)}</StatusPill></div></div><Button variant="secondary" compact icon="rotate-ccw" aria-label={`Restaurer « ${row.name} »`} disabled={busy||uncertain} onClick={row.run}>Restaurer</Button></li>)}</ul>}</>}
    {source&&permitted&&!uncertain&&preview?.allowed&&preview.counts&&<Dialog title={`Mettre « ${source.name} » à la corbeille ?`} confirmLabel="Mettre à la corbeille" confirmIcon="trash" confirmVariant="danger" busy={busy} onCancel={onClose} onConfirm={()=>void confirm()}><p>« {source.name} »{countText(preview.counts)?` et tout son contenu actuel : ${countText(preview.counts)}.`:", qui est vide."}</p><p>Ils disparaissent pour toutes les personnes qui y ont accès : plus de consultation, de recherche, d’aperçu ni de téléchargement.</p><p>Récupérables ensemble pendant 7 jours (7 × 24 heures). Ensuite, ils ne pourront plus être consultés ni récupérés.</p><p>Ce qui se trouve déjà à la corbeille n’est pas concerné : chaque élément garde sa propre échéance.</p><p>Les fichiers déjà téléchargés ne peuvent pas être rappelés.</p></Dialog>}
    {source&&(!preview?.allowed||uncertain)&&<>{uncertain?<>{uncertainBanner}{banner}</>:preview?.refusal?<Banner tone="danger" title={preview.refusal.title}>{preview.refusal.message}</Banner>:banner}{!uncertain&&<div className="h-actions"><Button variant="tertiary" disabled={busy} onClick={onClose}>Fermer</Button>{permitted&&!preview&&<Button loading={busy} onClick={()=>void review(source.id,"trash")}>Vérifier les effets</Button>}</div>}</>}
    {host&&restorePanel&&createPortal(restorePanel,host)}
  </>;
}
