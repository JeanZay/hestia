"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Avatar, Banner, Button, Dialog, EmptyState, Icon, Logo, PageHeader, Skeleton, TextField } from "./design-system";
import { FolderPath, type TreeFolder } from "./folder-tree";
import { FileWorkspace } from "./file-workspace";
import { FolderWorkspace } from "./access-workspace";
import { FamilyAuth } from "./family-auth";
import { FamilyProfile } from "./family-profile";
import { FamilyHousehold } from "./family-household";
import { CAPTURE_EVENT, clearNativePicker, releaseNativePicker, isNativePickerOpen, type CaptureResult } from "./native-capture";

type User = { id: string; name: string; email: string; role?: string };
type Folder = TreeFolder;
type Notice = { tone: "info" | "danger" | "success" | "warning"; title: string; text?: string; action?: string; onAction?: () => void };
class RequestError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
async function request<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", signal, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new RequestError(response.status, data?.error?.code || "UNAVAILABLE", data?.error?.message || (response.status === 401 ? "Reconnectez-vous pour continuer." : "L’action n’a pas pu aboutir. Réessayez."));
  return data as T;
}
const shortDate=(value:string)=>new Date(value).toLocaleDateString("fr-FR");
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Impossible de joindre Hestia. Réessayez.";

export function DocumentsApp() {
  const [user, setUser] = useState<User | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [me, setMe] = useState(false);
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
  const [panel, setPanel] = useState(false); const [newName, setNewName] = useState("");
  const [edit, setEdit] = useState<{ name: string; version: number } | null>(null);
  const [fieldError, setFieldError] = useState<string>();
  const [createParentId, setCreateParentId] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const pendingOperation = useRef<{key: string; userId: string; body: {kind: "create" | "rename"; name: string; parentId?: string | null; folderId?: string; version?: number}} | null>(null);
  const nameScope = useRef<string | null>(null);
  const heading = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const captureValidation = useRef(false);
  const admitted = useRef(false);
  const selected = folders.find(folder => folder.id === selectedId);
  const selectedRef=useRef<string | null>(null); selectedRef.current=selectedId;
  const roots = folders.filter(folder => folder.visibleParentId === null).sort((a,b)=>a.name.localeCompare(b.name,"fr"));
  const canModify = selected?.capabilities.includes("consulter") && selected.capabilities.includes("modifier");
  const renaming=edit!==null;
  useEffect(() => { const timer = setTimeout(() => { const target = heading.current?.querySelector<HTMLElement>(panel ? ".h-panel h2" : "main h1"); if (target) { target.tabIndex = -1; target.focus(); } }, 0); return () => clearTimeout(timer); }, [selectedId, panel, renaming, checking]);
  useEffect(() => { void Promise.resolve().then(() => setActivationLink(new URLSearchParams(window.location.search).has("flowId") && window.location.hash.includes("capability="))); }, []);
  const clearPrivate = useCallback((preservePicker = false) => {
    admitted.current = false; nameScope.current=null; setUncertain(false);
    if (!preservePicker) clearNativePicker();
    setNotice(null); setPendingCapture(null); setSearch(null); setUser(null); setMe(false); setHousehold(false); setActivationLink(false); setFolders([]); setSelectedId(null); setPanel(false); setEdit(null); setNewName(""); setFieldError(undefined);
  }, []);
  const validateNameScope = useCallback((listing: Folder[]) => {
    setPendingCapture(previous=>previous&&!listing.some(folder=>folder.id===previous.folderId&&folder.capabilities.includes("consulter")&&folder.capabilities.includes("déposer"))?null:previous);
    const scope=nameScope.current;
    if(scope&&!listing.some(folder=>folder.id===scope&&folder.capabilities.includes("consulter")&&folder.capabilities.includes("modifier"))){
      nameScope.current=null;pendingOperation.current=null;setUncertain(false);setPanel(false);setEdit(null);setNewName("");setCreateParentId(null);setFieldError(undefined);
      setNotice({tone:"warning",title:"Accès indisponible.",text:"Vos droits ne permettent plus de poursuivre cette opération."});
    }
  },[]);
  const refresh = useCallback(async (signal?: AbortSignal, requestedId?: string, background = false) => {
    const epoch = ++generation.current;
    if (!background) { setChecking(true); setSlowLoading(false); setNotice(null); }
    try {
      const session = await request<{ user: User }>("/api/hestia/session", "GET", undefined, signal);
      const result = await request<{ folders: Folder[] }>("/api/hestia/folders", "GET", undefined, signal);
      if (requestedId) { try { const detail = await request<{folder: Folder}>(`/api/hestia/folders/${requestedId}`, "GET", undefined, signal); result.folders = [...result.folders.filter(f => f.id !== requestedId), detail.folder]; } catch(error) { if (!(error instanceof RequestError && [403,404].includes(error.status))) throw error; result.folders=result.folders.filter(f=>f.id!==requestedId); } }
      if (epoch !== generation.current) return;
      admitted.current = true; setUser(session.user); setFolders(result.folders);validateNameScope(result.folders);
      const pending=pendingOperation.current;
      if(pending){
        const scope=pending.body.folderId ?? pending.body.parentId;
        if(pending.userId!==session.user.id || (scope && !result.folders.some(f=>f.id===scope))){pendingOperation.current=null;setUncertain(false);setPanel(false);setEdit(null);setNewName("");}
        else {nameScope.current=scope??null;setUncertain(true);setPanel(true);setCreateParentId(pending.body.parentId??null);setNewName(pending.body.name);setEdit(pending.body.kind==="rename"?{name:pending.body.name,version:pending.body.version!}:null);setNotice({tone:"warning",title:"Résultat incertain.",text:"Vérifiez le résultat de l’opération précédente avant de recommencer."});}
      }
      setSelectedId(id => { const candidate = requestedId ?? pendingOperation.current?.body.folderId ?? id; return result.folders.some(f => f.id === candidate) ? candidate : null; });
      if (requestedId && !result.folders.some(f => f.id === requestedId)) setNotice({ tone: "danger", title: "Dossier indisponible.", text: "Ce dossier n’est plus accessible. La liste a été actualisée." });
    } catch (error) {
      if (epoch !== generation.current || signal?.aborted) return;
      clearPrivate();
      if (!(error instanceof RequestError && error.status === 401)) setNotice({ tone: "danger", title: "Connexion indisponible.", text: errorMessage(error) });
    } finally { if (epoch === generation.current && !signal?.aborted) setChecking(false); }
  }, [clearPrivate,validateNameScope]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => { if (!controller.signal.aborted) return refresh(controller.signal); });
    const onFocus = () => { if (!document.hidden && !captureValidation.current) void refresh(controller.signal, undefined, true); };
    const onVisibility = () => { if (document.hidden) { ++generation.current; if (admitted.current) { clearPrivate(isNativePickerOpen()); setChecking(true); } } else onFocus(); };
    window.addEventListener("focus", onFocus); window.addEventListener("pageshow", onFocus); document.addEventListener("visibilitychange", onVisibility);
    return () => { controller.abort(); window.removeEventListener("focus", onFocus); window.removeEventListener("pageshow", onFocus); document.removeEventListener("visibilitychange", onVisibility); };
  }, [refresh, clearPrivate]);
  useEffect(() => {
    const received = (event: Event) => {
      const result = (event as CustomEvent<CaptureResult>).detail;
      captureValidation.current = true;
      const epoch = ++generation.current;
      setChecking(true);
      void Promise.all([request<{user: User}>("/api/hestia/session"), request<{folders: Folder[]}>("/api/hestia/folders")]).then(([session, listing]) => {
        if (epoch !== generation.current) return;
        if (session.user.id !== result.userId) { clearPrivate(); return; }
        const folder = listing.folders.find(f => f.id === result.folderId && f.capabilities.includes("déposer"));
        if (!folder) { clearPrivate(); return; }
        admitted.current = true; setUser(session.user); setFolders(listing.folders); setSelectedId(folder.id); setMe(false); setSearch(null); setPendingCapture(result);
      }).catch(() => { if (epoch === generation.current) clearPrivate(); }).finally(() => { captureValidation.current = false; if (epoch === generation.current) setChecking(false); });
    };
    window.addEventListener(CAPTURE_EVENT, received);
    return () => window.removeEventListener(CAPTURE_EVENT, received);
  }, [clearPrivate]);
  useEffect(() => {
    if (!checking) return;
    const timer = window.setTimeout(() => setSlowLoading(true), 8000);
    return () => window.clearTimeout(timer);
  }, [checking]);
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const epoch = generation.current;
      void Promise.all([request<{ user: User }>("/api/hestia/session", "GET", undefined, controller.signal), request<{folders: Folder[]}>("/api/hestia/folders", "GET", undefined, controller.signal)]).then(([, listing]) => { if (!controller.signal.aborted && epoch === generation.current) { setFolders(listing.folders);validateNameScope(listing.folders); const scope=pendingOperation.current?.body.folderId ?? pendingOperation.current?.body.parentId ?? selectedRef.current; if(scope&&!listing.folders.some(f=>f.id===scope)){pendingOperation.current=null;setUncertain(false);setPanel(false);setEdit(null);setNewName("");setSelectedId(null);setNotice({tone:"warning",title:"Accès indisponible.",text:"Ce dossier n’est plus accessible avec votre compte."});} } }).catch(error => {
        if (controller.signal.aborted || epoch !== generation.current) return;
        ++generation.current; clearPrivate(); setNotice({ tone: "danger", title: "Session à vérifier.", text: errorMessage(error) });
      });
    }, 30000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [user, clearPrivate,validateNameScope]);
  async function login(email: string, password: string) {
    if (busy) return;
    setBusy(true); setNotice(null);
    try { await request("/api/auth/sign-in/email", "POST", { email, password }); await refresh(); }
    catch (error) { clearPrivate(); setNotice({ tone: "danger", title: "Connexion impossible.", text: error instanceof RequestError && error.status === 429 ? error.message : "Vérifiez votre adresse e-mail et votre mot de passe, puis réessayez." }); }
    finally { setBusy(false); }
  }
  async function logout() {
    if (busy) return;
    ++generation.current; pendingOperation.current=null; clearPrivate(); setBusy(true); setNotice(null);
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
    nameScope.current=null;
    setFolders(previous => [...previous.filter(f => f.id !== folder.id), folder]);
    setSelectedId(folder.id); setPanel(false); setEdit(null); setNewName(""); setUncertain(false); pendingOperation.current=null;
    setNotice({tone:"success",title:rename ? "Renommé." : "Dossier créé.",text:rename ? "Les accès et le contenu ne changent pas." : parentId ? "Le sous-dossier hérite des accès de son parent. Aucun droit n’est ajouté." : `« ${folder.name} » est privé : personne d’autre que vous n’y a accès tant que vous ne l’avez pas accordé.`});
  }
  async function verifyName() {
    const op=pendingOperation.current; if (!op || busy) return; const epoch=generation.current; setBusy(true);
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
    const op=pendingOperation.current; const epoch=generation.current; setBusy(true);setFieldError(undefined);setNotice(null);
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
  function showFolders() { nameScope.current=null; setPendingCapture(null); setSearch(null); setMe(false); setHousehold(false); setSelectedId(null); setPanel(false); setEdit(null); setFieldError(undefined); }
  function openFolder(id: string) { nameScope.current=null; setPendingCapture(null); setSearch(null); setMe(false); setHousehold(false); setSelectedId(null); setFolders([]); setPanel(false); setEdit(null); setFieldError(undefined); setNotice(null); void refresh(undefined, id); }
  const consumeCapture = useCallback(() => { releaseNativePicker(); setPendingCapture(null); }, []);
  const filesAccessLost = useCallback(() => { ++generation.current; clearPrivate(); }, [clearPrivate]);
  const filesUpdated = useCallback(() => { setNotice(null); const epoch = generation.current; void request<{folders: Folder[]}>("/api/hestia/folders").then(result => { if (epoch === generation.current) {setFolders(result.folders);validateNameScope(result.folders);} }).catch(() => {}); }, [validateNameScope]);
  const message = notice && <Banner tone={notice.tone} title={notice.title} action={uncertain ? "Vérifier le résultat" : notice.action} onAction={uncertain ? () => void verifyName() : notice.onAction}>{notice.text}</Banner>;
  if (checking) return <div ref={heading} className="cdv-root h-root"><main className="h-main" aria-label="Contenu principal"><div className="h-content">{slowLoading ? <Banner title="Le chargement prend plus de temps que prévu.">Hestia attend une réponse du serveur.</Banner> : <Skeleton/>}</div></main></div>;
  if (!user) return <FamilyAuth onLogin={login} busy={busy} notice={message}/>;
  return <div ref={heading} className="cdv-root h-root">
    {activationLink && <Dialog title="Ce lien est destiné à une autre personne" confirmLabel="Me déconnecter et continuer" cancelLabel="Rester connecté·e" busy={busy} onConfirm={() => void logout()} onCancel={() => { setActivationLink(false); window.history.replaceState(null, "", window.location.pathname); }}><p>Vous êtes connecté·e en tant que {user.name} sur cet appareil. Le lien doit être ouvert par sa destinataire, avec son propre compte. Déconnectez-vous d’abord.</p></Dialog>}
    <header className="h-topbar"><Logo dark/><span className="h-household">Instance familiale privée</span><label className="h-top-search"><Icon name="search" size={18}/><input className="cdv-focus" type="search" aria-label="Rechercher un document ou un dossier" placeholder="Rechercher un document ou un dossier" value={search ?? ""} onChange={e => { setPanel(false); setMe(false); setHousehold(false); setSearch(e.target.value); }}/></label><div className="h-topbar-actions"><Button variant="secondary" compact icon="log-out" className="h-desktop-logout" onClick={() => void logout()} loading={busy}>Se déconnecter</Button><Avatar name={user.name || user.email}/></div></header>
    <div className={`h-workspace ${panel ? "h-panel-open" : ""}`}>
      <nav className="h-sidenav" aria-label="Navigation principale"><button className="cdv-focus h-navitem" aria-current={!selected && !me && !household ? "page" : undefined} onClick={showFolders}><Icon name="home"/><span className="h-wide-label">Tous les dossiers</span><span className="h-rail-label">Dossiers</span></button><button className="cdv-focus h-navitem h-rail-me" aria-current={me ? "page" : undefined} onClick={() => { showFolders(); setMe(true); }}><Icon name="user"/><span>Moi</span></button>{(user.role === "owner" || user.role === "admin") && <button className="cdv-focus h-navitem" aria-current={household ? "page" : undefined} onClick={() => { showFolders(); setHousehold(true); }}><Icon name="users"/><span>Foyer</span></button>}<div className="h-separator"/>{roots.map(f => <button key={f.id} className="cdv-focus h-navitem h-folder-nav" aria-current={f.id === selectedId ? "page" : undefined} onClick={() => openFolder(f.id)} title={f.name}><Icon name="folder"/><span>{f.name}</span></button>)}<p className="h-navfooter">Vous ne voyez que les dossiers auxquels vous avez accès.</p></nav>
      <main className="h-main" aria-label="Contenu principal"><div key={household ? "household" : me ? "me" : search !== null ? "search" : selected?.id ?? "root"} className="h-content">{!panel && message}{household && (user.role === "owner" || user.role === "admin") ? <FamilyHousehold onAccessLost={filesAccessLost}/> : me ? <FamilyProfile user={user} onLogout={() => void logout()} onAccessLost={filesAccessLost}/> : search !== null ? <FileWorkspace userId={user.id} key="search" folders={folders} host={fileHost} query={search} onQuery={setSearch} onFolder={openFolder} onAccessLost={filesAccessLost} onUpdated={filesUpdated}/> : !selected ? <><div className="h-heading-actions"><PageHeader title="Dossiers" summary={`${roots.length} dossier${roots.length > 1 ? "s" : ""} accessible${roots.length > 1 ? "s" : ""}`}/><Button icon="folder-plus" onClick={() => beginName(null)}>Nouveau dossier</Button></div>{roots.length ? <ul className="h-document-list">{roots.map(f => <li key={f.id}><button className="cdv-focus h-document-row" onClick={() => openFolder(f.id)}><span className="h-file-count" aria-hidden="true">{f.childCount + f.documentCount}</span><span className="h-row-text"><strong>{f.name}</strong><span>{`${f.childCount + f.documentCount} élément${f.childCount + f.documentCount > 1 ? "s" : ""} · Créé par ${f.createdByName}${roots.filter(other=>other.name.normalize("NFC").toLocaleLowerCase("fr")===f.name.normalize("NFC").toLocaleLowerCase("fr")).length>1 ? ` · depuis le ${shortDate(f.createdAt)}` : ""}` }</span></span></button></li>)}</ul> : <EmptyState title="Aucun dossier accessible pour le moment">Créez un dossier, ou attendez qu’une personne du foyer vous en donne l’accès.</EmptyState>}</> : <><FolderPath key={selected.id} folder={selected} onFolder={openFolder} onRoot={showFolders}/><PageHeader overline="Dossier" title={selected.name} summary={`${selected.childCount} sous-dossier${selected.childCount > 1 ? "s" : ""} · ${selected.documentCount} document${selected.documentCount > 1 ? "s" : ""} · Créé par ${selected.createdByName} le ${shortDate(selected.createdAt)}`}/><div><span className="h-capabilities">Vous pouvez : {selected.capabilities.map(c => c.toLocaleLowerCase("fr")).join(", ")}</span></div><FolderWorkspace onFolder={openFolder} onRename={canModify ? () => beginName(null,true) : undefined} actions={canModify && <Button icon="folder-plus" onClick={() => beginName(selected.id)}>Nouveau sous-dossier</Button>} userId={user.id} key={selected.id} initialCapture={pendingCapture} onCaptureConsumed={consumeCapture} folder={selected} folders={folders} host={fileHost} onAccessLost={filesAccessLost} onUpdated={filesUpdated}/></>}</div></main>
      <div ref={setFileHost} className="h-file-panel-host"/>
      {panel && <aside className="h-panel" aria-label={edit ? "Renommer" : createParentId ? "Nouveau sous-dossier" : "Nouveau dossier"} onKeyDown={event=>{if(event.key==="Escape")closeName();}}>{message}<Button variant="tertiary" compact icon="x" disabled={busy || uncertain} onClick={closeName}>Fermer</Button><form onSubmit={e => void saveFolder(e)} className="h-new-folder"><h2>{edit ? "Renommer" : createParentId ? "Nouveau sous-dossier" : "Nouveau dossier"}</h2><p className="h-hint">{edit ? "Les accès et le contenu ne changent pas." : createParentId ? `Dans « ${folders.find(f=>f.id===createParentId)?.name ?? "ce dossier"} ». Il héritera de ses accès ; aucun droit n’est ajouté, ni pour vous ni pour d’autres.` : "À la racine, dans votre espace. Personne d’autre que vous n’y aura accès tant que vous ne l’aurez pas accordé."}</p><TextField label="Nom du dossier" placeholder="Ex. : Factures" hint="Deux dossiers voisins ne peuvent pas porter le même nom (les majuscules ne comptent pas, les accents si)." value={edit ? edit.name : newName} onChange={e => {if(edit)setEdit({...edit,name:e.target.value});else setNewName(e.target.value);pendingOperation.current=null;}} error={fieldError} maxLength={120} disabled={busy || uncertain}/><div className="h-actions"><Button type="submit" icon="check" loading={busy} disabled={uncertain}>{edit ? "Enregistrer le nom" : "Créer le dossier"}</Button><Button variant="tertiary" disabled={busy || uncertain} onClick={closeName}>Annuler</Button></div></form></aside>}
    </div>
    <nav className="h-bottomnav" aria-label="Navigation principale mobile"><button className="cdv-focus" aria-current={!me && !household && search === null ? "page" : undefined} onClick={showFolders}><Icon name="folder" size={22}/>Dossiers</button><button className="cdv-focus" aria-current={search !== null ? "page" : undefined} onClick={() => { setPanel(false); setMe(false); setHousehold(false); setSearch(""); }}><Icon name="search" size={22}/>Rechercher</button><button className="cdv-focus" aria-current={me ? "page" : undefined} onClick={() => { showFolders(); setMe(true); }}><Icon name="user" size={22}/>Moi</button>{(user.role === "owner" || user.role === "admin") && <button className="cdv-focus" aria-current={household ? "page" : undefined} onClick={() => { showFolders(); setHousehold(true); }}><Icon name="users" size={22}/>Foyer</button>}</nav>
  </div>;
}
