"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Avatar, Banner, Button, Checkbox, Dialog, EmptyState, Icon, Select, Skeleton, Tabs } from "./design-system";
import { FolderActions, type TreeFolder } from "./folder-tree";
import { FamilyManagement } from "./family-management";
import { FileWorkspace, type FileDocument } from "./file-workspace";
import type { MoveSource } from "./move-workspace";
import type { CaptureResult } from "./native-capture";

type Grant = {id: string; memberId: string; memberName: string; capabilities: string[]; createdAt: string; canRevoke: boolean; kind: "direct" | "delegated" | "reference"; inherited?: boolean; provenanceLabel?: string};
type Restriction = {id?: string; memberId: string; memberName: string; capabilities: string[]; inherited: boolean; canLift: boolean};
type AccessMember = {id: string; name: string; capabilities: string[]; restrictableCapabilities: string[]};
type Access = {grants: Grant[]; restrictions: Restriction[]; members: AccessMember[]};
type SharingMember = {id: string; name: string; allowedCapabilitySets: string[][]};
type Sharing = {members: SharingMember[]};
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
const labels: Record<string,string> = {consulter:"Consulter",déposer:"Déposer",modifier:"Modifier",supprimer:"Supprimer",exporter:"Exporter",partager:"Partager",administrer:"Administrer"};
const descriptions: Record<string,string> = {déposer:"Ajouter des documents.",modifier:"Renommer, ranger, créer des sous-dossiers.",supprimer:"Mettre à la corbeille et restaurer.",exporter:"Télécharger les fichiers."};

