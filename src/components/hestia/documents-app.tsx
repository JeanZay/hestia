"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Avatar, Banner, Button, Dialog, EmptyState, Icon, Logo, PageHeader, Skeleton, TextField } from "./design-system";
import { FolderPath, type TreeFolder } from "./folder-tree";
import {MoveWorkspace, type MoveSource, type PendingMove} from "./move-workspace";
import {TrashWorkspace, type PendingTrash} from "./trash-workspace";
import { FileWorkspace } from "./file-workspace";
import { FolderWorkspace } from "./access-workspace";
import { FamilyAuth } from "./family-auth";
import { FamilyProfile } from "./family-profile";
import { FamilyHousehold } from "./family-household";
import { CAPTURE_EVENT, OPEN_CAPTURE_EVENT, clearNativePicker, releaseNativePicker, isNativePickerOpen, hasNativeCamera, type CaptureResult } from "./native-capture";
import { CaptureWorkspace, type CapturePendingFinal } from "./capture-workspace";
import { TranscriptionSettings } from "./transcription-settings";
import { InboxWorkspace, type PendingInboxPlacement } from "./inbox-workspace";
import { InboxSettings } from "./inbox-settings";
import { InboxCount } from "./inbox-design";
import { inboxRequest } from "./inbox-client";
import { CaptureSettings } from "./capture-settings";
import { clearCaptureClientWork } from "./capture-client";
import { capturePreviews } from "./capture-preview-cache";
import type { WorkspaceSnapshot, WorkspaceDocument } from "@/lib/workspace";
import { WorkspaceReader, coalesceWorkspaceRefresh } from "./workspace-client";

type User = { id: string; name: string; email: string; role?: string };
type Folder = TreeFolder;
type Notice = { tone: "info" | "danger" | "success" | "warning"; title: string; text?: string; action?: string; onAction?: () => void };
class RequestError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
async function request<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal, interactive = false): Promise<T> {
  const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", signal, headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(interactive ? { "X-Hestia-Activity": "interactive" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new RequestError(response.status, data?.error?.code || "UNAVAILABLE", data?.error?.message || (response.status === 401 ? "Reconnectez-vous pour continuer." : "L’action n’a pas pu aboutir. Réessayez."));
  return data as T;
}
const shortDate=(value:string)=>new Date(value).toLocaleDateString("fr-FR");
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Impossible de joindre Hestia. Réessayez.";

