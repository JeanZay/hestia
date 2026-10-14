"use client";
import { useEffect, useRef, useState } from "react";
import type { TranscriptionSettingsDto } from "../../shared/transcription-contract";
import { Banner, Button, Icon, PageHeader, Select, Switch, TextField } from "./design-system";
import { StatusPill } from "./family-ui";
import { CaptureError, captureRequest, registerCaptureClientWork } from "./capture-client";
import "./capture.css";

export function TranscriptionSettings({ onBack, onClassification, onAccessLost }: { onBack: () => void; onClassification: () => void; onAccessLost: () => void }) {
  const [settings, setSettings] = useState<TranscriptionSettingsDto | null>(null);
  const [model, setModel] = useState(""), [key, setKey] = useState(""), [cap, setCap] = useState(""), [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ title: string; text?: string; tone?: "success" | "danger" } | null>(null);
  const controller = useRef<AbortController | null>(null), running = useRef(false);
  function install(value: TranscriptionSettingsDto) { setSettings(value); setModel(value.model); setCap(value.monthlyLimitMicros ? String(value.monthlyLimitMicros / 1_000_000) : ""); setEnabled(value.enabled); }
  useEffect(() => {
    const ac = new AbortController(); controller.current = ac; const unregister = registerCaptureClientWork(ac);
    void captureRequest<{ settings: TranscriptionSettingsDto }>("/transcription-settings", ac.signal).then(result => { if (!ac.signal.aborted) install(result.settings); }).catch(error => {
      if (ac.signal.aborted) return;
      if (error instanceof CaptureError && [401, 403].includes(error.status)) onAccessLost(); else setMessage({ title: "Réglage indisponible.", text: "Réessayez plus tard." });
    });
    return () => { ac.abort(); unregister(); };
  }, [onAccessLost]);
  const options = settings?.availableProviders.flatMap(provider => provider.models.map(model => ({ ...model, provider: provider.id, providerLabel: provider.label }))) || [];
  const selected = options.find(option => option.id === model), current = options.find(option => option.id === settings?.model);
  const exhausted = !!settings && settings.monthlyLimitMicros > 0 && settings.spentMicros + settings.reservedMicros >= settings.monthlyLimitMicros;
  const label = !settings?.keyPresent ? "Non configurée · désactivée" : !settings.enabled ? "Désactivée" : !current ? "Non utilisable · modèle indisponible" : exhausted ? "Plafond atteint" : `Active · ${current.label}`;
  async function save() {
    if (!settings || running.current || !controller.current) return;
    const amount = Number(cap.replace(",", "."));
    // An expired profile must not prevent its administrator from disabling it.
    const provider = selected?.provider || settings.provider, modelId = selected?.id || settings.model;
    const invalidModel = (enabled && !selected) || !provider || !modelId;
    if (invalidModel || !Number.isFinite(amount) || amount <= 0 || !Number.isSafeInteger(Math.round(amount * 1_000_000)) || (enabled && !settings.keyPresent && !key.trim())) {
      setMessage({ tone: "danger", title: "À corriger.", text: invalidModel ? "Choisissez un modèle utilisable." : !Number.isFinite(amount) || amount <= 0 ? "Indiquez un plafond mensuel positif en euros." : "Une clé du service est nécessaire pour activer la dictée." }); return;
    }
    running.current = true; setBusy(true); setMessage(null); const credential = key; setKey("");
    const signal = controller.current.signal;
    try {
      const result = await captureRequest<{ settings: TranscriptionSettingsDto }>("/transcription-settings", signal, "PUT", { version: settings.version, provider, model: modelId, monthlyLimitMicros: Math.round(amount * 1_000_000), enabled, ...(credential ? { apiKey: credential } : {}) });
      if (!signal.aborted) { install(result.settings); setMessage({ tone: "success", title: "Enregistré.", text: "S’applique aux prochaines dictées. Aucun appel n’a été fait au service." }); }
    } catch (error) {
      if (!signal.aborted) { if (error instanceof CaptureError && [401, 403].includes(error.status)) onAccessLost(); else setMessage({ tone: "danger", title: "Enregistrement non confirmé.", text: error instanceof CaptureError ? error.message : "Actualisez ce réglage avant de recommencer." }); }
    } finally { running.current = false; if (!signal.aborted) setBusy(false); }
  }
  return <form className="hc-stack hc-settings" aria-label="Réglages de la dictée" autoComplete="off" onSubmit={event => event.preventDefault()}><div><Button variant="tertiary" compact icon="chevron-left" onClick={onBack}>Moi</Button></div><PageHeader title="Dictée" summary=""/><div><StatusPill icon={settings?.enabled && current && !exhausted ? "check" : "mic-off"} dashed={!settings?.enabled || !current || exhausted}>{label}</StatusPill></div><div className="hc-note"><Icon name="lock"/><span>Ce réglage ne donne accès à aucun document, brouillon ni commentaire des membres. Il concerne seulement la dictée ; le modèle des suggestions de rangement se règle à part.</span></div><div><Button variant="tertiary" compact icon="lightbulb" onClick={onClassification}>Suggestions de rangement (IA)</Button></div>{message && <Banner {...message}>{message.text}</Banner>}{settings && <>
    {!current && <Banner tone="warning" title="Modèle indisponible.">{options.length ? "Choisissez un autre modèle." : "La dictée reste indisponible, l’écriture au clavier reste possible."}</Banner>}
    <Select label="Modèle de dictée" hint="Seuls les modèles intégrés et vérifiés sont proposés. Ce choix ne change pas le modèle des suggestions de rangement." value={model} disabled={busy || !options.length} options={[{ value: "", label: "Choisir un modèle qualifié" }, ...options.map(option => ({ value: option.id, label: option.label })), ...(!selected && model ? [{ value: model, label: `${model} (indisponible)` }] : [])]} onChange={setModel}/>
    <span className="hc-muted">{selected ? `Accès via ${selected.providerLabel}.` : "MAI-Transcribe 2 : pas encore activé en service réel."}</span><div className="hc-stack"><div><StatusPill icon={selected?.vocabularySupported ? "check" : "info"} dashed={!selected?.vocabularySupported}>{selected?.vocabularySupported ? "Vocabulaire des dossiers pris en charge" : "Vocabulaire des dossiers non pris en charge"}</StatusPill></div><span className="hc-muted">Une courte liste de mots distinctifs, sans doublon, tirée des seuls dossiers consultables et où la personne peut déposer. Ces mots ne sont jamais imposés au texte.</span></div>
    <TextField label={settings.keyPresent ? "Remplacer la clé du service (facultatif)" : "Clé du service"} type="password" autoComplete="new-password" spellCheck={false} value={key} placeholder="Collez la clé ici" hint={settings.keyPresent ? "Une clé est enregistrée côté serveur ; elle n’est jamais affichée. Laissez vide pour la conserver." : "Conservée côté serveur uniquement, jamais affichée après enregistrement."} onChange={event => setKey(event.target.value)} disabled={busy}/>
    <TextField label="Plafond mensuel de la dictée (en euros)" inputMode="decimal" value={cap} onChange={event => setCap(event.target.value)} disabled={busy} hint="Mois civil UTC, distinct du plafond des suggestions. Une fois atteint, la dictée est refusée ; l’écriture reste possible. Baisser le plafond n’efface ni les dépenses ni les réservations du mois."/>
    <span className="hc-muted">Dépensé : {(settings.spentMicros / 1_000_000).toLocaleString("fr-FR")} € · réservé : {(settings.reservedMicros / 1_000_000).toLocaleString("fr-FR")} € (mois civil UTC).</span><Switch label="Dictée disponible pour le foyer" description="Reste désactivée tant que le modèle, la clé et le plafond ne sont pas établis." checked={enabled} disabled={busy} onChange={setEnabled}/><div><Button loading={busy} onClick={() => void save()}>Enregistrer</Button></div><span className="hc-voice-info">Enregistrer ne contacte pas le service. Le changement vaut pour les prochaines dictées ; une transcription déjà envoyée, les commentaires saisis et les dépenses du mois ne changent pas. Aucun modèle de secours n’est utilisé automatiquement.</span>
    </>}</form>;
}
