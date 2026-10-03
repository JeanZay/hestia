"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Avatar, Banner, Breadcrumb, Button, EmptyState, Icon, Logo, PageHeader, Skeleton, TextField } from "./design-system";
import { FileWorkspace } from "./file-workspace";
import { FolderWorkspace } from "./access-workspace";
import { CAPTURE_EVENT, clearNativePicker, releaseNativePicker, isNativePickerOpen, type CaptureResult } from "./native-capture";

type User = { id: string; name: string; email: string };
type Folder = { id: string; name: string; version: number; capabilities: string[]; documentCount: number; canShare?: boolean; canAdminister?: boolean };
type Notice = { tone: "info" | "danger" | "success"; title: string; text?: string };
class RequestError extends Error { constructor(public status: number, message: string) { super(message); } }
async function request<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method, credentials: "same-origin", cache: "no-store", signal, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new RequestError(response.status, data?.error?.message || (response.status === 401 ? "Reconnectez-vous pour continuer." : "L’action n’a pas pu aboutir. Réessayez."));
  return data as T;
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Impossible de joindre Hestia. Réessayez.";

export function DocumentsApp() {
  const [user, setUser] = useState<User | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [me, setMe] = useState(false);
  const [pendingCapture, setPendingCapture] = useState<CaptureResult | null>(null);
  const [search, setSearch] = useState<string | null>(null);
  const [fileHost, setFileHost] = useState<HTMLDivElement | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [slowLoading, setSlowLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [panel, setPanel] = useState(false); const [newName, setNewName] = useState("");
  const [edit, setEdit] = useState<{ name: string; version: number } | null>(null);
  const [fieldError, setFieldError] = useState<string>();
  const generation = useRef(0);
  const captureValidation = useRef(false);
  const selected = folders.find(folder => folder.id === selectedId);
  const clearPrivate = useCallback((preservePicker = false) => {
    if (!preservePicker) clearNativePicker();
    setNotice(null); setPendingCapture(null); setSearch(null); setUser(null); setMe(false); setFolders([]); setSelectedId(null); setPanel(false); setEdit(null); setNewName(""); setPassword(""); setFieldError(undefined);
  }, []);
  const refresh = useCallback(async (signal?: AbortSignal, requestedId?: string, background = false) => {
    const epoch = ++generation.current;
    if (!background) { setChecking(true); setSlowLoading(false); setNotice(null); }
    try {
      const session = await request<{ user: User }>("/api/hestia/session", "GET", undefined, signal);
      const result = await request<{ folders: Folder[] }>("/api/hestia/folders", "GET", undefined, signal);
      if (epoch !== generation.current) return;
      setUser(session.user); setFolders(result.folders);
      setSelectedId(id => { const candidate = requestedId ?? id; return result.folders.some(f => f.id === candidate) ? candidate : null; });
      if (requestedId && !result.folders.some(f => f.id === requestedId)) setNotice({ tone: "danger", title: "Dossier indisponible.", text: "Ce dossier n’est plus accessible. La liste a été actualisée." });
    } catch (error) {
      if (epoch !== generation.current || signal?.aborted) return;
      clearPrivate();
      if (!(error instanceof RequestError && error.status === 401)) setNotice({ tone: "danger", title: "Connexion indisponible.", text: errorMessage(error) });
    } finally { if (epoch === generation.current && !signal?.aborted) setChecking(false); }
  }, [clearPrivate]);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => { if (!controller.signal.aborted) return refresh(controller.signal); });
    const onFocus = () => { if (!document.hidden && !captureValidation.current) void refresh(controller.signal, undefined, true); };
    const onVisibility = () => { if (document.hidden) { ++generation.current; clearPrivate(isNativePickerOpen()); setChecking(true); } else onFocus(); };
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
        setUser(session.user); setFolders(listing.folders); setSelectedId(folder.id); setMe(false); setSearch(null); setPendingCapture(result);
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
      void request<{ user: User }>("/api/hestia/session", "GET", undefined, controller.signal).catch(error => {
        if (controller.signal.aborted || epoch !== generation.current) return;
        ++generation.current; clearPrivate(); setNotice({ tone: "danger", title: "Session à vérifier.", text: errorMessage(error) });
      });
    }, 30000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [user, clearPrivate]);
  async function login(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setNotice(null);
    try { await request("/api/auth/sign-in/email", "POST", { email, password }); setPassword(""); await refresh(); }
    catch (error) { clearPrivate(); setNotice({ tone: "danger", title: "Connexion impossible.", text: error instanceof RequestError && error.status === 429 ? error.message : "Vérifiez votre adresse e-mail et votre mot de passe, puis réessayez." }); }
    finally { setBusy(false); }
  }
  async function logout() {
    if (busy) return;
    ++generation.current; clearPrivate(); setBusy(true); setNotice(null);
    try { await request("/api/auth/sign-out", "POST", {}); setNotice({ tone: "info", title: "Vous êtes déconnecté." }); }
    catch { setNotice({ tone: "danger", title: "Déconnexion non confirmée.", text: "Votre session n’a pas pu être fermée sur le serveur. Réessayez de vous déconnecter après reconnexion." }); }
    finally { setBusy(false); }
  }
  async function saveFolder(event: FormEvent, rename = false) {
    event.preventDefault(); if (busy) return;
    const name = (rename ? edit?.name : newName)?.trim();
    if (!name) { setFieldError("Donnez un nom au dossier, par exemple « Lave-linge »."); return; }
    const epoch = generation.current;
    setBusy(true); setFieldError(undefined); setNotice(null);
    try {
      const result = await request<{ folder: Folder }>(rename ? `/api/hestia/folders/${selected!.id}` : "/api/hestia/folders", rename ? "PATCH" : "POST", rename ? { name, version: edit!.version } : { name });
      if (epoch !== generation.current) return;
      setFolders(previous => rename ? previous.map(f => f.id === result.folder.id ? result.folder : f) : [...previous, result.folder]);
      setSelectedId(result.folder.id); setPanel(false); setEdit(null); setNewName("");
      setNotice({ tone: "success", title: rename ? "Nom enregistré." : "Dossier créé.", text: rename ? undefined : `« ${result.folder.name} » est privé : personne d’autre que vous n’y a accès tant que vous ne l’avez pas accordé.` });
    } catch (error) {
      if (epoch !== generation.current) return;
      if (error instanceof RequestError && [401, 403, 404].includes(error.status)) { clearPrivate(); setNotice({ tone: "danger", title: "Accès à vérifier.", text: errorMessage(error) }); }
      else if (error instanceof RequestError && error.status === 409) { setEdit(null); await refresh(); setNotice({ tone: "danger", title: "Le dossier a changé.", text: "Le nom à jour a été rechargé. Votre modification n’a pas écrasé celle d’une autre personne." }); }
      else setNotice({ tone: "danger", title: "Enregistrement impossible.", text: errorMessage(error) });
    } finally { setBusy(false); }
  }
  function showFolders() { setPendingCapture(null); setSearch(null); setMe(false); setSelectedId(null); setPanel(false); setEdit(null); setFieldError(undefined); }
  function openFolder(id: string) { setPendingCapture(null); setSearch(null); setMe(false); setSelectedId(null); setFolders([]); setPanel(false); setEdit(null); setFieldError(undefined); setNotice(null); void refresh(undefined, id); }
  const consumeCapture = useCallback(() => { releaseNativePicker(); setPendingCapture(null); }, []);
  const filesAccessLost = useCallback(() => { ++generation.current; clearPrivate(); }, [clearPrivate]);
  const filesUpdated = useCallback(() => { setNotice(null); const epoch = generation.current; void request<{folders: Folder[]}>("/api/hestia/folders").then(result => { if (epoch === generation.current) setFolders(result.folders); }).catch(() => {}); }, []);
  const message = notice && <Banner tone={notice.tone} title={notice.title}>{notice.text}</Banner>;
  if (checking) return <div className="cdv-root h-root"><main className="h-main" aria-label="Contenu principal"><div className="h-content">{slowLoading ? <Banner title="Le chargement prend plus de temps que prévu.">Hestia attend une réponse du serveur.</Banner> : <Skeleton/>}</div></main></div>;
  if (!user) return <div className="cdv-root h-root"><div className="h-login"><form className="h-login-card" onSubmit={login} aria-labelledby="login-title"><Logo/><div><h1 id="login-title">Connexion</h1><p className="h-hint">Instance familiale privée</p></div>{message}<TextField label="Adresse e-mail" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required disabled={busy}/><TextField label="Mot de passe" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required disabled={busy}/><Button type="submit" loading={busy}>{busy ? "Connexion en cours…" : "Se connecter"}</Button></form></div></div>;
  return <div className="cdv-root h-root">
    <header className="h-topbar"><Logo dark/><span className="h-household">Instance familiale privée</span><label className="h-top-search"><Icon name="search" size={18}/><input className="cdv-focus" type="search" aria-label="Rechercher un document ou un dossier" placeholder="Rechercher un document ou un dossier" value={search ?? ""} onChange={e => { setPanel(false); setMe(false); setSearch(e.target.value); }}/></label><div className="h-topbar-actions"><Button variant="secondary" compact icon="log-out" className="h-desktop-logout" onClick={() => void logout()} loading={busy}>Se déconnecter</Button><Avatar name={user.name || user.email}/></div></header>
    <div className={`h-workspace ${panel ? "h-panel-open" : ""}`}>
      <nav className="h-sidenav" aria-label="Navigation principale"><button className="cdv-focus h-navitem" aria-current={!selected && !me ? "page" : undefined} onClick={showFolders}><Icon name="home"/><span className="h-wide-label">Tous les dossiers</span><span className="h-rail-label">Dossiers</span></button><button className="cdv-focus h-navitem h-rail-me" aria-current={me ? "page" : undefined} onClick={() => { showFolders(); setMe(true); }}><Icon name="user"/><span>Moi</span></button><div className="h-separator"/>{folders.map(f => <button key={f.id} className="cdv-focus h-navitem h-folder-nav" aria-current={f.id === selectedId ? "page" : undefined} onClick={() => openFolder(f.id)} title={f.name}><Icon name="folder"/><span>{f.name}</span></button>)}<p className="h-navfooter">Vous ne voyez que les dossiers auxquels vous avez accès.</p></nav>
      <main className="h-main" aria-label="Contenu principal"><div className="h-content">{!panel && message}{me ? <div className="h-me"><PageHeader title="Moi" summary=""/><div className="h-member-card"><Avatar name={user.name || user.email}/><div><strong>{user.name}</strong><span>{user.email}</span></div></div><div><Button variant="secondary" icon="log-out" onClick={() => void logout()} loading={busy}>Se déconnecter</Button></div></div> : search !== null ? <FileWorkspace userId={user.id} key="search" folders={folders} host={fileHost} query={search} onQuery={setSearch} onFolder={openFolder} onAccessLost={filesAccessLost} onUpdated={filesUpdated}/> : !selected ? <><div className="h-heading-actions"><PageHeader title="Dossiers" summary={`${folders.length} dossier${folders.length > 1 ? "s" : ""} accessible${folders.length > 1 ? "s" : ""}`}/><Button icon="plus" onClick={() => { setPanel(true); setNewName(""); setFieldError(undefined); }}>Nouveau dossier</Button></div>{folders.length ? <ul className="h-document-list">{folders.map(f => <li key={f.id}><button className="cdv-focus h-document-row" onClick={() => openFolder(f.id)}><span className="h-file-count" aria-hidden="true">{f.documentCount}</span><span className="h-row-text"><strong>{f.name}</strong><span>{f.documentCount ? `${f.documentCount} document${f.documentCount > 1 ? "s" : ""}` : "Aucun document"}</span></span></button></li>)}</ul> : <EmptyState title="Aucun dossier accessible pour le moment">Créez un dossier, ou attendez qu’une personne du foyer vous en donne l’accès.</EmptyState>}</> : <><Breadcrumb folderName={selected.name} onFolders={showFolders}/><div className="h-mobile-back"><Button variant="tertiary" compact icon="chevron-left" onClick={showFolders}>Dossiers</Button></div>{edit ? <form className="h-rename" onSubmit={e => void saveFolder(e, true)}><TextField label="Nom du dossier" value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} hint="Les documents et les accès ne changent pas." error={fieldError} maxLength={120} disabled={busy}/><div className="h-actions"><Button type="submit" variant="secondary" icon="check" loading={busy}>Enregistrer le nom</Button><Button variant="tertiary" disabled={busy} onClick={() => { setEdit(null); setFieldError(undefined); }}>Annuler</Button></div></form> : <PageHeader overline="Dossier" title={selected.name} summary={selected.documentCount ? `${selected.documentCount} document${selected.documentCount > 1 ? "s" : ""}` : "Aucun document"}/>}<div><span className="h-capabilities">Vous pouvez : {selected.capabilities.map(c => c.toLocaleLowerCase("fr")).join(", ")}</span></div><FolderWorkspace actions={selected.capabilities.includes("modifier") && !edit && <Button variant="secondary" icon="pencil" onClick={() => { setEdit({ name: selected.name, version: selected.version }); setFieldError(undefined); }}>Renommer</Button>} userId={user.id} key={selected.id} initialCapture={pendingCapture} onCaptureConsumed={consumeCapture} folder={selected} folders={folders} host={fileHost} onAccessLost={filesAccessLost} onUpdated={filesUpdated}/></>}</div></main>
      <div ref={setFileHost} className="h-file-panel-host"/>
      {panel && <aside className="h-panel" aria-label="Nouveau dossier">{message}<Button variant="tertiary" compact icon="x" disabled={busy} onClick={() => setPanel(false)}>Fermer</Button><form onSubmit={e => void saveFolder(e)} className="h-new-folder"><h2>Nouveau dossier</h2><TextField label="Nom du dossier" placeholder="Ex. : Lave-linge" value={newName} onChange={e => setNewName(e.target.value)} error={fieldError} maxLength={120} disabled={busy}/><div className="h-private-note"><span>Personne d’autre que vous n’y aura accès tant que vous ne l’aurez pas accordé.</span></div><div className="h-actions"><Button type="submit" icon="plus" loading={busy}>Créer le dossier</Button><Button variant="tertiary" disabled={busy} onClick={() => setPanel(false)}>Annuler</Button></div></form></aside>}
    </div>
    <nav className="h-bottomnav" aria-label="Navigation principale mobile"><button className="cdv-focus" aria-current={!me && search === null ? "page" : undefined} onClick={showFolders}><Icon name="folder" size={22}/>Dossiers</button><button className="cdv-focus" aria-current={search !== null ? "page" : undefined} onClick={() => { setPanel(false); setMe(false); setSearch(""); }}><Icon name="search" size={22}/>Rechercher</button><button className="cdv-focus" aria-current={me ? "page" : undefined} onClick={() => { showFolders(); setMe(true); }}><Icon name="user" size={22}/>Moi</button></nav>
  </div>;
}
