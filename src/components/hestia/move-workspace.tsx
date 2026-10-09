"use client";

import {useEffect, useRef, useState, type RefObject} from "react";
import {AccessImpact, PickRow, type MoveImpactGroup} from "./move-design";
import {Banner, Button, Icon, TextField} from "./design-system";
import type {TreeFolder} from "./folder-tree";

export type MoveSource = {kind:"folder"|"document"; id:string; name:string; folderId:string|null; parentId:string|null};
type MoveBody = {kind:"folder"|"document"; sourceId:string; destinationId:string|null; name?:string};
export type PendingMove = {key:string; userId:string; body:MoveBody & {previewToken:string}};
type Preview = {previewToken:string|null; source:{id:string;kind:string;name:string};destination:{id:string|null;name:string;breadcrumbs?:{id:string;name:string}[]};allowed:boolean;refusal?:{code:string;title:string;message:string};collision?:boolean;groups:MoveImpactGroup[];impactNote?:string};
class MoveError extends Error {constructor(public status:number,public code:string,message:string){super(message);}}
async function request<T>(path:string,body:unknown,signal:AbortSignal):Promise<T>{
  const response=await fetch(`/api/hestia/${path}`,{method:"POST",credentials:"same-origin",cache:"no-store",signal,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new MoveError(response.status,data.error?.code??"UNAVAILABLE",data.error?.message??"L’action n’a pas pu aboutir. Réessayez.");
  return data;
}
export function MoveWorkspace({source,userId,folders,pendingRef,onClose,onDone,onAccessLost,onUnavailable,onNotRecorded}: {source:MoveSource;userId:string;folders:TreeFolder[];pendingRef:RefObject<PendingMove|null>;onClose:()=>void;onDone:(body:MoveBody)=>Promise<void>;onAccessLost:()=>void;onUnavailable:()=>void;onNotRecorded:()=>void}) {
  const [browse,setBrowse]=useState<string|null>(source.parentId);
  const [destination,setDestination]=useState<string|null|undefined>(undefined);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [name,setName]=useState("");const [reviewName,setReviewName]=useState("");
  const [busy,setBusy]=useState(false);const [uncertain,setUncertain]=useState(!source.name);
  const [error,setError]=useState<string>();const [stale,setStale]=useState(false);
  // Listing and requested-folder detail may enumerate identical folders in
  // different orders. Order is presentation, not an authorization change.
  const inventoryKey=JSON.stringify([...folders].sort((a,b)=>a.id.localeCompare(b.id)).map(folder=>({...folder,capabilities:[...folder.capabilities].sort()})));
  const [qualifiedInventory,setQualifiedInventory]=useState(inventoryKey);
  const [qualifiedDocumentInventory,setQualifiedDocumentInventory]=useState(folders);
  const inventoryRef=useRef(inventoryKey);
  const controller=useRef(new AbortController());const running=useRef(false);const panel=useRef<HTMLElement>(null);
  const isDoc=source.kind==="document";
  const title=!uncertain&&source.name?`Déplacer « ${source.name} »`:"Déplacement";
  useEffect(()=>{controller.current=new AbortController();panel.current?.querySelector<HTMLElement>("h2")?.focus();return()=>controller.current.abort();},[]);
  const scope=isDoc?source.folderId:source.id;
  const accessible=!source.name||folders.some(folder=>folder.id===scope&&folder.capabilities.includes("consulter")&&folder.capabilities.includes("modifier"));
  useEffect(()=>{if(accessible)return;const timer=setTimeout(onUnavailable,0);return()=>clearTimeout(timer);},[accessible,onUnavailable]);
  // A changed inventory invalidates every private preview field, even
  // if the source itself remains visible. Late responses from its prior scope
  // must not reintroduce revoked destination/descendant names.
  useEffect(()=>{
    if(inventoryRef.current===inventoryKey)return;
    inventoryRef.current=inventoryKey;
    const old=controller.current;old.abort();const next=new AbortController();controller.current=next;
    const timer=setTimeout(()=>{
      setPreview(null);setName("");setReviewName("");setError(undefined);setStale(false);setDestination(undefined);setBrowse(null);setBusy(false);running.current=false;
      if(pendingRef.current){setUncertain(true);setQualifiedInventory(inventoryKey);return;}
      if(!next.signal.aborted)setQualifiedInventory(inventoryKey);
    },0);
    return()=>{clearTimeout(timer);next.abort();};
  },[inventoryKey,pendingRef]);
  // A document can leave its folder while an incoming document compensates
  // the visible count. Revalidate its identity on every fresh inventory,
  // independently of the folder signature used to keep stable previews.
  useEffect(()=>{
    if(!isDoc)return;
    const check=new AbortController();
    const timer=setTimeout(async()=>{
      if(pendingRef.current){setUncertain(true);setQualifiedDocumentInventory(folders);return;}
      if(!source.name){setQualifiedDocumentInventory(folders);return;}
      try{const response=await fetch(`/api/hestia/documents/${source.id}`,{credentials:"same-origin",cache:"no-store",signal:check.signal});if(check.signal.aborted)return;
        if(response.status===401){onAccessLost();return;}
        if(!response.ok){onUnavailable();return;}
        const data=await response.json();if(check.signal.aborted)return;
        if(data.document?.folderId!==source.folderId||data.document?.title!==source.name||!data.document?.capabilities?.includes("modifier")){onUnavailable();return;}
        setQualifiedDocumentInventory(folders);
      }catch{if(!check.signal.aborted)onUnavailable();}
    },0);
    return()=>{clearTimeout(timer);check.abort();};
  },[folders,isDoc,onAccessLost,onUnavailable,pendingRef,source.folderId,source.id,source.name]);
  const body=():MoveBody=>({kind:source.kind,sourceId:source.id,destinationId:destination??null,...(!isDoc&&name.trim()?{name:name.trim()}: {})});
  function fail(error:unknown){
    if(error instanceof MoveError&&error.status===401){onAccessLost();return;}
    if(error instanceof MoveError&&[403,404].includes(error.status)){pendingRef.current=null;onUnavailable();return;}
    setError(error instanceof Error?error.message:"Impossible de joindre Hestia. Réessayez.");
  }
  async function review(reconfirm=false){
    if(running.current||uncertain)return;
    if(destination===undefined){setError("Choisissez une destination.");return;}
    const signal=controller.current.signal;running.current=true;setBusy(true);setError(undefined);setPreview(null);
    try{const result=await request<Preview>("move-preview",body(),signal);if(signal.aborted)return;setPreview(result);setReviewName(name);setStale(reconfirm);}
    catch(error){if(!signal.aborted)fail(error);}
    finally{running.current=false;if(!signal.aborted)setBusy(false);}
  }
  async function reconcile(){
    const operation=pendingRef.current;if(!operation||operation.userId!==userId||running.current)return;
    const signal=controller.current.signal;running.current=true;setBusy(true);setError(undefined);
    try{const result=await request<{status:"committed"|"not-recorded"}>(`move-operations/${operation.key}`,operation.body,signal);if(signal.aborted)return;
      pendingRef.current=null;setUncertain(false);
      if(result.status==="committed")await onDone(operation.body);
      else {setPreview(null);setName("");setReviewName("");setDestination(undefined);setError("L’opération n’a pas été enregistrée. Vérifiez les effets avant de réessayer.");onNotRecorded();}
    }catch(error){if(!signal.aborted)fail(error);}
    finally{running.current=false;if(!signal.aborted)setBusy(false);}
  }
  async function confirm(){
    if(running.current||uncertain)return;
    if(name!==reviewName){await review();return;}
    if(!preview?.allowed||!preview.previewToken)return;
    const operation:PendingMove={key:crypto.randomUUID(),userId,body:{...body(),previewToken:preview.previewToken}};
    pendingRef.current=operation;const signal=controller.current.signal;running.current=true;setBusy(true);setError(undefined);setStale(false);
    let staleResult=false;
    try{await request<{status:"committed"}>("moves",{...operation.body,idempotencyKey:operation.key},signal);if(signal.aborted)return;pendingRef.current=null;await onDone(operation.body);}
    catch(error){if(signal.aborted)return;
      if(error instanceof MoveError&&error.status<500){pendingRef.current=null;if(error.code==="MOVE_STALE"){setPreview(null);staleResult=true;}else{setPreview(null);fail(error);}}
      else{setUncertain(true);setPreview(null);setName("");setError(undefined);}
    }finally{running.current=false;if(!signal.aborted)setBusy(false);}
    if(staleResult)await review(true);
  }
  if(!accessible||qualifiedInventory!==inventoryKey||(isDoc&&!uncertain&&qualifiedDocumentInventory!==folders))return null;
  const current=folders.find(folder=>folder.id===browse);
  const listed=folders.filter(folder=>folder.visibleParentId===(current?.id??null)).sort((a,b)=>a.name.localeCompare(b.name,"fr"));
  const rows=current?[current,...listed]:listed;
  function row(folder:TreeFolder,index:number){
    const self=source.kind==="folder"&&folder.id===source.id;
    const descendant=source.kind==="folder"&&folder.breadcrumbs.some(crumb=>crumb.id===source.id);
    const same=folder.id===(isDoc?source.folderId:source.parentId);
    const can=folder.capabilities.includes("consulter")&&folder.capabilities.includes("modifier")&&(!isDoc||folder.capabilities.includes("déposer"));
    const children=folders.filter(child=>child.visibleParentId===folder.id).length;
    return <PickRow key={folder.id} label={folder.id===current?.id?`Dans « ${folder.name} »`:folder.name} icon={folder.id===current?.id?"folder-open":"folder"} meta={children?`${children} sous-dossier${children>1?"s":""}`:"Aucun sous-dossier"} selected={destination===folder.id} disabled={busy||self||descendant||same||!can} reason={self?"Élément déplacé":descendant?"Se trouve dans le dossier déplacé":same?"Emplacement actuel":!can?isDoc?"Il faut pouvoir modifier ce dossier et y déposer":"Il faut pouvoir modifier ce dossier":undefined} onPick={()=>{setDestination(folder.id);setError(undefined);}} onOpen={!busy&&folder.id!==current?.id&&!self&&!descendant&&children?()=>setBrowse(folder.id):undefined} last={index===rows.length-1}/>;
  }
  const askName=!isDoc&&(preview?.collision||!!name);
  return <aside ref={panel} className="h-panel" aria-label={title} onKeyDown={event=>{if(event.key==="Escape"&&!busy&&!uncertain)onClose();}}><Button variant="tertiary" compact icon="x" disabled={busy||uncertain} onClick={onClose}>Fermer</Button><h2 tabIndex={-1} style={{margin:0,overflowWrap:"anywhere"}}>{title}</h2>
    {uncertain?<Banner tone="warning" title="Résultat incertain." action={busy?undefined:"Vérifier le résultat"} onAction={()=>void reconcile()}>Vérifiez le résultat de l’opération précédente avant de recommencer.</Banner>:<div style={{display:"flex",flexDirection:"column",gap:16,width:"100%"}}><span style={{fontSize:15,lineHeight:1.45,color:"var(--cdv-ink-2)"}}>{isDoc?"Le document prendra les accès de son dossier d’arrivée.":"Le dossier part avec tout son contenu ; il prendra les accès hérités de sa nouvelle place et garde ses exceptions locales."}</span>
      {error&&<Banner tone="danger" title="L’action n’a pas pu aboutir.">{error}</Banner>}{stale&&<Banner tone="warning" title="Effets modifiés.">Les accès ont changé depuis votre vérification. Relisez les effets mis à jour, puis confirmez de nouveau. Rien n’a été modifié.</Banner>}
      {!preview?<div style={{display:"flex",flexDirection:"column",gap:10}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}><strong style={{fontSize:16,overflowWrap:"anywhere"}}>{current?.name??"Tous les dossiers"}</strong>{current&&<Button variant="tertiary" compact icon="chevron-left" disabled={busy} onClick={()=>setBrowse(current.visibleParentId)}>{current.visibleParentId?"Remonter":"Tous les dossiers"}</Button>}</div><div role="radiogroup" aria-label="Destination" style={{display:"flex",flexDirection:"column",border:"1.5px solid var(--cdv-border)",borderRadius:"var(--cdv-radius-l)",overflow:"hidden",background:"var(--cdv-surface)"}}>{!current&&!isDoc&&<PickRow label="À la racine (Dossiers)" icon="home" meta="Il n’héritera plus d’aucun accès" selected={destination===null} disabled={busy} onPick={()=>setDestination(null)} last={!rows.length}/>} {rows.map(row)}</div>{!rows.length&&<p style={{margin:0,fontSize:15,color:"var(--cdv-ink-3)"}}>Aucun sous-dossier accessible à ce niveau.</p>}<div className="h-actions"><Button icon="eye" loading={busy} onClick={()=>void review()}>Vérifier les effets</Button><Button variant="tertiary" disabled={busy} onClick={onClose}>Annuler</Button></div></div>:<div style={{display:"flex",flexDirection:"column",gap:14}}><div style={{display:"flex",flexDirection:"column",gap:4,padding:"12px 14px",background:"var(--cdv-bg)",borderRadius:"var(--cdv-radius-l)"}}><span style={{fontSize:14,color:"var(--cdv-ink-3)"}}>Destination</span><strong style={{fontSize:16,overflowWrap:"anywhere"}}>{preview.destination.id?(preview.destination.breadcrumbs?.slice(-3).map(crumb=>crumb.name).join(" › ")||preview.destination.name):"À la racine (Dossiers)"}</strong></div>{preview.refusal&&<Banner tone="danger" title={preview.refusal.title}>{preview.refusal.message}</Banner>}{preview.allowed&&<div style={{display:"flex",flexDirection:"column",gap:8}}><strong style={{fontSize:16}}>Effets sur les accès</strong><AccessImpact key={preview.previewToken} groups={preview.groups} note={preview.impactNote}/></div>}{askName&&<TextField label={`Nouveau nom pour « ${source.name} »`} value={name} disabled={busy} maxLength={120} onChange={event=>setName(event.target.value)} error={preview.collision&&name===reviewName?"Ce nom n’est pas disponible à cet endroit. Choisissez un autre nom.":undefined} hint="Rien ne sera fusionné ni remplacé."/>}{preview.allowed&&<ul style={{margin:0,padding:0,listStyle:"none",display:"flex",flexDirection:"column",gap:6,fontSize:15,lineHeight:1.45,color:"var(--cdv-ink-2)"}}>{[isDoc?"Le fichier d’origine, son identité et son auteur ne changent pas.":"Les documents d’origine, leurs auteurs et les exceptions locales encore valables sont conservés.","La gestion et l’espace déjà compté ne changent pas."].map(text=><li key={text} style={{display:"flex",gap:8,alignItems:"flex-start"}}><Icon name="check" size={16}/><span>{text}</span></li>)}</ul>}<div className="h-actions">{name!==reviewName?<Button icon="eye" loading={busy} onClick={()=>void review()}>Vérifier les effets</Button>:preview.allowed&&<Button icon="folder-input" loading={busy} onClick={()=>void confirm()}>Déplacer ici</Button>}<Button variant="secondary" disabled={busy} onClick={()=>{setPreview(null);setStale(false);setError(undefined);}}>Changer de destination</Button><Button variant="tertiary" disabled={busy} onClick={onClose}>Annuler</Button></div></div>}
    </div>}{uncertain&&error&&<Banner tone="danger" title="Vérification indisponible.">{error}</Banner>}
  </aside>;
}
