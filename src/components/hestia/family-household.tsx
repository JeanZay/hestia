"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Avatar, Banner, Button, Dialog, EmptyState, PageHeader, Skeleton, Tabs, TextField } from "./design-system";
import { FamilyManagement } from "./family-management";
import { familyError, familyRequest, familyUncertain, FamilyPanel, FamilyRequestError, PersonRow, roleLabel, StatusPill } from "./family-ui";

type Member = { id: string; name: string; email: string; role: string; status: string; membershipVersion: string; removedAt?: string; allowedActions: { remove: boolean; readmit: boolean } };
type Invitation = { id: string; name?: string; email: string; status: string; version: number; expires_at: string; delivery: string; kind?: "invite" | "readmit"; allowedActions?: { canManage: boolean; canCancel: boolean; canReissue: boolean } };
type Vacant = { id: string; adminReference: string; creator: { id: string; name: string }; createdAt: string; vacantSince: string; readerCount: number; canNominate: boolean };
type Removal = { target: { id: string; name: string; role: string; membershipVersion: string }; reviewVersion: string; managedFolderCount: number; allowed: boolean };
type Action = { type: "remove"; member: Member; review: Removal } | { type: "readmit"; member: Member } | { type: "cancel" | "reissue"; invitation: Invitation };
const invitationStatus = (item: Invitation) => item.status === "expired" ? "Lien expiré" : item.delivery === "sent" ? "Envoi effectué" : item.delivery === "failed" ? "Envoi échoué" : "Envoi en cours";
export function FamilyHousehold({ onAccessLost }: { onAccessLost: () => void }) {
  const [tab, setTab] = useState("active"), [members, setMembers] = useState<Member[]>([]), [invitations, setInvitations] = useState<Invitation[]>([]), [vacant, setVacant] = useState<Vacant[]>([]);
  const [person, setPerson] = useState<Member | null>(null), [invitation, setInvitation] = useState<Invitation | null>(null), [invite, setInvite] = useState(false), [nominate, setNominate] = useState<string | null>(null);
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [password, setPassword] = useState(""), [action, setAction] = useState<Action | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [notice, setNotice] = useState<{ tone: "danger" | "info" | "success"; title: string; text?: string } | null>(null);
  const operation = useRef<string | null>(null), alive = useRef(true), sequence = useRef(0);
  const readmissionConfirmation = useRef<string | null>(null);
  const load = useCallback(async () => {
    const epoch = ++sequence.current;
    async function memberPages() {
      const rows: Member[] = []; let offset: number | null = 0;
      while (offset !== null) { const result: { members: Member[]; nextOffset: number | null } = await familyRequest(`/api/hestia/household/members?status=${tab === "removed" ? "removed" : "active"}&offset=${offset}&limit=50`); rows.push(...result.members); offset = result.nextOffset; }
      return rows;
    }
    async function pendingPages(path: string) {
      const rows: Invitation[] = []; let pageOffset: number | null = 0;
      while (pageOffset !== null) { const result: { invitations: Invitation[]; nextOffset: number | null } = await familyRequest(`${path}?offset=${pageOffset}&limit=50`); rows.push(...result.invitations); pageOffset = result.nextOffset ?? null; }
      return rows;
    }
    async function vacantPages() {
      const rows: Vacant[] = []; let offset: number | null = 0;
      while (offset !== null) { const result: { folders: Vacant[]; nextOffset: number | null } = await familyRequest(`/api/hestia/household/folders/without-manager?offset=${offset}&limit=50`); rows.push(...result.folders); offset = result.nextOffset ?? null; }
      return rows;
    }
    // Lists are independent; pages within each list still follow their cursor.
    const [collected, pending, returning, folders] = await Promise.all([
      memberPages(), pendingPages("/api/hestia/household/invitations"),
      pendingPages("/api/hestia/household/readmissions"), vacantPages(),
    ]);
    if (!alive.current || epoch !== sequence.current) return;
    setMembers(collected); setInvitations([...pending.map(item => ({ ...item, kind: "invite" as const })), ...returning.map(item => ({ ...item, kind: "readmit" as const }))]); setVacant(folders);
  }, [tab]);
  const fail = useCallback((error: unknown) => { if (!alive.current) return; if (error instanceof FamilyRequestError && [401,403].includes(error.status)) { onAccessLost(); return; } setNotice({ tone: "danger", title: "L’action n’a pas abouti.", text: familyError(error) }); }, [onAccessLost]);
  useEffect(() => { alive.current = true; const sequencing = sequence; void Promise.resolve().then(() => { if (!alive.current) return; setLoading(true); return load().catch(fail).finally(() => { if (alive.current) setLoading(false); }); }); return () => { alive.current = false; ++sequencing.current; }; }, [load, fail]);
  function close() { setPerson(null); setInvitation(null); setInvite(false); setNominate(null); setName(""); setEmail(""); setPassword(""); setAction(null); setNotice(null); setUncertain(false); operation.current = null; readmissionConfirmation.current = null; }
  async function createInvite() {
    if (busy || uncertain) return; setBusy(true); setNotice(null); operation.current ??= crypto.randomUUID();
    try { await familyRequest("/api/hestia/household/invitations", "POST", { name, email, requestId: operation.current }); if (!alive.current) return; await load(); setInvite(false); setName(""); setEmail(""); operation.current = null; setNotice({ tone: "success", title: "Invitation enregistrée.", text: "L’envoi est en cours ; sa réception ne peut pas être garantie." }); }
    catch (e) { if (!alive.current) return; setUncertain(familyUncertain(e)); if (familyUncertain(e)) setNotice({ tone: "danger", title: "Résultat incertain.", text: "Vérifiez le résultat avant de recommencer." }); else fail(e); } finally { if (alive.current) setBusy(false); }
  }
  async function askRemove(member: Member) { setBusy(true); setNotice(null); try { const review = await familyRequest<Removal>(`/api/hestia/household/members/${member.id}/removal`); if (alive.current) { setAction({ type: "remove", member, review }); operation.current = null; } } catch (e) { fail(e); } finally { if (alive.current) setBusy(false); } }
  async function apply() {
    if (!action || busy || uncertain) return; setBusy(true); setNotice(null); operation.current ??= crypto.randomUUID();
    try {
      if (action.type === "remove") await familyRequest(`/api/hestia/household/members/${action.member.id}/remove`, "POST", { idempotencyKey: operation.current, expectedMembershipVersion: action.review.target.membershipVersion, reviewVersion: action.review.reviewVersion });
      else if (action.type === "readmit") {
        let confirmationId: string | undefined = readmissionConfirmation.current || undefined;
        if (action.member.role === "admin" && !confirmationId) { const confirmed = await familyRequest<{ confirmationId: string }>("/api/hestia/household/readmissions/confirm", "POST", { memberId: action.member.id, password, requestId: crypto.randomUUID() }); confirmationId = confirmed.confirmationId; readmissionConfirmation.current = confirmationId; }
        await familyRequest("/api/hestia/household/readmissions", "POST", { memberId: action.member.id, requestId: operation.current, ...(confirmationId ? { confirmationId } : {}) });
      } else await familyRequest(`/api/hestia/household/${action.invitation.kind === "readmit" ? "readmissions" : "invitations"}/${action.invitation.id}/${action.type}`, "POST", { requestId: operation.current });
      if (!alive.current) return;
      const kind = action.type; setAction(null); setPerson(null); setInvitation(null); operation.current = null; await load();
      setNotice({ tone: "success", title: kind === "remove" ? "La personne a été retirée du foyer." : kind === "readmit" ? "Retour préparé." : kind === "cancel" ? "Invitation annulée." : "Nouveau lien préparé.", text: kind === "remove" ? "Ses contributions sont conservées. Les accès dépendants ont pris fin ; les autres restent valables." : kind === "readmit" ? "La personne reste sans accès jusqu’à sa nouvelle activation. L’envoi est en cours ; sa réception ne peut pas être garantie." : kind === "cancel" ? "Le lien envoyé ne fonctionne plus." : "L’ancien lien ne fonctionne plus. Vérifiez l’état d’envoi dans la fiche." });
    } catch (e) { if (!alive.current) return; setUncertain(familyUncertain(e)); if (familyUncertain(e)) setNotice({ tone: "danger", title: "Résultat incertain.", text: "Vérifiez le résultat avant de recommencer." }); else fail(e); if (e instanceof FamilyRequestError && e.status === 409) { setAction(null); setPerson(null); await load().catch(fail); } }
    finally { if (alive.current) { setBusy(false); setPassword(""); } }
  }
  async function check() {
    setBusy(true);
    try {
      if (action?.type === "remove" && operation.current) {
        const result = await familyRequest<{ status: string }>(`/api/hestia/membership-operations/${operation.current}`);
        if (result.status === "committed") { setAction(null); setPerson(null); setUncertain(false); setNotice({ tone: "success", title: "Retrait enregistré." }); }
        else { setAction(null); setPerson(null); setUncertain(false); setNotice({ tone: "info", title: "Aucun retrait enregistré.", text: "Relisez la fiche avant de confirmer de nouveau." }); }
      } else {
        const isReturn = action?.type === "readmit" || (action && "invitation" in action && action.invitation.kind === "readmit");
        const result = await familyRequest<{ operationStatus: string }>(`/api/hestia/household/${isReturn ? "readmissions" : "invitations"}?requestId=${encodeURIComponent(operation.current || "")}`);
        setUncertain(false);
        if (result.operationStatus === "committed") { setAction(null); setInvitation(null); setInvite(false); setPerson(null); setNotice({ tone: "success", title: "Opération enregistrée.", text: "La liste et l’état d’envoi sont actualisés." }); }
        else setNotice({ tone: "info", title: "Aucune confirmation enregistrée.", text: "Relisez les informations avant de confirmer de nouveau." });
      }
      await load();
    } catch (e) { fail(e); } finally { if (alive.current) setBusy(false); }
  }
  const message = notice && <Banner tone={notice.tone} title={notice.title}>{notice.text}</Banner>;
  const pending = invitations.filter(item => !["completed", "revoked", "cancelled", "replaced"].includes(item.status));
  return <div className="hf-layout"><div className="hf-stack hf-main"><div className="h-heading-actions"><PageHeader overline="Administration" title="Foyer" summary={`${members.length} personne${members.length > 1 ? "s" : ""}`}/><Button icon="plus" onClick={() => { close(); setInvite(true); }}>Inviter une personne</Button></div>{!action && !invite && message}{loading ? <Skeleton/> : <>{vacant.length > 0 && <section className="hf-stack"><div className="hf-overline">Dossiers sans gestionnaire · {vacant.length}</div><p className="h-hint">Leur gestionnaire a quitté le foyer. Les documents sont conservés, ainsi que les accès qui ne dépendaient pas de cette personne. Vous pouvez nommer quelqu’un qui peut encore les consulter.</p><div className="h-document-list">{vacant.map(folder => <div key={folder.id} className="hf-person"><div className="hf-person-text"><strong>{folder.adminReference}</strong><span>Créé par {folder.creator.name} · {folder.readerCount} lecteur{folder.readerCount > 1 ? "s" : ""}</span></div><Button variant="secondary" compact onClick={() => { close(); setNominate(folder.id); }}>{folder.canNominate ? "Nommer" : "Voir la situation"}</Button></div>)}</div></section>}<Tabs items={[{ id: "active", label: "Membres" }, { id: "pending", label: "En attente" }, { id: "removed", label: "Anciens membres" }]} active={tab} onChange={value => { close(); setTab(value); }}/>{tab === "pending" ? pending.length ? <div className="h-document-list">{pending.map(item => <PersonRow key={item.id} name={item.name || item.email} sub={item.email} status={invitationStatus(item)} selected={invitation?.id === item.id} onClick={() => { close(); setInvitation(item); }}/>)}</div> : <EmptyState icon="users" title="Aucune invitation en attente">Les personnes invitées apparaîtront ici jusqu’à leur activation.</EmptyState> : members.length ? <div className="h-document-list">{members.map(member => <PersonRow key={member.id} name={member.name || member.email} sub={member.email} status={tab === "removed" ? "Ancien membre" : roleLabel(member.role)} selected={person?.id === member.id} onClick={() => { close(); setPerson(member); }}/>)}</div> : <EmptyState icon="users" title={tab === "removed" ? "Aucun ancien membre" : "Aucun membre"}>Les personnes du foyer apparaîtront ici.</EmptyState>}</>}{uncertain && !action && <Button variant="secondary" loading={busy} onClick={() => void check()}>Vérifier le résultat</Button>}</div>
    {invite && <FamilyPanel title="Inviter une personne" onClose={close} busy={busy}><form className="hf-stack" onSubmit={event => { event.preventDefault(); void createInvite(); }}><h2>Inviter une personne</h2>{message}<p>La personne recevra un lien pour vérifier son adresse et choisir elle-même son mot de passe. Personne d’autre ne le voit.</p><TextField label="Prénom et nom" autoComplete="off" value={name} onChange={e => setName(e.target.value)} required disabled={busy}/><TextField label="Adresse e-mail personnelle" type="email" hint="Une adresse à son nom, qu’elle seule consulte." value={email} onChange={e => setEmail(e.target.value)} required disabled={busy}/><p>Elle rejoindra le foyer comme membre. Aucun dossier ne lui sera partagé automatiquement.</p><Button type="submit" loading={busy} disabled={uncertain}>Inviter</Button>{uncertain && <Button variant="secondary" onClick={() => void check()}>Vérifier le résultat</Button>}</form></FamilyPanel>}
    {person && <FamilyPanel title="Fiche personne" onClose={close} busy={busy}>{!action && message}<div className="h-member-card"><Avatar name={person.name}/><div><h2>{person.name}</h2><span>{person.email}</span></div></div><div><StatusPill>{roleLabel(person.role)}</StatusPill>{person.status === "removed" && <StatusPill dashed>Ancien membre</StatusPill>}</div><dl className="hf-facts"><div><dt>État</dt><dd>{person.status === "removed" ? "Accès fermé" : "Membre actif"}</dd></div></dl>{person.allowedActions.remove && <Button variant="danger" loading={busy} onClick={() => void askRemove(person)}>Retirer du foyer</Button>}{person.allowedActions.readmit && <Button variant="secondary" onClick={() => { setAction({ type: "readmit", member: person }); operation.current = null; }}>Préparer son retour</Button>}<p>Cette fiche ne montre ni documents ni dossiers privés : gérer le foyer ne donne pas accès à leur contenu.</p></FamilyPanel>}
    {invitation && <FamilyPanel title="Invitation" onClose={close} busy={busy}>{!action && message}<h2>{invitation.name || invitation.email}</h2><p>{invitation.email}</p><StatusPill dashed={invitation.delivery === "failed"}>{invitationStatus(invitation)}</StatusPill><p>La réception du message ne peut pas être garantie. Le compte reste inactif tant que la personne n’a pas terminé son activation.</p>{invitation.allowedActions?.canReissue && <Button variant="secondary" onClick={() => { setAction({ type: "reissue", invitation }); operation.current = null; }}>{invitation.kind === "readmit" ? "Renvoyer le retour" : "Renvoyer l’invitation"}</Button>}{invitation.allowedActions?.canCancel && <Button variant="danger" onClick={() => { setAction({ type: "cancel", invitation }); operation.current = null; }}>{invitation.kind === "readmit" ? "Annuler le retour" : "Annuler l’invitation"}</Button>}</FamilyPanel>}
    {nominate && <FamilyManagement folderId={nominate} succession onAccessLost={onAccessLost} onClose={() => setNominate(null)} onDone={() => { setNominate(null); void load().catch(fail); }}/>} 
    {action && <Dialog title={action.type === "remove" ? `Retirer ${action.member.name} du foyer ?` : action.type === "readmit" ? `Préparer le retour de ${action.member.name} ?` : action.type === "cancel" ? action.invitation.kind === "readmit" ? "Annuler ce retour ?" : "Annuler cette invitation ?" : action.invitation.kind === "readmit" ? "Renvoyer le retour ?" : "Renvoyer l’invitation ?"} confirmVariant={action.type === "remove" || action.type === "cancel" ? "danger" : "primary"} confirmLabel={action.type === "remove" ? "Retirer du foyer" : action.type === "readmit" ? "Préparer le retour" : action.type === "cancel" ? action.invitation.kind === "readmit" ? "Annuler le retour" : "Annuler l’invitation" : "Renvoyer"} busy={busy || uncertain} onConfirm={() => void apply()} onCancel={() => { setAction(null); setPassword(""); }}>{message}{action.type === "remove" ? <><p>Son accès est coupé dès sa prochaine action dans Hestia. Une opération en cours s’arrête à sa prochaine vérification.</p><p>Ses documents déjà enregistrés restent dans les dossiers, avec son nom comme auteur.</p><p>Les accès qui dépendent de cette personne cessent aussi : le pouvoir de partager qu’elle avait confié à d’autres, et les accès donnés grâce à ce pouvoir. Les accès indépendants restent valables.</p><p>Les fichiers déjà téléchargés ne peuvent pas être rappelés.</p>{action.review.managedFolderCount > 0 && <p>{action.review.managedFolderCount} dossier(s) resteront sans gestionnaire jusqu’à une nomination ; ce n’est pas nécessaire pour continuer.</p>}</> : action.type === "readmit" ? <><p>La personne reviendra comme membre, sans ancien rôle d’administration.</p><p>Un lien sera envoyé à l’adresse conservée, {action.member.email}. Rien n’est actif avant qu’elle vérifie son adresse, choisisse un nouveau mot de passe et reçoive de nouveaux codes.</p><p>Aucun ancien accès aux dossiers n’est rétabli, même pour ceux qu’elle a créés. Il faudra de nouveaux partages.</p>{action.member.role === "admin" && <TextField label="Votre mot de passe actuel" hint="Confirmation demandée car cette personne était administratrice." type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} disabled={busy}/>}</> : <p>{action.type === "cancel" ? "Le lien envoyé ne fonctionnera plus. Vous pourrez inviter cette adresse de nouveau plus tard." : "L’ancien lien sera remplacé. La personne devra ouvrir le message le plus récent."}</p>}{uncertain && <Button variant="secondary" loading={busy} onClick={() => void check()}>Vérifier le résultat</Button>}</Dialog>}
  </div>;
}
