"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Avatar, Banner, Button, Checkbox, Dialog, EmptyState, Icon, Select, Skeleton, Tabs } from "./design-system";
import { FileWorkspace, type FileDocument } from "./file-workspace";
import type { CaptureResult } from "./native-capture";

type Folder = { id: string; name: string; capabilities: string[]; documentCount: number; canShare?: boolean; canAdminister?: boolean };
type Grant = {id: string; memberId: string; memberName: string; capabilities: string[]; createdAt: string; canRevoke: boolean; kind: "direct" | "delegated" | "reference"};
type Sharing = {members: {id: string; name: string; canExport: boolean; canDeposit: boolean; canExportAndDeposit: boolean}[]};
type Trashed = FileDocument & {trashedAt: string; restorableUntil: string; trashedByName: string};
type Notice = {title: string; text: string; tone: "success" | "danger" | "info"};
class AccessError extends Error { constructor(public status: number, message: string) { super(message); } }
async function request<T>(path: string, signal: AbortSignal, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/hestia${path}`, {method, signal, credentials:"same-origin", cache:"no-store", headers:body === undefined ? undefined : {"Content-Type":"application/json"}, body:body === undefined ? undefined : JSON.stringify(body)});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new AccessError(response.status, data.error?.message || "L’action n’a pas pu aboutir. Réessayez.");
  return data as T;
}
const date = (value: string) => new Date(value).toLocaleString("fr-FR", {dateStyle:"short", timeStyle:"short"});

export function FolderWorkspace({userId, folder, folders, host, onAccessLost, onUpdated, initialCapture, onCaptureConsumed, actions}: {userId: string; folder: Folder; folders: Folder[]; host: HTMLElement | null; onAccessLost: () => void; onUpdated: () => void; initialCapture?: CaptureResult | null; onCaptureConsumed?: () => void; actions?: ReactNode}) {
  const [tab, setTab] = useState("docs");
  const [share, setShare] = useState(false);
  const [fileGeneration, setFileGeneration] = useState(0);
  const [context, setContext] = useState<Sharing | null>(null);
  const [memberId, setMemberId] = useState("");
  const [exp, setExp] = useState(true); const [deposit, setDeposit] = useState(false);
  const [grants, setGrants] = useState<Grant[]>([]); const [trash, setTrash] = useState<Trashed[]>([]);
  const [expiresIn, setExpiresIn] = useState<number | null>(null);
  const [revoke, setRevoke] = useState<Grant | null>(null);
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const control = useRef(new AbortController()); const sequence = useRef(0); const operation = useRef<string | null>(null);
  const canTrash = folder.capabilities.includes("consulter") && folder.capabilities.includes("supprimer");
  const showShare = share && !!folder.canShare;
  const activeTab = tab === "access" && !folder.canAdminister || tab === "trash" && !canTrash ? "docs" : tab;
  const fail = useCallback((error: unknown) => {
    if (control.current.signal.aborted) return;
    if (error instanceof AccessError && [401,403,404].includes(error.status)) { onAccessLost(); return; }
    setNotice({tone:"danger",title:"Action non confirmée.",text:error instanceof Error ? error.message : "Impossible de joindre Hestia. Réessayez."});
  }, [onAccessLost]);
  useEffect(() => { const controller = new AbortController(); control.current = controller; return () => controller.abort(); }, []);
  const load = useCallback(async () => {
    const epoch = ++sequence.current; const signal = control.current.signal;
    setLoading(true); setGrants([]); setTrash([]);
    try {
      if (activeTab === "access") { const result = await request<{grants: Grant[]}>(`/folders/${folder.id}/access`, signal); if (!signal.aborted && epoch === sequence.current) setGrants(result.grants); }
      if (activeTab === "trash") { const result = await request<{documents: Trashed[]; now: string}>(`/documents?folderId=${folder.id}&trash=true`, signal); if (!signal.aborted && epoch === sequence.current) { const live = result.documents.filter(d => Date.parse(d.restorableUntil) > Date.parse(result.now)); setTrash(live); setExpiresIn(live.length ? Math.min(...live.map(d => Date.parse(d.restorableUntil) - Date.parse(result.now))) : null); } }
    } catch (error) { if (!signal.aborted && epoch === sequence.current) fail(error); }
    finally { if (!signal.aborted && epoch === sequence.current) setLoading(false); }
  }, [activeTab, folder, fail]);
  useEffect(() => { const sequencing = sequence; const timer = setTimeout(() => void load(), 0); return () => { clearTimeout(timer); ++sequencing.current; }; }, [load]);
  useEffect(() => { if (activeTab !== "trash" || expiresIn === null) return; const timer = setTimeout(() => void load(), Math.max(1, expiresIn)); return () => clearTimeout(timer); }, [activeTab, expiresIn, load]);
  async function openShare() {
    // Opening the share panel closes and cleans up any prior document/upload
    // transient state, while keeping the approved main tab composition present.
    setFileGeneration(value => value + 1);
    setShare(true); setContext(null); setNotice(null); setBusy(true); operation.current = null;
    const signal = control.current.signal;
    try { const result = await request<Sharing>(`/folders/${folder.id}/sharing`, signal); if (!signal.aborted) { setContext(result); setMemberId(result.members[0]?.id || ""); setExp(!!result.members[0]?.canExport); setDeposit(false); } }
    catch (error) { if (!signal.aborted) fail(error); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  async function grant() {
    if (busy || !selectedMember || (exp && !selectedMember.canExport) || (deposit && !selectedMember.canDeposit) || (exp && deposit && !selectedMember.canExportAndDeposit)) return;
    setBusy(true); setNotice(null); operation.current ||= crypto.randomUUID();
    const signal = control.current.signal;
    try {
      await request(`/folders/${folder.id}/sharing`, signal, "POST", {memberId,export:exp,deposit,idempotencyKey:operation.current});
      if (signal.aborted) return;
      setShare(false); setContext(null); operation.current = null;
      setNotice({tone:"success",title:"Accès accordé.",text:"L’accès porte sur tous les documents actuels et futurs du dossier."});
      if (folder.canAdminister) { if (activeTab === "access") await load(); else setTab("access"); }
      onUpdated();
    } catch (error) { if (!signal.aborted) fail(error); }
    finally { if (!signal.aborted) setBusy(false); }
  }
  async function removeGrant() {
    if (!revoke || busy) return;
    setBusy(true); setNotice(null); const signal = control.current.signal;
    try {
      const result = await request<{success: boolean; remainingAccess: boolean}>(`/folders/${folder.id}/access/${revoke.id}`, signal, "DELETE");
      if (signal.aborted) return;
      setRevoke(null); await load(); onUpdated();
      setNotice({tone:"success",title:"Accès retiré.",text:result.remainingAccess ? "Cette personne conserve un autre accès valide. Les copies déjà téléchargées restent sur son appareil." : "Cette personne n’a plus accès au dossier. Les copies déjà téléchargées restent sur son appareil."});
    } catch (error) { if (!signal.aborted) { setRevoke(null); fail(error); } }
    finally { if (!signal.aborted) setBusy(false); }
  }
  async function restore(doc: Trashed) {
    if (busy) return;
    setBusy(true); setNotice(null); const signal = control.current.signal;
    try {
      await request(`/documents/${doc.id}/restore`, signal, "POST", {version:doc.version});
      if (signal.aborted) return;
      await load(); onUpdated();
      setNotice({tone:"success",title:"Restauré.",text:`« ${doc.title} » est de nouveau dans le dossier, visible par les personnes qui y ont accès aujourd’hui. Les accès retirés entre-temps ne sont pas rétablis.`});
    } catch (error) { if (!signal.aborted) { await load(); fail(error); } }
    finally { if (!signal.aborted) setBusy(false); }
  }
  const tabs = [{id:"docs",label:`Documents · ${folder.documentCount}`}, ...(folder.canAdminister ? [{id:"access",label:"Accès"}] : []), ...(canTrash ? [{id:"trash",label:"Corbeille"}] : [])];
  const selectedMember = context?.members.find(member => member.id === memberId);
  const selectedName = selectedMember?.name || "Cette personne";
  const exportUnavailable = !selectedMember?.canExport || (deposit && !selectedMember.canExportAndDeposit);
  const depositUnavailable = !selectedMember?.canDeposit || (exp && !selectedMember.canExportAndDeposit);
  const combinationHint = "Vous ne pouvez pas transmettre Exporter et Déposer ensemble à cette personne. Décochez l’autre capacité pour choisir celle-ci.";
  const banner = notice && <Banner tone={notice.tone} title={notice.title}>{notice.text}</Banner>;
  return <>
    {(actions || folder.canShare) && <div className="h-actions">{actions}{folder.canShare && <Button variant="secondary" icon="share" disabled={busy} onClick={() => void openShare()}>Donner accès</Button>}</div>}
    {tabs.length > 1 && <Tabs items={tabs} active={activeTab} onChange={value => { setTab(value); setShare(false); setNotice(null); }}/>}
    {!showShare && banner}
    {activeTab === "docs" && <FileWorkspace key={fileGeneration} suppressPanel={showShare} onOpenPanel={() => { setShare(false); setNotice(null); }} userId={userId} folder={folder} folders={folders} host={host} onAccessLost={onAccessLost} onUpdated={onUpdated} initialCapture={initialCapture} onCaptureConsumed={onCaptureConsumed}/>}
    {activeTab === "access" && <div className="h-file-stack" role="tabpanel" aria-label="Accès"><p className="h-access-copy">Chaque accès porte sur le dossier entier : tous ses documents actuels et futurs. Les fichiers déjà téléchargés par une personne restent sur son appareil, même après le retrait de son accès.</p>{loading ? <Skeleton/> : <ul className="h-document-list">{grants.map(g => <li className="h-access-row" key={g.id}><Avatar name={g.memberName}/><div className="h-access-text"><div><strong>{g.memberName}{g.memberId === userId ? " (vous)" : ""}</strong><small>{g.kind === "reference" ? "A créé le dossier" : "Accès accordé"} · {date(g.createdAt)}</small></div><span className="h-capabilities">Peut : {g.capabilities.join(", ")}</span></div>{g.canRevoke && <Button variant="danger" compact disabled={busy} aria-label={`Retirer l’accès accordé à ${g.memberName}`} onClick={() => setRevoke(g)}>Retirer l’accès</Button>}</li>)}</ul>}</div>}
    {activeTab === "trash" && <div className="h-file-stack" role="tabpanel" aria-label="Corbeille"><p className="h-access-copy">Un document mis à la corbeille n’est plus consultable, téléchargeable ni trouvé par la recherche, pour personne. Il reste récupérable 7 jours, puis il est supprimé de Hestia.</p>{loading ? <Skeleton/> : trash.length ? <ul className="h-document-list">{trash.map(doc => <li className="h-access-row" key={doc.id}><span className={`h-file-thumb ${doc.mediaType === "application/pdf" ? "h-file-pdf" : "h-file-image"}`} aria-hidden="true">{doc.mediaType === "application/pdf" ? "PDF" : "IMG"}</span><div className="h-access-text"><div><strong>{doc.title}</strong><small>Mis à la corbeille par {doc.trashedByName} le {date(doc.trashedAt)}</small></div><span className="h-trash-deadline"><Icon name="clock" size={14}/>Récupérable jusqu’au {date(doc.restorableUntil)}</span></div><Button variant="secondary" compact icon="rotate-ccw" loading={busy} aria-label={`Restaurer « ${doc.title} »`} onClick={() => void restore(doc)}>Restaurer</Button></li>)}</ul> : <EmptyState icon="trash" title="La corbeille est vide">Les documents mis à la corbeille de ce dossier apparaîtront ici pendant 7 jours.</EmptyState>}</div>}
    {revoke && folder.canAdminister && <Dialog title={`Retirer l’accès accordé à ${revoke.memberName} ?`} confirmLabel="Retirer l’accès" busy={busy} onCancel={() => setRevoke(null)} onConfirm={() => void removeGrant()}>Cet accès et les attributions qui en dépendent seront retirés. Les autres accès valides sont conservés. Les fichiers déjà téléchargés restent sur son appareil.</Dialog>}
    {showShare && host && createPortal(<aside className="h-panel h-files-panel" aria-label="Donner accès"><Button variant="tertiary" compact icon="x" disabled={busy} onClick={() => { setShare(false); setNotice(null); }}>Fermer</Button>{banner}<div className="h-file-stack"><h2>Donner accès à « {folder.name} »</h2><span className="h-hint">L’accès porte sur tous les documents actuels et futurs du dossier. Il n’est pas possible d’exclure un document.</span>{!context ? (busy ? <Skeleton/> : null) : context.members.length ? <form className="h-file-stack" onSubmit={event => {event.preventDefault(); void grant();}}><Select label="Personne du foyer" hint="Compte familial existant" options={context.members.map(member => ({value:member.id,label:member.name}))} value={memberId} disabled={busy} onChange={value => {setMemberId(value); setExp(!!context.members.find(member => member.id === value)?.canExport); setDeposit(false); operation.current=null;}}/><fieldset className="h-share-fieldset"><legend>Ce que {selectedName} pourra faire</legend><div className="h-share-consult"><span className="h-capabilities">Consulter</span><span className="h-hint">Toujours inclus : voir les documents et les retrouver par la recherche.</span></div><Checkbox label="Exporter : télécharger les fichiers" description={exportUnavailable ? (selectedMember?.canExport ? combinationHint : "Vous ne pouvez pas transmettre cette capacité à cette personne.") : "Enregistrer une copie sur son appareil, par exemple pour l’envoyer au SAV."} checked={exp} disabled={busy || exportUnavailable} onChange={value => {setExp(value); operation.current=null;}}/><Checkbox label="Déposer : ajouter des documents" description={depositUnavailable ? (selectedMember?.canDeposit ? combinationHint : "Vous ne pouvez pas transmettre cette capacité à cette personne.") : "Par exemple le compte rendu de réparation. Ne permet ni de renommer ni de supprimer."} checked={deposit} disabled={busy || depositUnavailable} onChange={value => {setDeposit(value); operation.current=null;}}/></fieldset><Banner title="À savoir.">Cet accès ne permet ni de renommer, ni de mettre à la corbeille, ni d’administrer, ni de donner accès à d’autres personnes.</Banner><div role="status"><span className="h-capabilities">{selectedName} pourra : {["consulter",exp && "exporter",deposit && "déposer"].filter(Boolean).join(", ")}</span></div><div className="h-actions"><Button type="submit" icon="share" loading={busy}>Donner accès</Button><Button variant="tertiary" disabled={busy} onClick={() => {setShare(false);setNotice(null);}}>Annuler</Button></div></form> : <EmptyState icon="users" title="Personne d’autre à ajouter">Aucun autre compte du foyer ne peut recevoir cet accès pour le moment.</EmptyState>}</div></aside>, host)}
  </>;
}