export function DocumentsApp() {
  const [user, setUser] = useState<User | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([]);
  const [contentLoading,setContentLoading]=useState(false);
  const [contentFailure,setContentFailure]=useState<string>();
  const reader = useRef(new WorkspaceReader());
  const foregroundRefresh=useRef<ReturnType<typeof coalesceWorkspaceRefresh>|null>(null);
  const selection = useRef<{folderId: string | null; query: string | null}>({folderId: null, query: null});
  const actor = useRef<string | null>(null);
  const snapshot = useRef<WorkspaceSnapshot | null>(null);
  const [trashView,setTrashView]=useState(false);
  const [trashSource,setTrashSource]=useState<Folder|null>(null);
  const pendingTrash=useRef<PendingTrash|null>(null);
  const pendingInbox=useRef<PendingInboxPlacement|null>(null);
  const [inboxView,setInboxView]=useState<"queue"|"settings"|null>(null);
  const [inboxCount,setInboxCount]=useState(0);
  const [me, setMe] = useState(false);
  const captureFinal=useRef<CapturePendingFinal|null>(null);
  const [captureView,setCaptureView]=useState<"photo"|"drafts"|"settings"|"transcription"|null>(null);
  const [flowCapture,setFlowCapture]=useState<CaptureResult|null>(null);
  const [cameraAvailable,setCameraAvailable]=useState(false);
  const [household, setHousehold] = useState(false);
  const [activationLink, setActivationLink] = useState(false);
  const [pendingCapture, setPendingCapture] = useState<CaptureResult | null>(null);
  const [search, setSearch] = useState<string | null>(null);
  const [fileHost, setFileHost] = useState<HTMLDivElement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [slowLoading, setSlowLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const confirmation=useRef<{notice:Notice;folderId:string|null}|null>(null);
  const [panel, setPanel] = useState(false); const [newName, setNewName] = useState("");
  const [edit, setEdit] = useState<{ name: string; version: number } | null>(null);
  const [fieldError, setFieldError] = useState<string>();
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [moveSource,setMoveSource]=useState<MoveSource|null>(null);
  const pendingMove=useRef<PendingMove|null>(null);
  const moveScope=useRef<string|null>(null);
  const moveActor=useRef<string|null>(null);
  const [uncertain, setUncertain] = useState(false);
  const pendingOperation = useRef<{key: string; userId: string; body: {kind: "create" | "rename"; name: string; parentId?: string | null; folderId?: string; version?: number}} | null>(null);
  const nameScope = useRef<string | null>(null);
  const heading = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const captureValidation = useRef(false);
  const admitted = useRef(false);
  const selected = folders.find(folder => folder.id === selectedId);
  const roots = folders.filter(folder => folder.visibleParentId === null).sort((a,b)=>a.name.localeCompare(b.name,"fr"));
  const canModify = selected?.capabilities.includes("consulter") && selected.capabilities.includes("modifier");
  const renaming=edit!==null;
  useEffect(() => { const timer = setTimeout(() => {
    // A deliberate search can close Capture/settings. Its result heading must
    // not steal keyboard focus from the search field while the user is typing.
    if (document.activeElement === heading.current?.querySelector("#hestia-document-search")) return;
    const target = heading.current?.querySelector<HTMLElement>(panel ? ".h-panel h2" : "main h1");
    if (target) { target.tabIndex = -1; target.focus(); }
  }, 0); return () => clearTimeout(timer); }, [selectedId, panel, renaming, checking,trashView,captureView]);
  useEffect(() => { void Promise.resolve().then(() => setActivationLink(new URLSearchParams(window.location.search).has("flowId") && window.location.hash.includes("capability="))); }, []);
  const clearPrivate = useCallback((preservePicker = false) => {
    capturePreviews.revoke();clearCaptureClientWork();
    ++generation.current; reader.current.invalidate(); actor.current=null;snapshot.current=null;confirmation.current=null;
    selection.current={folderId:null,query:null};setDocuments([]);
    setInboxView(null);setInboxCount(0);setCaptureView(null);setFlowCapture(null);
    setTrashView(false);setTrashSource(null);
    admitted.current = false; nameScope.current=null; moveScope.current=null; moveActor.current=null; setMoveSource(null); setUncertain(false);
    if (!preservePicker) clearNativePicker();
    setNotice(null); setPendingCapture(null); setSearch(null); setUser(null); setMe(false); setHousehold(false); setActivationLink(false); setFolders([]); setSelectedId(null); setPanel(false); setEdit(null); setNewName(""); setFieldError(undefined);
  }, []);
  const validateNameScope = useCallback((listing: Folder[]) => {
    setPendingCapture(previous=>previous&&!listing.some(folder=>folder.id===previous.folderId&&folder.capabilities.includes("consulter")&&folder.capabilities.includes("déposer"))?null:previous);
    setTrashSource(previous=>previous?listing.find(f=>f.id===previous.id&&f.capabilities.includes("consulter")&&f.capabilities.includes("supprimer"))??null:null);
    const moving=moveScope.current;
    if(moving&&!listing.some(folder=>folder.id===moving&&folder.capabilities.includes("consulter")&&folder.capabilities.includes("modifier"))){moveScope.current=null;const operation=pendingMove.current;setMoveSource(operation?{kind:operation.body.kind,id:operation.body.sourceId,name:"",folderId:null,parentId:null}:null);}
    const scope=nameScope.current;
    if(scope&&!listing.some(folder=>folder.id===scope&&folder.capabilities.includes("consulter")&&folder.capabilities.includes("modifier"))){
      nameScope.current=null;pendingOperation.current=null;setUncertain(false);setPanel(false);setEdit(null);setNewName("");setCreateParentId(null);setFieldError(undefined);
      setNotice({tone:"warning",title:"Accès indisponible.",text:"Vos droits ne permettent plus de poursuivre cette opération."});
    }
  },[]);
  const recordConfirmation=useCallback((title:string,text?:string,folderId=selection.current.folderId)=>{
    const notice:Notice={tone:"success",title,text};confirmation.current={notice,folderId};setNotice(notice);
  },[]);
  const refresh = useCallback(async (options: {folderId?: string | null; query?: string | null; background?: boolean; interactive?: boolean; confirmed?: string} = {}) => {
    // This read also satisfies any foreground refresh queued before it.
    foregroundRefresh.current?.cancel();
    if (options.folderId !== undefined) selection.current.folderId=options.folderId;
    else if(!selection.current.folderId && pendingOperation.current?.body.folderId)selection.current.folderId=pendingOperation.current.body.folderId;
    if (options.query !== undefined) selection.current.query=options.query;
    const requested = {...selection.current};
    if(options.confirmed)recordConfirmation(options.confirmed);
    setContentLoading(true);setContentFailure(undefined);if(options.interactive&&!confirmation.current)setNotice(null);
    if (!options.background) { setChecking(true); setSlowLoading(false); setNotice(null); }
    const readRevision=reader.current.revision+1;
    try {
      const result = await reader.current.read(signal => {
        const params = new URLSearchParams();
        if (requested.folderId) params.set("folderId",requested.folderId);
        if (requested.query !== null) params.set("q",requested.query);
        return request<WorkspaceSnapshot>(`/api/hestia/workspace?${params}`, "GET", undefined, signal, options.interactive);
      });
      if (!result || readRevision!==reader.current.revision) return false;
      // Never allow panels or pending operations belonging to another actor
      // to survive a cookie/session change observed by the next snapshot.
      if(actor.current && actor.current!==result.user.id){clearPrivate();setChecking(false);return false;}
      const returning=!admitted.current;
      actor.current=result.user.id;snapshot.current=result;
      capturePreviews.admit(result.user.id,generation.current);
      if(returning&&pendingTrash.current){if(pendingTrash.current.userId!==result.user.id)pendingTrash.current=null;else {setTrashSource(null);setTrashView(true);}}
      if(moveActor.current&&moveActor.current!==result.user.id){pendingMove.current=null;moveActor.current=null;moveScope.current=null;setMoveSource(null);}
      if(returning&&captureFinal.current){if(captureFinal.current.userId!==result.user.id)captureFinal.current=null;else setCaptureView("drafts");}
      admitted.current = true; setUser(result.user); setFolders(result.folders);setDocuments(result.documents);validateNameScope(result.folders);
      const moving=pendingMove.current;
      if(returning&&moving){if(moving.userId!==result.user.id){pendingMove.current=null;setMoveSource(null);}else {moveActor.current=result.user.id;setMoveSource({kind:moving.body.kind,id:moving.body.sourceId,name:"",folderId:null,parentId:null});}}
      const pending=pendingOperation.current;
      if(returning&&pending){
        const scope=pending.body.folderId ?? pending.body.parentId;
        if(pending.userId!==result.user.id || (scope && !result.folders.some(f=>f.id===scope))){pendingOperation.current=null;setUncertain(false);setPanel(false);setEdit(null);setNewName("");}
        else {nameScope.current=scope??null;setUncertain(true);setPanel(true);setCreateParentId(pending.body.parentId??null);setNewName(pending.body.name);setEdit(pending.body.kind==="rename"?{name:pending.body.name,version:pending.body.version!}:null);setNotice({tone:"warning",title:"Résultat incertain.",text:"Vérifiez le résultat de l’opération précédente avant de recommencer."});}
      }
      setSelectedId(result.selectedFolder?.id ?? null);
      const committed=confirmation.current;
      if(committed){
        confirmation.current=null;
        if(!committed.folderId||result.folders.some(folder=>folder.id===committed.folderId&&folder.capabilities.includes("consulter")))setNotice(committed.notice);
        else setNotice(null);
      }
      if (requested.folderId && !result.selectedFolder) {
        selection.current.folderId=null;
        setNotice({tone:"warning",title:"Dossier indisponible.",text:"Ce dossier n’est plus accessible. La liste a été actualisée."});
      }
      setChecking(false);setContentLoading(false);
      return true;
    } catch (error) {
      if(readRevision!==reader.current.revision)return false;
      if(error instanceof RequestError && [401,403].includes(error.status)) clearPrivate();
      else {const committed=confirmation.current;setNotice({tone:committed ? "warning" : "danger",title:committed ? `${committed.notice.title} Actualisation indisponible.` : admitted.current ? "Actualisation indisponible." : "Connexion indisponible.",text:committed ? "L’action est enregistrée. Réessayez seulement la lecture pour afficher les informations à jour." : errorMessage(error),action:"Actualiser",onAction:()=>void refresh({background:true,interactive:true})});}
      setChecking(false);setContentLoading(false);setContentFailure(errorMessage(error));
      return false;
    }
  }, [clearPrivate,validateNameScope,recordConfirmation]);
  useEffect(() => {
    let live=true;
    const foreground=coalesceWorkspaceRefresh(()=>{if(live&&!document.hidden&&!captureValidation.current)void refresh({background:admitted.current});});
    foregroundRefresh.current=foreground;
    void Promise.resolve().then(() => { if (live) return refresh(); });
    const onFocus = (event?:Event) => {
      // The initial pageshow is already covered by the mount read. Real returns
      // invalidate immediately, including while an older read is in flight.
      if(event?.type==="pageshow"&&event instanceof PageTransitionEvent&&!event.persisted)return;
      if (!document.hidden && !captureValidation.current) {reader.current.invalidate();foreground.schedule();}
    };
    const onVisibility = () => { if (document.hidden) { foreground.cancel(); clearPrivate(isNativePickerOpen()); setChecking(true); } else onFocus(); };
    const onPageHide = () => { foreground.cancel(); clearPrivate(isNativePickerOpen()); setChecking(true); };
    window.addEventListener("focus", onFocus); window.addEventListener("pageshow", onFocus); document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    const reads=reader.current;
    return () => { live=false;foreground.cancel();foregroundRefresh.current=null;reads.invalidate();capturePreviews.revoke();clearCaptureClientWork();window.removeEventListener("focus", onFocus); window.removeEventListener("pageshow", onFocus); window.removeEventListener("pagehide", onPageHide); document.removeEventListener("visibilitychange", onVisibility); };
  }, [refresh, clearPrivate]);
  useEffect(() => {
    const received = (event: Event) => {
      const result = (event as CustomEvent<CaptureResult>).detail;
      captureValidation.current = true;
      const epoch=generation.current;
      setChecking(true);
      void refresh({folderId:result.flow?null:result.folderId,query:null}).then(ok=>{
        if(!ok||epoch!==generation.current)return;
        if(actor.current!==result.userId){clearPrivate();return;}
        if(result.flow){setMe(false);setHousehold(false);setSearch(null);setTrashView(false);setPanel(false);setCaptureView("photo");setFlowCapture(result);return;}
        if(selection.current.folderId!==result.folderId||!snapshot.current?.selectedFolder?.capabilities.includes("déposer")){clearPrivate();return;}
        setMe(false);setSearch(null);setPendingCapture(result);
      }).finally(()=>{captureValidation.current=false;});
    };
    window.addEventListener(CAPTURE_EVENT, received);
    return () => window.removeEventListener(CAPTURE_EVENT, received);
  }, [clearPrivate,refresh]);
  useEffect(()=>{const timer=setTimeout(()=>setCameraAvailable(hasNativeCamera()),0);const open=()=>{setCaptureView("photo");setMe(false);setHousehold(false);setTrashView(false);setSearch(null);setPanel(false);};window.addEventListener(OPEN_CAPTURE_EVENT,open);return()=>{clearTimeout(timer);window.removeEventListener(OPEN_CAPTURE_EVENT,open);};},[]);
  useEffect(() => {
    if (!checking) return;
    const timer = window.setTimeout(() => setSlowLoading(true), 8000);
    return () => window.clearTimeout(timer);
  }, [checking]);
  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => { if(!document.hidden)void refresh({background:true}); },30000);
    return () => clearInterval(timer);
  }, [user,refresh]);
  useEffect(()=>{if(!user)return;const ac=new AbortController();const read=()=>void inboxRequest<{pendingCount:number}>("/inbox",ac.signal).then(value=>{if(!ac.signal.aborted)setInboxCount(value.pendingCount);}).catch(()=>{});read();const timer=setInterval(read,30000);return()=>{ac.abort();clearInterval(timer);};},[user]);
  const mutationStarted=useCallback(()=>{reader.current.invalidate();confirmation.current=null;setContentLoading(false);setNotice(null);},[]);
  const filesUpdated=useCallback(async(confirmed=true,change?:WorkspaceDocument|string)=>{
    reader.current.invalidate();setNotice(null);
    if(change)setDocuments(previous=>typeof change==="string"?previous.filter(doc=>doc.id!==change):[...previous.filter(doc=>doc.id!==change.id),change]);
    return refresh({background:true,confirmed:confirmed?"Action enregistrée.":undefined});
  },[refresh]);
  const filesUnavailable=useCallback(()=>{void refresh({background:true});},[refresh]);
  async function login(email: string, password: string) {
    if (busy) return;
    setBusy(true); setNotice(null);
    try { await request("/api/auth/sign-in/email", "POST", { email, password }); await refresh(); }
    catch (error) { clearPrivate(); setNotice({ tone: "danger", title: "Connexion impossible.", text: error instanceof RequestError && error.status === 429 ? error.message : "Vérifiez votre adresse e-mail et votre mot de passe, puis réessayez." }); }
    finally { setBusy(false); }
  }
  async function logout() {
    if (busy) return;
    ++generation.current; pendingInbox.current=null; pendingOperation.current=null; pendingMove.current=null; pendingTrash.current=null; captureFinal.current=null; clearPrivate(); setBusy(true); setNotice(null);
    try { await request("/api/auth/sign-out", "POST", {}); setNotice({ tone: "info", title: "Vous êtes déconnecté." }); }
    catch { setNotice({ tone: "danger", title: "Déconnexion non confirmée.", text: "Votre session n’a pas pu être fermée sur le serveur. Réessayez de vous déconnecter après reconnexion." }); }
    finally { setBusy(false); }
  }
  function beginName(parent: string | null, rename = false) {
    if (uncertain) return;
    nameScope.current=rename ? selected!.id : parent;pendingOperation.current = null; setUncertain(false); setCreateParentId(parent); setNewName(""); setFieldError(undefined); setNotice(null);
    setEdit(rename && selected ? {name:selected.name,version:selected.version} : null); setPanel(true);
  }
  function closeName() { if (busy || uncertain) return; nameScope.current=null; setPanel(false); setEdit(null); pendingOperation.current=null; setFieldError(undefined); }
  async function finishName(folder: Folder, rename: boolean, parentId?: string | null) {
    reader.current.invalidate();
    nameScope.current=null;
    setFolders(previous => [...previous.filter(f => f.id !== folder.id), folder]);
    setSelectedId(folder.id); setPanel(false); setEdit(null); setNewName(""); setUncertain(false); pendingOperation.current=null;
    const title=rename ? "Renommé." : "Dossier créé.";
    recordConfirmation(title,rename ? "Les accès et le contenu ne changent pas." : parentId ? "Le sous-dossier hérite des accès de son parent. Aucun droit n’est ajouté." : `« ${folder.name} » est privé : personne d’autre que vous n’y a accès tant que vous ne l’avez pas accordé.`,folder.id);
    await refresh({folderId:folder.id,query:null,background:true});
  }
  async function verifyName() {
    const op=pendingOperation.current; if (!op || busy) return; mutationStarted();const epoch=generation.current; setBusy(true);
    try {
      const result=await request<{status:"committed";folder:Folder}|{status:"not-recorded"}>(`/api/hestia/folder-operations/${op.key}`,"POST",op.body);
      if(epoch!==generation.current)return;
      if(result.status==="committed") await finishName(result.folder,op.body.kind==="rename",op.body.parentId);
      else { setUncertain(false); setNotice({tone:"info",title:"Vérifié.",text:"L’opération n’a pas été enregistrée. Rien n’a changé ; vous pouvez la recommencer."}); }
    } catch(error) { if(epoch!==generation.current)return; if(error instanceof RequestError && [401,403,404].includes(error.status)){clearPrivate();setNotice({tone:"danger",title:"Accès à vérifier.",text:errorMessage(error)});} else setNotice({tone:"warning",title:"Résultat incertain.",text:errorMessage(error),action:"Vérifier le résultat",onAction:()=>void verifyName()}); }
    finally {setBusy(false);}
  }
  async function saveFolder(event: FormEvent) {
    event.preventDefault(); if (busy || uncertain) return;
    const rename=!!edit; const name=(rename ? edit.name : newName).trim();
    if(!name){setFieldError("Donnez un nom, par exemple « Factures ».");return;}
    const body = rename ? {kind:"rename" as const,name,folderId:selected!.id,version:edit.version} : {kind:"create" as const,name,parentId:createParentId};
    if(!pendingOperation.current || JSON.stringify(pendingOperation.current.body)!==JSON.stringify(body)) pendingOperation.current={key:crypto.randomUUID(),userId:user!.id,body};
    const op=pendingOperation.current; mutationStarted();const epoch=generation.current; setBusy(true);setFieldError(undefined);setNotice(null);
    try {
      const result=await request<{folder:Folder}>(rename ? `/api/hestia/folders/${selected!.id}` : "/api/hestia/folders",rename?"PATCH":"POST",rename ? {name,version:edit.version,idempotencyKey:op.key} : {name,parentId:createParentId,idempotencyKey:op.key});
      if(epoch!==generation.current)return; await finishName(result.folder,rename,createParentId);
    } catch(error) {
      if(epoch!==generation.current)return;
      if(error instanceof RequestError && [401,403,404].includes(error.status)){clearPrivate();setNotice({tone:"danger",title:"Accès à vérifier.",text:errorMessage(error)});}
      else if(error instanceof RequestError && error.status<500){pendingOperation.current=null; if(error.status===409 && error.code!=="VERSION_CONFLICT")setFieldError("Ce nom n’est pas disponible à cet endroit. Choisissez un autre nom.");else {setPanel(false);setEdit(null);await refresh();setNotice({tone:"danger",title:error.code==="VERSION_CONFLICT"?"Le dossier a changé.":"Enregistrement refusé.",text:errorMessage(error)});}}
      else {setUncertain(true);setNotice({tone:"warning",title:"Résultat incertain.",text:"Hestia n’a pas répondu. L’opération a peut-être été enregistrée : vérifiez avant de recommencer.",action:"Vérifier le résultat",onAction:()=>void verifyName()});}
    } finally{setBusy(false);}
  }
  function showFolders() { setInboxView(null); confirmation.current=null;reader.current.invalidate();selection.current={folderId:null,query:null};setDocuments([]);void refresh({folderId:null,query:null,background:true,interactive:true}); setCaptureView(null);setFlowCapture(null); setTrashView(false);setTrashSource(null); nameScope.current=null; setPendingCapture(null); setSearch(null); setMe(false); setHousehold(false); setSelectedId(null); setPanel(false); setEdit(null); setFieldError(undefined); }
  function openFolder(id: string) { setInboxView(null); confirmation.current=null;setCaptureView(null);setFlowCapture(null); setTrashView(false);setTrashSource(null); nameScope.current=null; setPendingCapture(null); setSearch(null); setMe(false); setHousehold(false); setSelectedId(null); setDocuments([]); setPanel(false); setEdit(null); setFieldError(undefined); setNotice(null); void refresh({folderId:id,query:null,interactive:true}); }
  function beginMove(source:MoveSource){if(pendingMove.current)return;moveActor.current=user?.id??null;nameScope.current=null;setPanel(false);setEdit(null);setNotice(null);moveScope.current=source.kind==="document"?source.folderId:source.id;setMoveSource(source);}
  function closeMove(){if(pendingMove.current)return;moveScope.current=null;setMoveSource(null);setNotice({tone:"info",title:"Annulé.",text:"Rien n’a été modifié."});}
  const moveUnavailable=useCallback(()=>{moveScope.current=null;const operation=pendingMove.current;if(operation){setMoveSource({kind:operation.body.kind,id:operation.body.sourceId,name:"",folderId:null,parentId:null});return;}setMoveSource(null);void refresh().then(()=>setNotice({tone:"warning",title:"Accès indisponible.",text:"Cet élément n’est plus disponible avec vos accès."}));},[refresh]);
  function moveNotRecorded(){moveScope.current=null;setMoveSource(null);void refresh().then(()=>setNotice({tone:"info",title:"Non enregistré.",text:"L’opération n’a pas été enregistrée. Ouvrez l’élément et vérifiez les effets avant de réessayer."}));}
  async function moveDone(body:{kind:"folder"|"document";sourceId:string;destinationId:string|null}){moveScope.current=null;setMoveSource(null);reader.current.invalidate();setDocuments([]);await refresh({folderId:body.kind==="folder"?body.sourceId:body.destinationId,query:null,background:true,confirmed:"Déplacé."});}
  function showSearch(query:string){setInboxView(null);confirmation.current=null;reader.current.invalidate();setNotice(null);setContentLoading(true);setContentFailure(undefined);selection.current={folderId:null,query};setSelectedId(null);setDocuments([]);setCaptureView(null);setFlowCapture(null);setTrashView(false);setTrashSource(null);setPanel(false);setMe(false);setHousehold(false);setSearch(query);}
  useEffect(()=>{
    if(search===null)return;
    const timer=setTimeout(()=>void refresh({folderId:null,query:search,background:true,interactive:true}),180);
    return()=>clearTimeout(timer);
  },[search,refresh]);
  function showInbox(){showFolders();setInboxView("queue");}
  function showTrash(){showFolders();setTrashView(true);setMoveSource(null);}
  function beginTrash(){if(!selected||pendingTrash.current)return;setMoveSource(null);setPanel(false);setTrashSource(selected);}
  async function trashDone(action:"trash"|"restore"){const epoch=generation.current;if(action==="trash"&&trashSource){const id=trashSource.id;setFolders(previous=>previous.filter(folder=>folder.id!==id&&!folder.breadcrumbs.some(crumb=>crumb.id===id)));setSelectedId(null);}setTrashSource(null);reader.current.invalidate();setDocuments([]);const title=action==="trash"?"Mis à la corbeille.":"Restauré.";const ok=await refresh({folderId:null,query:null,background:true,confirmed:title});if(actor.current&&epoch===generation.current)setTrashView(true);return ok;}
  const consumeFlowCapture = useCallback(() => { releaseNativePicker(); setFlowCapture(null); }, []);
  const consumeCapture = useCallback(() => { releaseNativePicker(); setPendingCapture(null); }, []);
  const filesAccessLost = useCallback(() => { ++generation.current; clearPrivate(); }, [clearPrivate]);
  const message = notice && <Banner tone={notice.tone} title={notice.title} action={uncertain ? "Vérifier le résultat" : notice.action} onAction={uncertain ? () => void verifyName() : notice.onAction}>{notice.text}</Banner>;
  if (checking) return <div ref={heading} className="cdv-root h-root"><main className="h-main" aria-label="Contenu principal"><div className="h-content">{slowLoading ? <Banner title="Le chargement prend plus de temps que prévu.">Hestia attend une réponse du serveur.</Banner> : <Skeleton/>}</div></main></div>;
  if (!user) return <FamilyAuth onLogin={login} busy={busy} notice={message}/>;
  return <div ref={heading} className="cdv-root h-root">
    {activationLink && <Dialog title="Ce lien est destiné à une autre personne" confirmLabel="Me déconnecter et continuer" cancelLabel="Rester connecté·e" busy={busy} onConfirm={() => void logout()} onCancel={() => { setActivationLink(false); window.history.replaceState(null, "", window.location.pathname); }}><p>Vous êtes connecté·e en tant que {user.name} sur cet appareil. Le lien doit être ouvert par sa destinataire, avec son propre compte. Déconnectez-vous d’abord.</p></Dialog>}
    <header className="h-topbar"><Logo dark/><span className="h-household">Instance familiale privée</span><form className="h-top-search" role="search" autoComplete="off" onSubmit={e => e.preventDefault()}><Icon name="search" size={18}/><input className="cdv-focus" type="search" id="hestia-document-search" name="document-search" autoComplete="off" aria-label="Rechercher un document ou un dossier" placeholder="Rechercher un document ou un dossier" value={search ?? ""} onChange={e => { if (e.currentTarget !== document.activeElement) { e.currentTarget.value = search ?? ""; return; } showSearch(e.target.value); }}/></form><div className="h-topbar-actions"><Button variant="secondary" compact icon="log-out" className="h-desktop-logout" onClick={() => void logout()} loading={busy}>Se déconnecter</Button><Avatar name={user.name || user.email}/></div></header>
    <div className={`h-workspace ${panel || moveSource ? "h-panel-open" : ""}`}>
      <nav className="h-sidenav" aria-label="Navigation principale"><button className="cdv-focus h-navitem" aria-current={!inboxView && !captureView && !selected && !me && !household && !trashView ? "page" : undefined} onClick={showFolders}><Icon name="home"/><span className="h-wide-label">Tous les dossiers</span><span className="h-rail-label">Dossiers</span></button><button className="cdv-focus h-navitem" aria-current={inboxView==="queue"?"page":undefined} onClick={showInbox}><Icon name="inbox"/><span>À classer{inboxCount?` · ${inboxCount}`:""}</span></button><button className="cdv-focus h-navitem h-rail-me" aria-current={me ? "page" : undefined} onClick={() => { showFolders(); setMe(true); }}><Icon name="user"/><span>Moi</span></button>{(user.role === "owner" || user.role === "admin") && <button className="cdv-focus h-navitem" aria-current={household ? "page" : undefined} onClick={() => { showFolders(); setHousehold(true); }}><Icon name="users"/><span>Foyer</span></button>}<button className="cdv-focus h-navitem" aria-current={trashView?"page":undefined} onClick={showTrash}><Icon name="trash"/><span>Corbeille</span></button><button className="cdv-focus h-navitem" aria-current={captureView==="drafts"?"page":undefined} onClick={()=>{setInboxView(null);setCaptureView("drafts");setFlowCapture(null);}}><Icon name="file-text"/><span>Brouillons</span></button>{cameraAvailable&&<button className="cdv-focus h-navitem" aria-current={captureView==="photo"?"page":undefined} onClick={()=>{setInboxView(null);setCaptureView("photo");setFlowCapture(null);}}><Icon name="camera"/><span>Photo</span></button>}<div className="h-separator"/>{roots.map(f => <button key={f.id} className="cdv-focus h-navitem h-folder-nav" aria-current={f.id === selectedId ? "page" : undefined} onClick={() => openFolder(f.id)} title={f.name}><Icon name="folder"/><span>{f.name}</span></button>)}<p className="h-navfooter">Vous ne voyez que les dossiers auxquels vous avez accès.</p></nav>
      <main className="h-main" aria-label="Contenu principal"><div key={inboxView || captureView || (trashView ? "trash" : household ? "household" : me ? "me" : search !== null ? "search" : selected?.id ?? "root")} className="h-content">{!panel && message}{trashSource&&<TrashWorkspace key={`${user.id}:${trashSource.id}`} userId={user.id} folders={folders} source={trashSource} showList={false} host={fileHost} pendingRef={pendingTrash} onUnavailable={filesUnavailable} onMutationStart={mutationStarted} onClose={()=>setTrashSource(null)} onDone={trashDone} onAccessLost={filesAccessLost}/>}{inboxView === "settings" ? <InboxSettings email={user.email} onBack={()=>{setInboxView(null);setMe(true);}} onAccessLost={filesAccessLost}/> : inboxView === "queue" ? <InboxWorkspace userId={user.id} pendingRef={pendingInbox} folders={folders} onAccessLost={filesAccessLost} onCount={setInboxCount} onUpdated={()=>filesUpdated(false)} onSettings={()=>setInboxView("settings")}/> : captureView === "transcription" ? <TranscriptionSettings onBack={()=>{setCaptureView(null);setMe(true);}} onClassification={()=>setCaptureView("settings")} onAccessLost={filesAccessLost}/> : captureView === "settings" ? <CaptureSettings onBack={()=>{setCaptureView(null);setMe(true);}} onAccessLost={filesAccessLost}/> : captureView ? <CaptureWorkspace privacyEpoch={generation.current} pendingRef={captureFinal} key={user.id} userId={user.id} folders={folders} currentFolderId={selectedId} mode={captureView} initial={flowCapture} onConsumed={consumeFlowCapture} onBack={()=>{showFolders();if(captureView==="drafts")setMe(true);}} onClose={()=>{setCaptureView(null);setFlowCapture(null);}} onDone={openFolder} onCommitted={filesUpdated} onMutationStart={mutationStarted} onAccessLost={filesAccessLost}/> : trashView ? <TrashWorkspace userId={user.id} folders={folders} source={null} showList host={fileHost} pendingRef={pendingTrash} onUnavailable={filesUnavailable} onMutationStart={mutationStarted} onClose={()=>setTrashSource(null)} onDone={trashDone} onAccessLost={filesAccessLost}/> : household && (user.role === "owner" || user.role === "admin") ? <FamilyHousehold onAccessLost={filesAccessLost}/> : me ? <FamilyProfile onMail={()=>setInboxView("settings")} onDrafts={()=>setCaptureView("drafts")} onClassification={()=>setCaptureView("settings")} onTranscription={()=>setCaptureView("transcription")} user={user} onLogout={() => void logout()} onAccessLost={filesAccessLost}/> : search !== null ? <FileWorkspace onMove={beginMove} userId={user.id} key="search" folders={folders} host={fileHost} query={search} onQuery={showSearch} onFolder={openFolder} onAccessLost={filesAccessLost} onUpdated={filesUpdated} onMutationStart={mutationStarted} documents={documents} loading={contentLoading} failure={contentFailure}/> : !selected ? <><div className="h-heading-actions"><PageHeader title="Dossiers" summary={`${roots.length} dossier${roots.length > 1 ? "s" : ""} accessible${roots.length > 1 ? "s" : ""}`}/><div className="hc-row"><InboxCount count={inboxCount} onClick={showInbox}/><Button icon="folder-plus" onClick={() => beginName(null)}>Nouveau dossier</Button></div></div>{roots.length ? <ul className="h-document-list">{roots.map(f => <li key={f.id}><button className="cdv-focus h-document-row" onClick={() => openFolder(f.id)}><span className="h-file-count" aria-hidden="true">{f.childCount + f.documentCount}</span><span className="h-row-text"><strong>{f.name}</strong><span>{`${f.childCount + f.documentCount} élément${f.childCount + f.documentCount > 1 ? "s" : ""} · Créé par ${f.createdByName}${roots.filter(other=>other.name.normalize("NFC").toLocaleLowerCase("fr")===f.name.normalize("NFC").toLocaleLowerCase("fr")).length>1 ? ` · depuis le ${shortDate(f.createdAt)}` : ""}` }</span></span></button></li>)}</ul> : <EmptyState title="Aucun dossier accessible pour le moment">Créez un dossier, ou attendez qu’une personne du foyer vous en donne l’accès.</EmptyState>}</> : <><FolderPath key={selected.id} folder={selected} onFolder={openFolder} onRoot={showFolders}/><PageHeader overline="Dossier" title={selected.name} summary={`${selected.childCount} sous-dossier${selected.childCount > 1 ? "s" : ""} · ${selected.documentCount} document${selected.documentCount > 1 ? "s" : ""} · Créé par ${selected.createdByName} le ${shortDate(selected.createdAt)}`}/><div><span className="h-capabilities">Vous pouvez : {selected.capabilities.map(c => c.toLocaleLowerCase("fr")).join(", ")}</span></div><FolderWorkspace onTrash={beginTrash} onMove={beginMove} onFolder={openFolder} onRename={canModify ? () => beginName(null,true) : undefined} actions={canModify && <Button icon="folder-plus" onClick={() => beginName(selected.id)}>Nouveau sous-dossier</Button>} userId={user.id} key={selected.id} initialCapture={pendingCapture} onCaptureConsumed={consumeCapture} folder={selected} folders={folders} host={fileHost} onAccessLost={filesAccessLost} onUpdated={filesUpdated} onMutationStart={mutationStarted} documents={documents} loading={contentLoading} failure={contentFailure}/></>}</div></main>
      {moveSource&&<MoveWorkspace key={`${user.id}:${moveSource.kind}:${moveSource.id}:${moveSource.name?"known":"pending"}`} source={moveSource} userId={user.id} folders={folders} pendingRef={pendingMove} onClose={closeMove} onDone={moveDone} onAccessLost={filesAccessLost} onUnavailable={moveUnavailable} onNotRecorded={moveNotRecorded} onMutationStart={mutationStarted}/>}
      <div ref={setFileHost} className="h-file-panel-host"/>
      {panel && <aside className="h-panel" aria-label={edit ? "Renommer" : createParentId ? "Nouveau sous-dossier" : "Nouveau dossier"} onKeyDown={event=>{if(event.key==="Escape")closeName();}}>{message}<Button variant="tertiary" compact icon="x" disabled={busy || uncertain} onClick={closeName}>Fermer</Button><form onSubmit={e => void saveFolder(e)} className="h-new-folder"><h2>{edit ? "Renommer" : createParentId ? "Nouveau sous-dossier" : "Nouveau dossier"}</h2><p className="h-hint">{edit ? "Les accès et le contenu ne changent pas." : createParentId ? `Dans « ${folders.find(f=>f.id===createParentId)?.name ?? "ce dossier"} ». Il héritera de ses accès ; aucun droit n’est ajouté, ni pour vous ni pour d’autres.` : "À la racine, dans votre espace. Personne d’autre que vous n’y aura accès tant que vous ne l’aurez pas accordé."}</p><TextField label="Nom du dossier" placeholder="Ex. : Factures" hint="Deux dossiers voisins ne peuvent pas porter le même nom (les majuscules ne comptent pas, les accents si)." value={edit ? edit.name : newName} onChange={e => {if(edit)setEdit({...edit,name:e.target.value});else setNewName(e.target.value);pendingOperation.current=null;}} error={fieldError} maxLength={120} disabled={busy || uncertain}/><div className="h-actions"><Button type="submit" icon="check" loading={busy} disabled={uncertain}>{edit ? "Enregistrer le nom" : "Créer le dossier"}</Button><Button variant="tertiary" disabled={busy || uncertain} onClick={closeName}>Annuler</Button></div></form></aside>}
    </div>
    <nav className="h-bottomnav" aria-label="Navigation principale mobile" style={{gridTemplateColumns:`repeat(${(user.role === "owner" || user.role === "admin" ? 6 : 5)+(cameraAvailable?1:0)},1fr)`}}><button className="cdv-focus" aria-current={!inboxView && !captureView && !me && !household && !trashView && search === null ? "page" : undefined} onClick={showFolders}><Icon name="folder" size={22}/>Dossiers</button><button className="cdv-focus" aria-current={inboxView==="queue"?"page":undefined} onClick={showInbox}><Icon name="inbox" size={22}/>À classer{inboxCount?` (${inboxCount})`:""}</button><button className="cdv-focus" aria-current={search !== null ? "page" : undefined} onClick={() => showSearch("")}><Icon name="search" size={22}/>Rechercher</button>{cameraAvailable&&<button className="cdv-focus" aria-current={captureView==="photo"?"page":undefined} onClick={()=>{setInboxView(null);setCaptureView("photo");setFlowCapture(null);}}><Icon name="camera" size={22}/>Photo</button>}<button className="cdv-focus" aria-current={trashView?"page":undefined} onClick={showTrash}><Icon name="trash" size={22}/>Corbeille</button><button className="cdv-focus" aria-current={me ? "page" : undefined} onClick={() => { showFolders(); setMe(true); }}><Icon name="user" size={22}/>Moi</button>{(user.role === "owner" || user.role === "admin") && <button className="cdv-focus" aria-current={household ? "page" : undefined} onClick={() => { showFolders(); setHousehold(true); }}><Icon name="users" size={22}/>Foyer</button>}</nav>
  </div>;
}
