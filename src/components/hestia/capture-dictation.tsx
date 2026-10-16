"use client";
import { useEffect, useRef, useState } from "react";
import type { TranscriptionAvailabilityDto, TranscriptionResultDto } from "../../shared/transcription-contract";
import { Banner, Button, Icon } from "./design-system";
import { CaptureError, captureRequest, registerCaptureClientWork } from "./capture-client";
import type { DictationRecorder } from "./dictation-recorder";

export type CommentSnapshot = { text: string; revision: number; active: boolean };
type State = "idle" | "permission" | "listening" | "transcribing";
export function CaptureDictation({ captureId, inboxAttachmentId, expiresAt, active, pending, getSnapshot, onResult, onAccessLost }: {
  captureId?: string; inboxAttachmentId?: string; expiresAt?: string; active: boolean; pending: boolean; getSnapshot: () => CommentSnapshot;
  onResult: (text: string, base: CommentSnapshot) => void; onAccessLost: () => void;
}) {
  const sourceQuery = inboxAttachmentId ? `inboxAttachmentId=${encodeURIComponent(inboxAttachmentId)}` : `captureId=${encodeURIComponent(captureId || "")}`;
  const [availability, setAvailability] = useState<TranscriptionAvailabilityDto | null>(null);
  const [state, setState] = useState<State>("idle"), [elapsed, setElapsed] = useState(0), [compatible, setCompatible] = useState(true);
  const [message, setMessage] = useState<{ title: string; text: string; tone?: "info" | "warning" } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const lifetime = useRef<AbortController | null>(null), operation = useRef<AbortController | null>(null), recorder = useRef<DictationRecorder | null>(null);
  const phase = useRef<State>("idle"), stopBox = useRef<HTMLDivElement>(null), statusBox = useRef<HTMLDivElement>(null);
  const base = useRef<CommentSnapshot | null>(null), loaded = useRef(false);
  const transition = (next: State) => { phase.current = next; setState(next); };
  function cancel(show = true) {
    const previous = phase.current; operation.current?.abort(); operation.current = null; recorder.current?.cancel(); recorder.current = null; base.current = null;
    transition("idle"); setElapsed(0);
    if (show) setMessage({ title: previous === "transcribing" ? "Résultat écarté." : "Dictée annulée.", text: previous === "transcribing" ? "Il ne sera pas ajouté au commentaire. L’enregistrement avait déjà été envoyé : son coût peut être compté pour le foyer." : "Rien n’a été envoyé ; l’enregistrement est abandonné." });
  }
  useEffect(() => {
    const ac = new AbortController(); lifetime.current = ac;
    const unregister = registerCaptureClientWork(ac);
    const stop = () => { operation.current?.abort(); recorder.current?.cancel(); };
    ac.signal.addEventListener("abort", stop);
    const hidden = () => { if (document.hidden) cancel(); };
    const pagehide = () => cancel(false);
    const expiry = expiresAt ? setTimeout(() => { cancel(false); setAvailability(null); }, Math.max(0, Date.parse(expiresAt) - Date.now())) : undefined;
    document.addEventListener("visibilitychange", hidden); window.addEventListener("pagehide", pagehide);
    return () => { clearTimeout(expiry); ac.abort(); unregister(); document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", pagehide); };
    // One lifetime per preparation, independent from editable text and callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureId, inboxAttachmentId, expiresAt]);
  useEffect(() => {
    if (!active || loaded.current || !lifetime.current) return;
    loaded.current = true; const signal = lifetime.current.signal;
    void import("./dictation-recorder").then(module => { if (!signal.aborted) setCompatible(module.supportsDictation()); });
    void captureRequest<TranscriptionAvailabilityDto>(`/transcriptions?${sourceQuery}`, signal).then(value => { if (!signal.aborted) setAvailability(value); }).catch(error => { if (!signal.aborted && error instanceof CaptureError && [401, 403].includes(error.status)) onAccessLost(); });
  }, [active, captureId, inboxAttachmentId, sourceQuery, onAccessLost]);
  useEffect(() => { if (!active && (phase.current === "listening" || phase.current === "permission")) cancel(); }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (state === "listening") stopBox.current?.querySelector<HTMLButtonElement>("button")?.focus();
    else if (state === "permission" || state === "transcribing") statusBox.current?.focus();
  }, [state]);
  useEffect(() => {
    if (state !== "listening") return;
    const began = Date.now();
    const timer = setInterval(() => { const seconds = Math.min(120, Math.floor((Date.now() - began) / 1000)); setElapsed(seconds); if (seconds === 105) setAnnouncement("Il reste 15 secondes."); if (seconds >= 120) void stop(true); }, 1000);
    return () => clearInterval(timer);
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  async function start() {
    if (phase.current !== "idle" || pending || !active || !availability?.available || !compatible || lifetime.current?.signal.aborted || (expiresAt !== undefined && Date.now() >= Date.parse(expiresAt))) return;
    const ac = new AbortController(); operation.current = ac;
    const signal = AbortSignal.any([ac.signal, lifetime.current!.signal]);
    base.current = getSnapshot(); setMessage(null); setElapsed(0); transition("permission");
    try {
      const { DictationRecorder } = await import("./dictation-recorder"); signal.throwIfAborted();
      const instance = new DictationRecorder(); recorder.current = instance;
      await instance.start(signal, () => { void stop(true); }); signal.throwIfAborted();
      transition("listening"); setAnnouncement("Écoute en cours.");
    } catch (error) {
      if (signal.aborted) return;
      recorder.current?.cancel(); recorder.current = null; transition("idle");
      const denied = error instanceof DOMException && error.name === "NotAllowedError";
      setMessage({ tone: "warning", title: denied ? "Microphone non autorisé." : "Aucun microphone disponible.", text: denied ? "Autorisez le microphone pour Hestia dans les réglages du navigateur, puis réessayez. Vous pouvez aussi écrire votre commentaire." : "Branchez ou activez un microphone, puis réessayez. Vous pouvez aussi écrire votre commentaire." });
    }
  }
  async function stop(limit = false) {
    if (phase.current !== "listening" || !recorder.current || !operation.current || !base.current) return;
    const ac = operation.current, recording = recorder.current, snapshot = base.current, signal = AbortSignal.any([ac.signal, lifetime.current!.signal]);
    transition("transcribing"); setAnnouncement(limit ? "Limite atteinte. Transcription demandée." : "Transcription demandée.");
    if (limit) setMessage({ title: "Limite atteinte.", text: "L’enregistrement s’est arrêté à 2 minutes ; la transcription est demandée." });
    try {
      let audio: Blob | null = await recording.stop(); if (recorder.current === recording) recorder.current = null; signal.throwIfAborted();
      // No capture queue and no retry: a paid remote call never holds document navigation.
      const response = await fetch(`/api/hestia/transcriptions?${sourceQuery}&idempotencyKey=${crypto.randomUUID()}`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "audio/wav" }, signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]), body: audio }); audio = null;
      const result = await response.json() as TranscriptionResultDto & { error?: { code?: string } }; signal.throwIfAborted();
      if (response.status === 401 || response.status === 403) { onAccessLost(); return; }
      if (!response.ok || result.status !== "complete") throw new CaptureError(response.status, result.error?.code || "TRANSCRIPTION_FAILED", "Transcription impossible.");
      if (!result.text?.trim()) setMessage({ title: "Aucun texte reconnu.", text: "Rien n’a été ajouté au commentaire. Dictez à nouveau plus près du microphone, ou écrivez." });
      else { onResult(result.text, snapshot); setAnnouncement("Texte dicté reçu. Relisez-le."); }
    } catch (error) {
      if (signal.aborted) return;
      const budget = error instanceof CaptureError && /BUDGET|LIMIT/.test(error.code);
      setMessage({ tone: "warning", title: budget ? "Plafond de la dictée atteint." : "Transcription impossible.", text: budget ? "Cette dictée n’a pas été transcrite. Votre commentaire est intact ; vous pouvez l’écrire au clavier." : "La transcription n’a pas abouti et l’enregistrement n’est pas conservé. Votre commentaire est intact. Dictez à nouveau ou écrivez." });
    } finally { recording.cancel(); if (recorder.current === recording) recorder.current = null; if (!signal.aborted) { transition("idle"); base.current = null; } }
  }
  const unavailable = !compatible || !availability?.available;
  const reason = !compatible ? "La dictée n’est pas possible sur cet appareil. Vous pouvez écrire votre commentaire." : availability?.reason === "budget" ? "Plafond mensuel de la dictée atteint. Vous pouvez écrire votre commentaire." : "Dictée momentanément indisponible. Vous pouvez écrire votre commentaire.";
  return <>
    <span className="hc-sr-only" role="status">{announcement}</span>
    {availability?.enabled && <div className="hc-voice-stack">
      {state === "idle" ? unavailable ? <div className="hc-row"><span className="hc-voice-unavailable"><Icon name="mic-off" size={18}/>Dictée indisponible</span><span className="hc-muted">{reason}</span></div> : <div><Button variant="secondary" compact icon="mic" disabled={pending} onClick={() => void start()}>{getSnapshot().text.trim() ? "Dicter la suite" : "Dicter"}</Button></div> : state === "listening" ? <div ref={stopBox} className="hc-voice-listening" role="group" aria-label="Dictée en cours"><span className="hc-voice-word"><span className="hc-voice-pulse" aria-hidden="true"/><Icon name="mic" size={18}/>Écoute <span className="hc-voice-time">{elapsed >= 105 ? <><Icon name="alert" size={16}/>encore {120 - elapsed} s</> : `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")} / 2:00`}</span></span><Button compact icon="square" onClick={() => void stop()}>Arrêter et transcrire</Button><Button variant="tertiary" compact onClick={() => cancel()}>Annuler</Button></div> : <div ref={statusBox} tabIndex={-1} className="hc-row hc-voice-status"><strong className="hc-row"><Icon name={state === "permission" ? "mic" : "loader"} size={18}/>{state === "permission" ? "Autorisation du microphone demandée…" : "Transcription en cours…"}</strong>{state === "transcribing" && <span className="hc-muted">Vous pouvez continuer à écrire.</span>}<Button compact variant="tertiary" onClick={() => cancel()}>{state === "permission" ? "Annuler" : "Ne pas utiliser le résultat"}</Button></div>}
      <span className="hc-voice-info">L’audio{availability.vocabularySupported ? " et une courte liste de mots tirés des noms des dossiers où vous pouvez déposer" : ""} sont envoyés au service de transcription. Hestia ne conserve pas l’audio. Les conditions du fournisseur s’appliquent.</span>
    </div>}
    {message && <Banner {...message} action={state === "idle" && !pending && availability?.available ? "Dicter à nouveau" : undefined} onAction={() => void start()}>{message.text}</Banner>}
  </>;
}