export function FolderWorkspace({userId, folder, folders, host, onAccessLost, onUpdated, initialCapture, onCaptureConsumed, actions, onFolder, onRename, onMove, onTrash}: {userId: string; folder: TreeFolder; folders: TreeFolder[]; host: HTMLElement | null; onAccessLost: () => void; onUpdated: () => void; initialCapture?: CaptureResult | null; onCaptureConsumed?: () => void; actions?: ReactNode; onFolder: (id:string)=>void; onRename?:()=>void; onMove?:(source:MoveSource)=>void; onTrash?:()=>void}) {
  const [tab, setTab] = useState("docs");
  const [panel, setPanel] = useState<"share" | "person" | "restrict" | null>(null);
  const [fileGeneration, setFileGeneration] = useState(0);
  const [context, setContext] = useState<Sharing | null>(null);
  const [memberId, setMemberId] = useState("");
  const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>([]);
  const [restrictionCapabilities, setRestrictionCapabilities] = useState<string[]>([]);
  const [access, setAccess] = useState<Access>({grants:[],restrictions:[],members:[]});
  const [personId, setPersonId] = useState<string | null>(null);
  const [trash, setTrash] = useState<Trashed[]>([]);
  const [expiresIn, setExpiresIn] = useState<number | null>(null);
  const [revoke, setRevoke] = useState<Grant | null>(null);
  const [lift, setLift] = useState<Restriction | null>(null);
  const [loading, setLoading] = useState(false); const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const control = useRef(new AbortController()); const sequence = useRef(0); const operation = useRef<string | null>(null);
  const canTrash = folder.capabilities.includes("consulter") && folder.capabilities.includes("supprimer");
  const canAccess = !!(folder.canShare || folder.canAdminister);
  const showShare = panel === "share" && canAccess;
  const activeTab = tab === "access" && !canAccess || tab === "trash" && !canTrash ? "docs" : tab;
  const grants=access.grants, restrictions=access.restrictions;
  const people=access.members.filter(member=>member.capabilities.length>0 || grants.some(g=>g.memberId===member.id) || restrictions.some(r=>r.memberId===member.id));
  const person=people.find(member=>member.id===personId);
  const fail = useCallback((error: unknown) => {
    if (control.current.signal.aborted) return;
    if (error instanceof AccessError && error.status===401) { onAccessLost(); return; }
    if (error instanceof AccessError && [403,404].includes(error.status)) {setAccess({grants:[],restrictions:[],members:[]});setContext(null);setPanel(null);onUpdated();}
    setNotice({tone:"danger",title:"Action non confirmée.",text:error instanceof Error ? error.message : "Impossible de joindre Hestia. Réessayez."});
  }, [onAccessLost,onUpdated]);
  useEffect(() => { const controller = new AbortController(); control.current = controller; return () => controller.abort(); }, []);
  useEffect(() => { if (panel) panelRef.current?.querySelector<HTMLElement>("h2")?.focus(); },[panel,personId]);
  const load = useCallback(async () => {
    const epoch = ++sequence.current; const signal = control.current.signal;
    setLoading(true); setAccess({grants:[],restrictions:[],members:[]}); setTrash([]);
    try {
      if (activeTab === "access") { const result = await request<Access>(`/folders/${folder.id}/access`, signal); if (!signal.aborted && epoch === sequence.current) setAccess(result); }
      if (activeTab === "trash") { const result = await request<{documents: Trashed[]; now: string}>(`/documents?folderId=${folder.id}&trash=true`, signal); if (!signal.aborted && epoch === sequence.current) { const live = result.documents.filter(d => Date.parse(d.restorableUntil) > Date.parse(result.now)); setTrash(live); setExpiresIn(live.length ? Math.min(...live.map(d => Date.parse(d.restorableUntil) - Date.parse(result.now))) : null); } }
    } catch (error) { if (!signal.aborted && epoch === sequence.current) fail(error); }
    finally { if (!signal.aborted && epoch === sequence.current) setLoading(false); }
  }, [activeTab, folder, fail]);
  useEffect(() => { const sequencing = sequence; const timer = setTimeout(() => void load(), 0); return () => { clearTimeout(timer); ++sequencing.current; }; }, [load]);
  useEffect(() => { if (activeTab !== "trash" || expiresIn === null) return; const timer = setTimeout(() => void load(), Math.max(1, expiresIn)); return () => clearTimeout(timer); }, [activeTab, expiresIn, load]);
  function closePanel(){if(busy)return;setPanel(null);setContext(null);setNotice(null);operation.current=null;}
  async function openShare() {
    setFileGeneration(value => value + 1);setPanel("share");setContext(null);setNotice(null);setBusy(true);operation.current=null;setSelectedCapabilities([]);
    const signal=control.current.signal;
    try {const result=await request<Sharing>(`/folders/${folder.id}/sharing`,signal);if(!signal.aborted){setContext(result);setMemberId(result.members[0]?.id||"");}}
    catch(error){if(!signal.aborted)fail(error);}finally{if(!signal.aborted)setBusy(false);}
  }
  const selectedMember=context?.members.find(member=>member.id===memberId);
  const allowed=(caps:string[])=>!!selectedMember?.allowedCapabilitySets.some(set=>["consulter",...caps].every(cap=>set.includes(cap)));
  async function grant(){
    if(busy||!selectedMember||!allowed(selectedCapabilities))return;
    setBusy(true);setNotice(null);operation.current ||= crypto.randomUUID();const signal=control.current.signal;
    try {await request(`/folders/${folder.id}/sharing`,signal,"POST",{memberId,export:selectedCapabilities.includes("exporter"),deposit:selectedCapabilities.includes("déposer"),modify:selectedCapabilities.includes("modifier"),delete:selectedCapabilities.includes("supprimer"),idempotencyKey:operation.current});if(signal.aborted)return;setPanel(null);setContext(null);operation.current=null;setNotice({tone:"success",title:"Accès accordé.",text:"S’applique à ce dossier et à tous ses sous-dossiers, sauf là où une restriction existe."});if(activeTab==="access")await load();else setTab("access");onUpdated();}
    catch(error){if(!signal.aborted)fail(error);}finally{if(!signal.aborted)setBusy(false);}
  }
  async function removeGrant(){
    if(!revoke||busy)return;setBusy(true);setNotice(null);const signal=control.current.signal;
    try{const result=await request<{success:boolean;remainingAccess:boolean}>(`/folders/${folder.id}/access/${revoke.id}`,signal,"DELETE");if(signal.aborted)return;setRevoke(null);await load();onUpdated();setNotice({tone:"success",title:"Accès retiré.",text:result.remainingAccess?"Cette personne conserve un autre accès valide. Les copies déjà téléchargées restent sur son appareil.":"Cette personne n’a plus accès au dossier. Les copies déjà téléchargées restent sur son appareil."});}catch(error){if(!signal.aborted){setRevoke(null);fail(error);}}finally{if(!signal.aborted)setBusy(false);}
  }
  async function restrict(restricted:boolean,target=personId,caps=restrictionCapabilities){
    if(busy||!target||!caps.length)return;setBusy(true);setNotice(null);const signal=control.current.signal;
    try{await request(`/folders/${folder.id}/restrictions`,signal,"POST",{memberId:target,capabilities:caps,restricted});if(signal.aborted)return;setLift(null);setPanel("person");setRestrictionCapabilities([]);await load();onUpdated();setNotice({tone:"success",title:restricted?"Restriction enregistrée.":"Restriction levée.",text:restricted?"Les autres droits continuent d’être hérités. Un accès ajouté plus bas ne pourra pas contourner cette restriction.":"Les droits encore hérités s’appliquent à nouveau. Aucun accès révoqué ou expiré n’est rétabli."});}catch(error){if(!signal.aborted){setLift(null);fail(error);}}finally{if(!signal.aborted)setBusy(false);}
  }
  async function restore(doc: Trashed) {
    if (busy) return;setBusy(true);setNotice(null);const signal=control.current.signal;
    try{await request(`/documents/${doc.id}/restore`,signal,"POST",{version:doc.version});if(signal.aborted)return;await load();onUpdated();setNotice({tone:"success",title:"Restauré.",text:`« ${doc.title} » est de nouveau dans le dossier, visible par les personnes qui y ont accès aujourd’hui. Les accès retirés entre-temps ne sont pas rétablis.`});}catch(error){if(!signal.aborted){await load();fail(error);}}finally{if(!signal.aborted)setBusy(false);}
  }
  const tabs=[{id:"docs",label:`Contenu · ${folder.documentCount + folder.childCount}`},...(canAccess?[{id:"access",label:"Accès"}]:[]),...(canTrash?[{id:"trash",label:"Corbeille"}]:[])];
  const banner=notice&&<Banner tone={notice.tone} title={notice.title}>{notice.text}</Banner>;
  const personGrants=grants.filter(g=>g.memberId===personId),personRestrictions=restrictions.filter(r=>r.memberId===personId);
  const panelTitle=showShare?`Donner accès à « ${folder.name} »`:panel==="restrict"?`Restreindre ${person?.name??"cette personne"} ici`:person?.name??"Accès d’une personne";
  return <>
    <div className="h-actions">{actions}<FolderActions onTrash={canTrash?onTrash:undefined} onMove={onMove&&folder.capabilities.includes("modifier")?()=>{setPanel(null);onMove({kind:"folder",id:folder.id,name:folder.name,folderId:folder.id,parentId:folder.visibleParentId});}:undefined} onRename={onRename} onAccess={canAccess?()=>{setTab("access");setPanel(null);}:undefined}/></div>
    {tabs.length>1&&<Tabs items={tabs} active={activeTab} onChange={value=>{setTab(value);setPanel(null);setNotice(null);}}/>}
    {!panel&&banner}
    {activeTab==="docs"&&<FileWorkspace onMove={onMove} key={fileGeneration} suppressPanel={!!panel} onOpenPanel={()=>{setPanel(null);setNotice(null);}} userId={userId} folder={folder} folders={folders} onFolder={onFolder} host={host} onAccessLost={onAccessLost} onUpdated={onUpdated} initialCapture={initialCapture} onCaptureConsumed={onCaptureConsumed}/>}
    {activeTab==="access"&&<div className="h-file-stack" role="tabpanel" aria-label="Accès">{folder.canAdminister&&<FamilyManagement folderId={folder.id} onAccessLost={onAccessLost} onDone={()=>{++sequence.current;setAccess({grants:[],restrictions:[],members:[]});setTab("docs");setPanel(null);setNotice({tone:"success",title:"Gestion transmise.",text:"La responsabilité de gérer les accès est reprise. Aucun droit sur les documents n’est ajouté ni prolongé."});onUpdated();}}/>}<p className="h-access-copy">Les accès viennent de « {folder.name} » ou de ses dossiers parents, et s’appliquent aux sous-dossiers. Une exception locale (accès propre ou restriction) ne vaut que pour ce dossier et ce qu’il contient.</p><Button variant="secondary" icon="share" disabled={busy} onClick={()=>void openShare()}>Donner accès</Button>{loading?<Skeleton/>:<ul className="h-document-list">{people.map(member=>{const rs=restrictions.filter(r=>r.memberId===member.id),gs=grants.filter(g=>g.memberId===member.id);const status=rs.some(r=>!r.inherited)?"Restreint ici":rs.length?"Restreint plus haut":gs.some(g=>!g.inherited&&g.kind!=="reference")?"Accès propre ici":gs.some(g=>g.kind==="reference")?"Gère":"Hérité";return <li key={member.id}><button type="button" className="cdv-focus h-document-row" onClick={()=>{setPersonId(member.id);setPanel("person");setNotice(null);}}><Avatar name={member.name}/><span className="h-row-text"><strong>{member.name}{member.id===userId?" (vous)":""}</strong><span>{member.capabilities.length?`Peut : ${member.capabilities.join(", ")}`:"Aucun accès ici"}</span></span><span className="h-capabilities" style={rs.length?{borderStyle:"dashed"}:undefined}>{status}</span></button></li>;})}</ul>}</div>}
    {/* Existing individual-document trash remains available; folder groups are a later tranche. */}
    {activeTab === "trash" && <div className="h-file-stack" role="tabpanel" aria-label="Corbeille">{loading ? <Skeleton/> : trash.length ? <ul className="h-document-list">{trash.map(doc => <li className="h-access-row" key={doc.id}><Icon name="trash"/><div className="h-access-text"><div><strong>{doc.title}</strong><small>Mis à la corbeille par {doc.trashedByName} le {date(doc.trashedAt)}</small></div><span className="h-trash-deadline"><Icon name="clock" size={14}/>Récupérable jusqu’au {date(doc.restorableUntil)}</span></div><Button variant="secondary" compact icon="rotate-ccw" loading={busy} aria-label={`Restaurer « ${doc.title} »`} onClick={() => void restore(doc)}>Restaurer</Button></li>)}</ul> : <EmptyState icon="trash" title="La corbeille est vide">Les documents mis à la corbeille de ce dossier apparaîtront ici pendant 7 jours.</EmptyState>}</div>}
    {revoke&&<Dialog title={`Retirer l’accès propre de ${revoke.memberName} ?`} confirmLabel="Retirer l’accès propre" busy={busy} onCancel={()=>setRevoke(null)} onConfirm={()=>void removeGrant()}>Cet accès et les attributions qui en dépendent seront retirés. Les autres accès valides sont conservés. Les fichiers déjà téléchargés restent sur son appareil.</Dialog>}
    {lift&&<Dialog title={`Lever la restriction de ${lift.memberName} ?`} confirmLabel="Lever la restriction" busy={busy} onCancel={()=>setLift(null)} onConfirm={()=>void restrict(false,lift.memberId,lift.capabilities)}>Cette personne retrouvera les droits encore hérités des dossiers parents, et rien de plus. Aucun accès révoqué ou expiré n’est rétabli.</Dialog>}
    {panel&&canAccess&&host&&createPortal(<aside ref={panelRef} className="h-panel h-files-panel" aria-label={panelTitle} onKeyDown={event=>{if(event.key==="Escape")closePanel();}}><Button variant="tertiary" compact icon="x" disabled={busy} onClick={closePanel}>Fermer</Button>{banner}<div className="h-file-stack"><h2 tabIndex={-1}>{panelTitle}</h2>
      {showShare&&(!context?(busy?<Skeleton/>:null):context.members.length?<form className="h-file-stack" onSubmit={event=>{event.preventDefault();void grant();}}><p className="h-hint">S’applique à « {folder.name} » et à tous ses sous-dossiers, sauf là où une restriction existe.</p><Select label="Personne du foyer" options={context.members.map(member=>({value:member.id,label:member.name}))} value={memberId} disabled={busy} onChange={value=>{setMemberId(value);setSelectedCapabilities([]);operation.current=null;}}/><fieldset className="h-share-fieldset"><legend>Ce que cette personne pourra faire</legend><div className="h-share-consult"><span className="h-capabilities">Consulter</span><span className="h-hint">Toujours inclus.</span></div>{["déposer","modifier","supprimer","exporter"].map(cap=>{const checked=selectedCapabilities.includes(cap);const off=!checked&&!allowed([...selectedCapabilities,cap]);return <Checkbox key={cap} label={labels[cap]} description={off?"Vous ne pouvez pas transmettre ce droit avec les droits sélectionnés.":descriptions[cap]} checked={checked} disabled={busy||off} onChange={value=>{setSelectedCapabilities(old=>value?[...old,cap]:old.filter(c=>c!==cap));operation.current=null;}}/>;})}</fieldset><div className="h-actions"><Button type="submit" icon="share" loading={busy} disabled={!allowed(selectedCapabilities)}>Donner accès</Button><Button variant="tertiary" disabled={busy} onClick={closePanel}>Annuler</Button></div></form>:<EmptyState icon="users" title="Personne d’autre à ajouter">Aucun autre compte du foyer ne peut recevoir cet accès pour le moment.</EmptyState>)}
      {panel==="person"&&(loading?<Skeleton/>:person?<><span className="h-hint">Dans « {folder.name} » et ses sous-dossiers</span><p className="h-capabilities" style={{maxWidth:"100%",whiteSpace:"normal",overflowWrap:"anywhere"}}>{person.capabilities.length?`Peut : ${person.capabilities.join(", ")}`:"Aucun accès ici"}</p><ul style={{margin:0,padding:0,listStyle:"none",display:"flex",flexDirection:"column",gap:10}}>{personGrants.map(g=><li key={g.id} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"10px 12px",border:"1.5px solid var(--cdv-border-strong)",borderRadius:"var(--cdv-radius-l)",fontSize:15,lineHeight:1.45}}><Icon name={g.kind==="reference"?"key":g.inherited?"arrow-down":"check"} size={18}/><span><strong>{g.kind==="reference"?"Gestion :":g.inherited?"Hérité d’un dossier parent :":"Accès propre à ce dossier :"}</strong> {g.kind==="reference"?"Partager, administrer. Ne donne aucun droit sur les documents.":g.capabilities.join(", ")}.{g.provenanceLabel&&` ${g.provenanceLabel}`}</span></li>)}{personRestrictions.map((r,i)=><li key={r.id??`${r.memberId}-${i}`} style={{display:"flex",gap:10,alignItems:"flex-start",padding:"10px 12px",border:"1.5px dashed var(--cdv-border-strong)",borderRadius:"var(--cdv-radius-l)",fontSize:15,lineHeight:1.45}}><Icon name="ban" size={18}/><span><strong>{r.inherited?"Restreint depuis un dossier parent :":"Restreint ici :"}</strong> ne peut pas {r.capabilities.join(", ")}, ici et dans les sous-dossiers. Un accès ajouté plus bas ne peut pas contourner cette restriction.</span></li>)}</ul>{personRestrictions.some(r=>r.inherited)&&<p className="h-hint">Cette restriction se lève sur le dossier parent, avec l’autorité de gestion de ce dossier.</p>}<div className="h-actions">{person.id!==userId&&person.restrictableCapabilities.length>0&&<Button variant="secondary" icon="ban" onClick={()=>{setRestrictionCapabilities([]);setPanel("restrict");}}>Restreindre ici…</Button>}{personRestrictions.filter(r=>r.canLift&&!r.inherited).map((r,i)=><Button key={r.id??i} variant="secondary" icon="check" onClick={()=>setLift(r)}>Lever la restriction</Button>)}{personGrants.filter(g=>g.canRevoke&&!g.inherited).map(g=><Button key={g.id} variant="danger" onClick={()=>setRevoke(g)}>Retirer l’accès propre</Button>)}</div></>:<Banner title="Accès indisponible.">Ces informations ne sont plus disponibles avec vos accès.</Banner>)}
      {panel==="restrict"&&person&&<form className="h-file-stack" onSubmit={event=>{event.preventDefault();void restrict(true);}}><p className="h-hint">Dans « {folder.name} » et ses sous-dossiers.</p><fieldset className="h-share-fieldset"><legend>Ce que {person.name} ne pourra plus faire ici</legend>{person.restrictableCapabilities.map(cap=><Checkbox key={cap} label={labels[cap]??cap} description="" checked={restrictionCapabilities.includes(cap)} disabled={busy} onChange={value=>setRestrictionCapabilities(old=>value?[...old,cap]:old.filter(c=>c!==cap))}/>)}</fieldset><Banner title="À savoir.">Les autres droits de {person.name} continuent d’être hérités. Un accès ajouté plus bas ne pourra pas contourner cette restriction.</Banner><div className="h-actions"><Button type="submit" variant="danger" icon="ban" loading={busy} disabled={!restrictionCapabilities.length}>Restreindre</Button><Button variant="tertiary" disabled={busy} onClick={closePanel}>Annuler</Button></div></form>}
    </div></aside>,host)}
  </>;
}
