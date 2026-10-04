"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Banner, Button, Checkbox, Icon, Logo, TextField } from "./design-system";
import { familyError, familyRequest, familyUncertain, FamilyRequestError, RecoveryCodes, StepHeader } from "./family-ui";

type Flow = { flowId: string; kind: string; status: string; email: string; version: number; emailVerified?: boolean };
type Screen = "login" | "landing" | "verify" | "password" | "codes" | "confirm" | "choose" | "email" | "emailSent" | "code" | "newEmail" | "verifyNew" | "recoveryPassword" | "done" | "lost";
const identity = <T,>(action: string, body?: unknown) => familyRequest<T>(`/api/hestia/identity/${action}`, body === undefined ? "GET" : "POST", body);
export function FamilyAuth({ onLogin, busy: loginBusy, notice }: { onLogin: (email: string, password: string) => Promise<void>; busy: boolean; notice?: ReactNode }) {
  const [screen, setScreen] = useState<Screen>("login");
  const [restoring, setRestoring] = useState(true);
  const [flow, setFlow] = useState<Flow | null>(null);
  const [linkKind, setLinkKind] = useState("invite");
  const [link, setLink] = useState<{ flowId: string; capability: string } | null>(null);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [repeat, setRepeat] = useState("");
  const [otp, setOtp] = useState(""); const [backup, setBackup] = useState(""); const [newEmail, setNewEmail] = useState("");
  const [path, setPath] = useState("email"); const [codes, setCodes] = useState<string[]>([]); const [kept, setKept] = useState(false);
  const [preparationId, setPreparationId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [info, setInfo] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false); const requestId = useRef<string | null>(null); const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search), hash = new URLSearchParams(window.location.hash.slice(1));
    const flowId = params.get("flowId"), capability = hash.get("capability");
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      if (flowId && capability) {
        setLink({ flowId, capability }); setLinkKind(params.get("kind") || "invite"); setScreen("landing");
        window.history.replaceState(null, "", `${window.location.pathname}?flowId=${encodeURIComponent(flowId)}`);
      } else {
        try {
          const current = await identity<Flow & { completed?: boolean }>("status"); if (cancelled) return;
          setFlow(current); setEmail(current.email); setNewEmail(current.email);
          setScreen(current.completed ? "login" : current.status === "recovering" ? current.emailVerified ? "recoveryPassword" : "newEmail" : current.kind === "recovery" ? "emailSent" : current.emailVerified ? "password" : "verify");
          if (current.completed) setInfo("L’opération a été enregistrée. Connectez-vous avec votre compte.");
        } catch (failure) {
          if (!cancelled) { setScreen("login"); if (flowId) setError("Ce lien est incomplet ou n’est plus disponible. Ouvrez le dernier message reçu, en entier."); else if (!(failure instanceof FamilyRequestError && [401,404].includes(failure.status))) setError("La reprise de votre accès n’a pas pu être vérifiée. Réessayez."); }
        }
      }
    }).finally(() => { if (!cancelled) setRestoring(false); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { heading.current?.focus(); }, [screen]);
  useEffect(() => {
    const hide = () => { if (document.hidden) { setCodes([]); setPassword(""); setRepeat(""); setBackup(""); setOtp(""); if (screen === "codes" || screen === "confirm") { setScreen("password"); setKept(false); setPreparationId(null); setInfo("Les codes ne sont plus affichés. Préparez un nouveau lot avant de continuer."); } } };
    document.addEventListener("visibilitychange", hide); return () => document.removeEventListener("visibilitychange", hide);
  }, [screen]);
  function go(next: Screen) { setError(null); setInfo(null); setUncertain(false); setScreen(next); setOtp(""); setPassword(""); setRepeat(""); setBackup(""); }
  function loginPage() { setCodes([]); setPreparationId(null); setLink(null); setFlow(null); requestId.current = null; go("login"); window.history.replaceState(null, "", window.location.pathname); }
  async function run(action: () => Promise<void>, mutation = false) {
    if (busy) return; setBusy(true); setError(null); setInfo(null);
    try { await action(); } catch (e) { const unknown = mutation && familyUncertain(e); setError(unknown ? "La réponse d’Hestia n’est pas arrivée. Vérifiez le résultat avant de recommencer." : e instanceof FamilyRequestError ? familyError(e) : "Impossible de joindre Hestia. Réessayez."); if (unknown) setUncertain(true); }
    finally { setBusy(false); setPassword(""); setRepeat(""); setBackup(""); }
  }
  async function verifyResult() {
    await run(async () => { const status = await identity<Flow & { completed?: boolean }>("status"); setFlow(status); setUncertain(false); if (status.completed || status.status === "completed") { setCodes([]); setScreen(status.kind === "recovery" ? "done" : "login"); setInfo("L’opération a été enregistrée. Connectez-vous avec votre nouveau mot de passe."); } else if (status.status === "recovering") { setScreen(status.emailVerified ? "recoveryPassword" : "newEmail"); } else if (status.status === "proved") { setScreen("password"); } else { setInfo("L’opération n’est pas confirmée. Relisez l’étape avant de la confirmer de nouveau."); } });
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (restoring || busy || loginBusy || uncertain) return;
    if (screen === "login") { await onLogin(email, password); setPassword(""); return; }
    if (screen === "choose") { go(path === "code" ? "code" : path === "lost" ? "lost" : "email"); return; }
    if (screen === "codes") { if (!kept) { setError("Conservez vos codes avant de continuer."); return; } go("confirm"); return; }
    if (screen === "done") { loginPage(); setInfo("Connectez-vous avec votre nouveau mot de passe. Vos sessions précédentes ne fonctionnent plus."); return; }
    if (screen === "password" || screen === "recoveryPassword") {
      if (password !== repeat) { setError("Les deux mots de passe ne sont pas identiques."); return; }
    }
    await run(async () => {
      if (screen === "landing" && link) { const result = await identity<Flow>("enter", link); setFlow(result); setLink(null); if (["proved", "prepared"].includes(result.status)) go("password"); else { go("verify"); await identity("send-otp", {}); } }
      else if (screen === "verify") { await identity("verify-email", { otp }); go(flow?.kind === "exceptional" ? "recoveryPassword" : "password"); }
      else if (screen === "password") { const result = await identity<{ codes: string[]; preparationId: string }>("prepare", { password }); if (document.hidden) { setCodes([]); setPreparationId(null); go("password"); return; } setCodes(result.codes); setPreparationId(result.preparationId); requestId.current = null; setKept(false); go("codes"); }
      else if (screen === "confirm") { requestId.current ??= crypto.randomUUID(); await identity("confirm", { requestId: requestId.current, acknowledged: true, preparationId }); setCodes([]); loginPage(); setInfo("Compte activé. Connectez-vous avec votre adresse et votre mot de passe."); }
      else if (screen === "email") { await identity("recover", { email, method: "email" }); go("emailSent"); }
      else if (screen === "emailSent") { await identity("verify-email", { otp }); go("recoveryPassword"); }
      else if (screen === "code") { await identity("recover", { email, method: "code" }); await identity("recover-code", { code: backup }); go("newEmail"); }
      else if (screen === "newEmail") { await identity("recovery-email", { email: newEmail }); go("verifyNew"); }
      else if (screen === "verifyNew") { await identity("verify-email", { otp }); go("recoveryPassword"); }
      else if (screen === "recoveryPassword") { requestId.current ??= crypto.randomUUID(); await identity("finish", { password, requestId: requestId.current }); go("done"); }
    }, ["confirm", "recoveryPassword", "code", "emailSent", "verify"].includes(screen));
  }
  async function copy() { try { await navigator.clipboard.writeText(codes.join("\n")); setInfo("Codes copiés."); } catch { setError("La copie n’a pas abouti. Notez vos codes avant de continuer."); } }
  const install = (flow?.kind || linkKind) === "bootstrap" || flow?.kind === "install";
  const readmit = (flow?.kind || linkKind).startsWith("readmi");
  const title: Record<Screen, string> = { login: "Connexion", landing: install ? "Activer le foyer" : readmit ? "Revenir dans le foyer" : "Rejoindre le foyer", verify: "Vérifiez votre adresse", password: "Choisissez votre mot de passe", codes: "Gardez vos codes de secours", confirm: install ? "Activer le foyer ?" : readmit ? "Revenir dans le foyer ?" : "Activer votre compte ?", choose: "Retrouver votre accès", email: "Recevoir un code", emailSent: "Consultez votre boîte e-mail", code: "Utiliser un code de secours", newEmail: "Votre nouvelle adresse", verifyNew: "Vérifiez la nouvelle adresse", recoveryPassword: "Nouveau mot de passe", done: "Accès rétabli", lost: "Hestia ne peut pas vous rendre l’accès seul" };
  const intro: Partial<Record<Screen, string>> = { login: "Instance familiale privée", landing: "Ce lien vous permet de vérifier votre adresse et de choisir vous-même votre mot de passe.", verify: `Un code vient d’être demandé pour ${flow?.email || "votre adresse"}. Le message peut mettre quelques minutes à arriver.`, password: "Vous seul·e le connaissez. Personne d’autre dans le foyer ne le voit ni ne le choisit.", codes: "Ils vous permettront de retrouver votre compte si vous perdez l’accès à votre adresse e-mail. Ils ne seront plus affichés ensuite.", choose: "Que pouvez-vous encore utiliser ?", email: "Indiquez l’adresse de votre compte. Demander un code ne ferme aucune session.", emailSent: `Si ${email} correspond à un compte actif du foyer, un code vient d’y être demandé. Le message peut mettre quelques minutes à arriver.`, code: "Indiquez l’adresse de votre compte, même si vous n’y avez plus accès, puis un de vos codes de secours. Le code utilisé ne servira plus.", newEmail: "Une adresse personnelle que vous consultez. Elle remplacera l’ancienne pour vous connecter et recevoir les codes.", verifyNew: `Un code vient d’être demandé pour ${newEmail}.`, recoveryPassword: "Choisissez-le vous-même. Il remplacera l’ancien sur tous vos appareils.", done: "Votre mot de passe est changé. Les autres sessions ouvertes ne fonctionnent plus.", lost: "Sans votre boîte e-mail ni code de secours, aucune vérification automatique n’est possible." };
  const step = ({ verify: 1, password: 2, codes: 3, confirm: 4 } as Partial<Record<Screen, number>>)[screen];
  const labels = ["Adresse", "Mot de passe", "Codes de secours", "Confirmation"];
  const submitLabel = screen === "login" ? "Se connecter" : screen === "landing" ? "Commencer" : screen === "email" ? "Envoyer un code" : screen === "confirm" ? install ? "Activer le foyer" : readmit ? "Revenir dans le foyer" : "Activer mon compte" : screen === "recoveryPassword" ? "Enregistrer" : screen === "done" ? "Aller à la connexion" : "Continuer";
  return <div className="cdv-root h-root"><main className="hf-public"><form onSubmit={submit} aria-labelledby="family-public-title"><Logo/>{step && <StepHeader step={step} total={4} label={labels[step - 1]}/>}<div className="hf-stack"><h1 ref={heading} tabIndex={-1} id="family-public-title">{title[screen]}</h1>{intro[screen] && <p>{intro[screen]}</p>}</div>{screen === "login" && notice}{error && <Banner tone="danger" title={uncertain ? "Résultat incertain." : "L’action n’a pas abouti."}>{error}</Banner>}{info && <Banner title={info}/>}
    {screen === "landing" && <ul className="hf-bullets">{install ? <><li><Icon name="users" size={18}/>Le propriétaire administre le foyer : il invite et retire des personnes.</li><li><Icon name="lock" size={18}/>Ce rôle ne donne pas accès aux documents des autres.</li></> : readmit ? <><li><Icon name="user" size={18}/>Vous reviendrez comme membre.</li><li><Icon name="lock" size={18}/>Vos anciens accès aux dossiers ne sont pas rétablis. Il faudra de nouveaux partages.</li><li><Icon name="lock" size={18}/>Vos anciens mot de passe, codes et liens ne fonctionnent plus : vous en choisirez de nouveaux.</li></> : <><li><Icon name="user" size={18}/>Vous serez membre, avec votre propre compte et votre propre mot de passe.</li><li><Icon name="folder" size={18}/>Aucun dossier n’est partagé automatiquement.</li></>}<li><Icon name="info" size={18}/>Ouvrir ce lien n’active rien. Rien n’est créé avant la dernière étape.</li></ul>}
    {screen === "choose" && <fieldset className="hf-radio"><legend>Votre situation</legend>{[{ value: "email", label: "Ma boîte e-mail : j’ai oublié mon mot de passe" }, { value: "code", label: "Un code de secours : je n’ai plus accès à mon adresse" }, { value: "lost", label: "Ni l’un ni l’autre" }].map(option => <label key={option.value}><input type="radio" name="recovery-path" value={option.value} checked={path === option.value} onChange={() => setPath(option.value)}/>{option.label}</label>)}</fieldset>}
    {["login", "email", "code"].includes(screen) && <TextField label={screen === "code" ? "Adresse du compte" : "Adresse e-mail"} type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required disabled={restoring || busy || loginBusy}/>}
    {screen === "login" && <TextField label="Mot de passe" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required disabled={restoring || loginBusy}/>}
    {["verify", "emailSent", "verifyNew"].includes(screen) && <TextField label={screen === "verify" ? "Code reçu par e-mail" : "Code reçu"} autoComplete="one-time-code" value={otp} onChange={e => setOtp(e.target.value)} required disabled={busy}/>}
    {screen === "code" && <TextField label="Code de secours" autoComplete="off" value={backup} onChange={e => setBackup(e.target.value)} required disabled={busy}/>}
    {screen === "newEmail" && <TextField label="Nouvelle adresse e-mail" type="email" autoComplete="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} required disabled={busy}/>}
    {["password", "recoveryPassword"].includes(screen) && <><TextField label="Nouveau mot de passe" type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required disabled={busy}/><TextField label="Saisissez-le de nouveau" type="password" autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} required disabled={busy}/></>}
    {screen === "codes" && <><RecoveryCodes codes={codes}/><Button variant="secondary" compact onClick={() => void copy()}>Copier les codes</Button><Checkbox label="J’ai conservé ces codes hors de Hestia" description="Sur papier ou dans un gestionnaire de mots de passe personnel, pas dans un document du foyer." checked={kept} onChange={setKept}/></>}
    {screen === "confirm" && <ul className="hf-bullets"><li><Icon name="check"/>Adresse vérifiée : {flow?.email}</li><li><Icon name="user"/>Rôle : {install ? "propriétaire" : "membre"} du foyer.</li><li><Icon name="folder"/>{readmit ? "Aucun ancien accès n’est rétabli. Vous pourrez créer un dossier ou recevoir de nouveaux partages." : "Aucun dossier ne vous est partagé pour l’instant. Vous pourrez en créer un."}</li></ul>}
    {screen === "done" && <ul className="hf-bullets"><li><Icon name="lock"/>Votre rôle et vos accès aux dossiers sont inchangés.</li><li><Icon name="info"/>Il vous reste 0 code de secours. Pensez à les renouveler depuis « Moi ».</li></ul>}
    {screen === "lost" && <ul className="hf-bullets"><li><Icon name="users"/>Le recours passe par la personne de confiance qui s’occupe de l’installation de Hestia pour le foyer. Contactez-la par vos moyens habituels.</li><li><Icon name="info"/>Ce recours est exceptionnel. Il n’a pas de délai garanti et cette page n’envoie aucune demande.</li><li><Icon name="lock"/>Personne du foyer, propriétaire compris, ne peut voir ou choisir votre mot de passe à votre place.</li></ul>}
    <div className="hf-actions">{screen !== "lost" && <Button type="submit" loading={restoring || busy || loginBusy} disabled={uncertain}>{submitLabel}</Button>}{uncertain && <Button variant="secondary" onClick={() => void verifyResult()}>Vérifier le résultat</Button>}{screen === "login" ? <Button variant="tertiary" disabled={restoring} onClick={() => go("choose")}>J’ai perdu mon accès</Button> : !["confirm", "codes", "password", "recoveryPassword", "done"].includes(screen) && <Button variant="tertiary" disabled={busy} onClick={loginPage}>Revenir à la connexion</Button>}{screen === "verify" && <Button variant="tertiary" disabled={busy} onClick={() => void run(async () => { await identity("send-otp", {}); setInfo("Un nouveau code a été demandé."); })}>Recevoir un nouveau code</Button>}</div>
    {screen === "login" && <p className="hf-note">Hestia est réservé au foyer : il n’y a pas d’inscription publique. Pour rejoindre le foyer, demandez une invitation à son propriétaire ou à une personne qui l’administre.</p>}
  </form></main></div>;
}
