"use client";
import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import type { CaptureDto } from "../../shared/capture-contract";
import { COMMENT_MAX_LENGTH, commentLength, isValidComment } from "../../shared/capture-comment";
import { Banner, Button, Icon, TextArea } from "./design-system";
import { StatusPill } from "./family-ui";
import { captureRequest, CaptureError, registerCaptureClientWork } from "./capture-client";
import { CaptureDictation, type CommentSnapshot } from "./capture-dictation";
export type CommentSaved = { comment: string; commentVersion: number };
export type CaptureCommentHandle = { flush: (manual?: boolean) => Promise<CommentSaved>; value: () => string };
export function LengthMeter({ text }: { text: string }) {
  const length = commentLength(text), over = length - COMMENT_MAX_LENGTH;
  return <span className={`hc-length ${over > 0 ? "hc-length-over" : ""}`}>{over > 0 && <Icon name="alert" size={16}/ >}{length.toLocaleString("fr-FR")} / 2 000 caractères{over > 0 ? ` · ${over.toLocaleString("fr-FR")} en trop` : ""}</span>;
}
export function CaptureComment({ capture, active, handleRef, onEdited, onSaved, onAccessLost }: {
  capture: CaptureDto; active: boolean; handleRef: Ref<CaptureCommentHandle>;
  onEdited: (valid: boolean, nonempty: boolean) => void; onSaved: (value: CommentSaved) => void; onAccessLost: () => void;
}) {
  const [text, setText] = useState(capture.comment), [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">(capture.comment ? "saved" : "idle");
  const [conflict, setConflict] = useState(false), [message, setMessage] = useState("");
  const [pending, setPending] = useState<{ text: string; reason: string } | null>(null), [appended, setAppended] = useState<{ before: string; after: string } | null>(null);
  const current = useRef(capture.comment), revision = useRef(0), saved = useRef<CommentSaved>({ comment: capture.comment, commentVersion: capture.commentVersion });
  const controller = useRef<AbortController | null>(null), saving = useRef<Promise<CommentSaved> | null>(null), activeRef = useRef(active), conflictRef = useRef(false);
  const identity = useId();
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => {
    // An explicit refresh may bring a newer saved comment, but must never replace
    // local edits or regress a revision already acknowledged by the save request.
    if (capture.commentVersion > saved.current.commentVersion && current.current === saved.current.comment) {
      saved.current = { comment: capture.comment, commentVersion: capture.commentVersion }; current.current = capture.comment;
      setText(capture.comment); setStatus(capture.comment ? "saved" : "idle");
    }
  }, [capture.comment, capture.commentVersion]);
  useEffect(() => {
    const ac = new AbortController(); controller.current = ac; const unregister = registerCaptureClientWork(ac);
    return () => { ac.abort(); unregister(); current.current = ""; saved.current = { comment: "", commentVersion: 0 }; };
  }, [capture.id]);
  function edit(value: string) {
    current.current = value; revision.current++; setText(value); setAppended(null);
    setStatus(value === saved.current.comment ? "saved" : isValidComment(value) ? "saving" : "failed"); onEdited(isValidComment(value), !!value.trim());
  }
  async function flush(manual = false): Promise<CommentSaved> {
    if (!isValidComment(current.current)) { if (manual) return saved.current; throw new Error("Raccourcissez le commentaire à 2 000 caractères pour demander des suggestions."); }
    if (conflictRef.current) throw new Error("Actualisez le commentaire du brouillon avant de poursuivre. Votre texte local est conservé.");
    if (saving.current) { await saving.current; return flush(manual); }
    const signal = controller.current?.signal;
    if (!signal || signal.aborted) throw new DOMException("Annulé", "AbortError");
    if (current.current === saved.current.comment) return saved.current;
    const value = current.current;
    setStatus("saving");
    saving.current = captureRequest<CommentSaved>(`/capture/${capture.id}/comment`, signal, "PATCH", { commentVersion: saved.current.commentVersion, comment: value }).then(result => {
      signal.throwIfAborted(); saved.current = result; onSaved(result); setStatus(current.current === result.comment ? "saved" : "saving"); setMessage(""); return result;
    }).catch(error => {
      if (!signal.aborted) {
        setStatus("failed");
        if (error instanceof CaptureError && [401, 403].includes(error.status)) onAccessLost();
        else if (error instanceof CaptureError && error.status === 409) { conflictRef.current = true; setConflict(true); setMessage("Le brouillon a été modifié sur un autre appareil. Votre commentaire local est conservé."); }
        else setMessage("Commentaire non enregistré. Votre texte reste disponible ici. Réessayez.");
      }
      throw error;
    }).finally(() => { saving.current = null; });
    await saving.current;
    return current.current === saved.current.comment ? saved.current : flush(manual);
  }
  useImperativeHandle(handleRef, () => ({ flush, value: () => current.current }));
  useEffect(() => {
    if (!isValidComment(text) || text === saved.current.comment || conflictRef.current) return;
    const timer = setTimeout(() => { void flush().catch(() => {}); }, 900);
    return () => clearTimeout(timer);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  async function refresh() {
    const signal = controller.current!.signal;
    try {
      const result = await captureRequest<{ capture: CaptureDto }>(`/capture/${capture.id}`, signal, "GET", undefined, { activity: "interactive" });
      signal.throwIfAborted(); saved.current = { comment: result.capture.comment, commentVersion: result.capture.commentVersion }; onSaved(saved.current);
      conflictRef.current = false; setConflict(false); setStatus("failed"); setMessage("Brouillon actualisé. Votre commentaire local est conservé ; réessayez pour l’enregistrer.");
    } catch (error) { if (!signal.aborted && error instanceof CaptureError && [401, 403].includes(error.status)) onAccessLost(); }
  }
  const append = (a: string, b: string) => a + (a && !/\s$/.test(a) ? " " : "") + b;
  function acceptDictation(value: string, base: CommentSnapshot) {
    const after = append(current.current, value);
    if (base.revision === revision.current && activeRef.current && isValidComment(after)) {
      const before = current.current; edit(after); setAppended({ before, after });
    } else setPending({ text: value, reason: !activeRef.current ? "Le texte est arrivé après que vous avez quitté l’étape Rangement." : base.revision !== revision.current ? "Vous avez modifié le commentaire pendant la transcription : rien n’a été remplacé." : "Ajouté tel quel, le commentaire dépasserait 2 000 caractères. Raccourcissez le texte dicté ou le commentaire, puis ajoutez-le." });
  }
  const error = commentLength(text) > COMMENT_MAX_LENGTH ? "Le commentaire dépasse 2 000 caractères. Raccourcissez-le pour demander des suggestions ; rien n’a été coupé." : !isValidComment(text) ? "Le commentaire contient un caractère non pris en charge. Corrigez-le pour demander des suggestions." : undefined;
  return <div className="hc-comment">
    <TextArea id={identity} label="Commentaire pour les suggestions (facultatif)" hint={capture.kind === "camera" ? "Guide la prochaine demande de suggestions. Visible par vous seul ; enregistré avec le brouillon, il n’est pas conservé avec le document." : "Guide la prochaine demande de suggestions. Visible par vous seul, gardé seulement pendant cette préparation."} value={text} onChange={event => edit(event.target.value)} rows={3} error={error}/>
    <div className="hc-comment-meta"><LengthMeter text={text}/>{capture.kind === "camera" && status !== "idle" && <span className="hc-row"><StatusPill icon={status === "saving" ? "loader" : status === "failed" ? "alert" : "check"} dashed={status === "failed"}>{status === "saving" ? "Enregistrement du commentaire…" : status === "failed" ? "Commentaire non enregistré" : "Commentaire enregistré dans le brouillon"}</StatusPill>{status === "failed" && <Button variant="tertiary" compact icon="refresh-cw" onClick={() => { if (conflict) void refresh(); else void flush().catch(() => {}); }}>{conflict ? "Actualiser" : "Réessayer"}</Button>}</span>}</div>
    {message && <Banner tone="warning" title={message} action={capture.kind === "import" ? conflict ? "Actualiser" : "Réessayer" : undefined} onAction={() => { if (conflict) void refresh(); else void flush().catch(() => {}); }}/ >}
    <CaptureDictation captureId={capture.id} expiresAt={capture.expiresAt} active={active} pending={!!pending} getSnapshot={() => ({ text: current.current, revision: revision.current, active: activeRef.current })} onResult={acceptDictation} onAccessLost={onAccessLost}/>
    {appended && appended.after === text && <div className="hc-row hc-muted"><Icon name="check" size={18}/><span>Texte dicté ajouté à la fin. Relisez-le et corrigez-le si besoin.</span><Button variant="tertiary" compact onClick={() => edit(appended.before)}>Retirer le texte dicté</Button></div>}
    {pending && <div className="hc-dictation-pending" role="group" aria-label="Texte dicté, pas encore ajouté"><span className="hc-note"><Icon name="info" size={18}/><span><strong>Pas encore ajouté.</strong> {pending.reason}</span></span><TextArea label="Texte dicté" rows={3} value={pending.text} onChange={event => setPending({ ...pending, text: event.target.value })}/><span className="hc-row hc-muted">Après ajout : <LengthMeter text={append(text, pending.text)}/></span><div className="hc-row"><Button variant="secondary" compact icon="plus" disabled={!isValidComment(append(text, pending.text))} onClick={() => { const before = current.current, after = append(before, pending.text); edit(after); setAppended({ before, after }); setPending(null); }}>Ajouter à la fin du commentaire</Button><Button variant="tertiary" compact onClick={() => setPending(null)}>Ne pas utiliser</Button></div></div>}
  </div>;
}
