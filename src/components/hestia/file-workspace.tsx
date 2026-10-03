/* eslint-disable @next/next/no-img-element -- Private, ephemeral Blob URLs must never pass through an image optimization service. */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { requestNativeCapture, type CaptureResult } from "./native-capture";
import { Banner, Button, EmptyState, Icon, PageHeader, Skeleton, TextField } from "./design-system";

export type FileDocument = { id: string; folderId: string; title: string; fileName: string; mediaType: string; size: number; sha256: string; createdAt: string; uploadedByName: string; source: "import" | "camera"; version: number; previewSupported: boolean; capabilities: string[] };
type Folder = { id: string; name: string; capabilities: string[] };
type Draft = { id: string; file: File; title: string; source: "import" | "camera"; status: "ready" | "sending" | "done" | "failed" | "duplicate" | "rejected"; progress: number; operation?: string; hash?: string; keepDuplicate: boolean; error?: string };
const MAX = 20 * 1024 * 1024;
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.heif";
class FileError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
async function api<T>(path: string, signal: AbortSignal, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/hestia${path}`, { method, signal, credentials: "same-origin", cache: "no-store", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new FileError(response.status, result.error?.code || "UNAVAILABLE", result.error?.message || "L’action n’a pas pu aboutir. Réessayez.");
  return result as T;
}
const message = (e: unknown) => e instanceof Error ? e.message : "Impossible de joindre Hestia. Réessayez.";
const sizeLabel = (n: number) => n < 1024 * 1024 ? `${Math.ceil(n / 1024)} Ko` : `${(n / 1024 / 1024).toFixed(1)} Mio`;
const dateLabel = (s: string) => new Date(s).toLocaleDateString("fr-FR");
const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
const digest = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), v => v.toString(16).padStart(2, "0")).join("");
function mobileCamera() {
  // Touch and viewport alone also match convertible PCs. Require a mobile platform.
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}
function Thumb({ type }: { type: string }) { return <span className={`h-file-thumb ${type === "application/pdf" ? "h-file-pdf" : "h-file-image"}`} aria-hidden="true">{type === "application/pdf" ? "PDF" : "IMG"}</span>; }

export function FileWorkspace({ folder, folders, host, onAccessLost, onUpdated, query, onQuery, onFolder, initialCapture }: { initialCapture?: CaptureResult | null; folder?: Folder; folders: Folder[]; host: HTMLElement | null; onAccessLost: () => void; onUpdated: () => void; query?: string; onQuery?: (value: string) => void; onFolder?: (id: string) => void }) {
  const [documents, setDocuments] = useState<FileDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string>();
  const [panel, setPanel] = useState<"deposit" | "capture" | "document" | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const draftsRef = useRef<Draft[]>([]);
  const [active, setActive] = useState<FileDocument | null>(null);
  const [preview, setPreview] = useState<string>();
  const [previewState, setPreviewState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [capture, setCapture] = useState<{ file: File; url: string } | null>(null);
  const [captureStatus, setCaptureStatus] = useState<"waiting" | "cancelled" | "unavailable">("waiting");
  const [captureFailed, setCaptureFailed] = useState(false);
  const [camera, setCamera] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [panelError, setPanelError] = useState<string>();
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null), imageInput = useRef<HTMLInputElement>(null);
  const controller = useRef(new AbortController());
  const previewController = useRef<AbortController | null>(null);
  const urls = useRef(new Set<string>());
  const running = useRef(false);
  const listEpoch = useRef(0);
  const createUrl = (blob: Blob) => { const url = URL.createObjectURL(blob); urls.current.add(url); return url; };
  const revoke = (url?: string) => { if (url) { URL.revokeObjectURL(url); urls.current.delete(url); } };
  const updateDraft = (id: string, update: Partial<Draft>) => { draftsRef.current = draftsRef.current.map(d => d.id === id ? { ...d, ...update } : d); setDrafts(draftsRef.current); };
  const fail = useCallback((error: unknown) => { if (error instanceof FileError && [401, 403, 404].includes(error.status)) onAccessLost(); }, [onAccessLost]);
  const reload = useCallback(async () => {
    const seq = ++listEpoch.current;
    const signal = controller.current.signal;
    setLoading(true); setFailure(undefined);
    try {
      if (query !== undefined && !query.trim()) { setDocuments([]); return; }
      const params = new URLSearchParams(); if (folder) params.set("folderId", folder.id); if (query !== undefined) params.set("q", query);
      const result = await api<{ documents: FileDocument[] }>(`/documents?${params}`, signal);
      if (!signal.aborted && seq === listEpoch.current) setDocuments(result.documents);
    } catch (error) { if (!signal.aborted && seq === listEpoch.current) { setDocuments([]); setFailure(message(error)); fail(error); } }
    finally { if (!signal.aborted && seq === listEpoch.current) setLoading(false); }
  }, [folder, query, fail]);
  useEffect(() => {
    controller.current = new AbortController();
    const liveUrls = urls.current;
    Promise.resolve().then(() => { if (!controller.current.signal.aborted) setCamera(mobileCamera()); });
    return () => { controller.current.abort(); previewController.current?.abort(); for (const url of liveUrls) URL.revokeObjectURL(url); liveUrls.clear(); draftsRef.current = []; };
  }, []);
  useEffect(() => { const timer = setTimeout(() => void reload(), query === undefined ? 0 : 180); return () => clearTimeout(timer); }, [reload, query]);

  useEffect(() => {
    if (!initialCapture) return;
    const timer = setTimeout(() => {
      setPanel("capture");
      if (initialCapture.file && initialCapture.file.size <= MAX) { const url = URL.createObjectURL(initialCapture.file); urls.current.add(url); setCapture({file: initialCapture.file, url}); }
      else { setCaptureStatus("cancelled"); if (initialCapture.file) setPanelError("Ce fichier dépasse 20 Mio."); }
    }, 0);
    return () => clearTimeout(timer);
  }, [initialCapture]);

  function closePanel() {
    if (running.current) return;
    previewController.current?.abort(); revoke(preview); revoke(capture?.url);
    setPanel(null); setActive(null); setPreview(undefined); setCapture(null); setPanelError(undefined); setTitle(null);
    for (const draft of draftsRef.current) if (draft.operation && draft.status !== "done") void api(`/uploads/${draft.operation}`, controller.current.signal, "DELETE").catch(() => {});
    draftsRef.current = []; setDrafts([]);
  }
  function addFiles(files: File[], source: "import" | "camera" = "import") {
    if (!folder || running.current) return;
    revoke(capture?.url); setCapture(null); setPanel("deposit"); setPanelError(undefined);
    const added: Draft[] = files.map(file => {
      const error = file.size > MAX ? "Ce fichier dépasse 20 Mio." : file.size === 0 ? "Ce fichier est vide." : !/\.(pdf|jpe?g|png|webp|heic|heif)$/i.test(file.name) ? "Format refusé. Choisissez un PDF ou une photo JPEG, PNG, WebP, HEIC ou HEIF." : undefined;
      return { id: crypto.randomUUID(), file, title: source === "camera" ? `Photo du ${new Date().toLocaleDateString("fr-FR")}` : file.name.replace(/\.[^.]+$/, "").slice(0, 200), source, status: error ? "rejected" : "ready", error, progress: 0, keepDuplicate: false };
    });
    draftsRef.current = [...draftsRef.current, ...added]; setDrafts(draftsRef.current);
  }
  async function remove(draft: Draft) {
    if (running.current) return;
    setPanelError(undefined);
    if (draft.operation) {
      try { const result = await api<{status: string}>(`/uploads/${draft.operation}`, controller.current.signal, "DELETE"); if (result.status === "completed") { updateDraft(draft.id, { status: "done" }); await reload(); onUpdated(); return; } }
      catch (error) { if (!controller.current.signal.aborted) { setPanelError(message(error)); fail(error); } return; }
    }
    draftsRef.current = draftsRef.current.filter(d => d.id !== draft.id); setDrafts(draftsRef.current);
  }
  async function save(ids?: string[]) {
    if (!folder || running.current) return;
    running.current = true; setBusy(true); setPanelError(undefined);
    const signal = controller.current.signal;
    try {
      for (const draft of draftsRef.current.filter(d => ids ? ids.includes(d.id) : d.status === "ready")) {
        if (signal.aborted) break;
        if (!draft.title.trim()) { updateDraft(draft.id, { error: "Donnez un titre au document." }); continue; }
        updateDraft(draft.id, { status: "sending", error: undefined });
        try {
          const sha256 = draft.hash || await digest(await draft.file.arrayBuffer());
          if (signal.aborted) break;
          updateDraft(draft.id, { hash: sha256 });
          const { operation } = await api<{ operation: { id: string; chunkSize: number; status: string } }>("/uploads", signal, "POST", { folderId: folder.id, idempotencyKey: draft.id, fileName: draft.file.name, title: draft.title.trim(), size: draft.file.size, mediaType: draft.file.type || ({ heic: "image/heic", heif: "image/heif" }[draft.file.name.split(".").pop()!.toLowerCase()] || "application/octet-stream"), sha256, source: draft.source });
          updateDraft(draft.id, { operation: operation.id });
          if (operation.status === "uploading") {
            const chunk = Math.min(operation.chunkSize, 2 * 1024 * 1024);
            if (!Number.isInteger(chunk) || chunk <= 0) throw new Error("Transfert indisponible. Réessayez.");
            for (let offset = 0, index = 0; offset < draft.file.size; offset += chunk, index++) {
              const response = await fetch(`/api/hestia/uploads/${operation.id}/chunks/${index}`, { method: "PUT", credentials: "same-origin", cache: "no-store", signal, headers: { "Content-Type": "application/octet-stream" }, body: draft.file.slice(offset, offset + chunk) });
              if (!response.ok) { const result = await response.json().catch(() => ({})); throw new FileError(response.status, result.error?.code || "UNAVAILABLE", result.error?.message || "Envoi interrompu. Réessayez."); }
              updateDraft(draft.id, { progress: Math.min(95, Math.round((offset + chunk) / draft.file.size * 95)) });
            }
          }
          await api(`/uploads/${operation.id}/complete`, signal, "POST", { keepDuplicate: draft.keepDuplicate });
          if (signal.aborted) break;
          updateDraft(draft.id, { status: "done", progress: 100 }); await reload(); onUpdated();
        } catch (error) {
          if (signal.aborted) break;
          const duplicate = error instanceof FileError && error.code === "DUPLICATE";
          const rejected = error instanceof FileError && [400, 413, 415, 422].includes(error.status);
          updateDraft(draft.id, { status: duplicate ? "duplicate" : rejected ? "rejected" : "failed", error: message(error) }); fail(error);
          // Only one active operation per member: resolve its result before the next file.
          if (!rejected) break;
          const rejectedOperation = draftsRef.current.find(d => d.id === draft.id)?.operation;
          if (rejectedOperation) { try { await api(`/uploads/${rejectedOperation}`, signal, "DELETE"); } catch (cancelError) { setPanelError(message(cancelError)); fail(cancelError); break; } }
        }
      }
    } finally { running.current = false; if (!signal.aborted) setBusy(false); }
  }
  async function readBytes(doc: FileDocument, intent: "preview" | "download", signal: AbortSignal) {
    if (doc.size <= 0 || doc.size > MAX) throw new Error("Taille du fichier refusée.");
    const bytes = new Uint8Array(doc.size);
    for (let offset = 0; offset < doc.size; offset += 2 * 1024 * 1024) {
      const length = Math.min(2 * 1024 * 1024, doc.size - offset);
      const response = await fetch(`/api/hestia/documents/${doc.id}/content?offset=${offset}&length=${length}&intent=${intent}`, { signal, credentials: "same-origin", cache: "no-store" });
      if (!response.ok) { const result = await response.json().catch(() => ({})); throw new FileError(response.status, result.error?.code || "UNAVAILABLE", result.error?.message || "Le fichier est indisponible. Réessayez."); }
      const part = new Uint8Array(await response.arrayBuffer());
      if (part.byteLength !== length) throw new Error("Le fichier reçu est incomplet. Réessayez.");
      bytes.set(part, offset);
    }
    if (await digest(bytes.buffer) !== doc.sha256) throw new Error("L’intégrité du fichier reçu n’a pas pu être vérifiée.");
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return bytes;
  }
  async function openDocument(doc: FileDocument) {
    closePanel(); setPanel("document"); setActive(doc); setPreviewState("loading");
    const current = new AbortController(); previewController.current = current;
    try {
      const result = await api<{ document: FileDocument }>(`/documents/${doc.id}`, current.signal);
      if (current.signal.aborted) return; setActive(result.document);
      if (!result.document.previewSupported) { setPreviewState("unavailable"); return; }
      const bytes = await readBytes(result.document, "preview", current.signal);
      if (current.signal.aborted) return;
      setPreview(createUrl(new Blob([bytes], { type: result.document.mediaType }))); setPreviewState("ready");
    } catch (error) { if (!current.signal.aborted) { setPreviewState("unavailable"); setPanelError(message(error)); fail(error); } }
  }
  async function download() {
    if (!active || busy) return; setBusy(true); setPanelError(undefined);
    const signal = controller.current.signal;
    try {
      const bytes = await readBytes(active, "download", signal);
      const url = createUrl(new Blob([bytes], { type: active.mediaType }));
      const link = document.createElement("a"); link.href = url; link.download = active.fileName; link.click();
      setTimeout(() => revoke(url), 1000);
    } catch (error) { if (!signal.aborted) { setPanelError(message(error)); fail(error); } }
    finally { if (!signal.aborted) setBusy(false); }
  }
  async function rename() {
    if (!active || title === null || busy) return;
    if (!title.trim()) { setPanelError("Donnez un titre au document."); return; }
    setBusy(true); setPanelError(undefined); const signal = controller.current.signal;
    try { const result = await api<{document: FileDocument}>(`/documents/${active.id}`, signal, "PATCH", { title: title.trim(), version: active.version }); if (!signal.aborted) { setActive(result.document); setTitle(null); await reload(); } }
    catch (error) { if (!signal.aborted) { setPanelError(message(error)); fail(error); if (error instanceof FileError && error.status === 409) { setTitle(null); await openDocument(active); setPanelError("Le document a changé. Le titre à jour a été rechargé."); } } }
    finally { if (!signal.aborted) setBusy(false); }
  }
  function startCapture() {
    if (!camera || running.current) return;
    revoke(capture?.url); setCapture(null); setCaptureFailed(false); setPanel("capture"); setCaptureStatus("waiting"); setPanelError(undefined);
    if (folder) requestNativeCapture(folder.id);
  }
  const matchingFolders = query?.trim() ? folders.filter(f => fold(f.name).includes(fold(query.trim()))) : [];
  const canDeposit = folder?.capabilities.includes("déposer");
  const panelContent = panel && host && createPortal(<aside className="h-panel h-files-panel" aria-label={panel === "document" ? "Document" : panel === "capture" ? "Photo" : "Ajout de documents"}>
    <Button variant="tertiary" compact icon="x" disabled={busy} onClick={closePanel}>Fermer</Button>
    {panelError && <Banner tone="danger" title="Action impossible.">{panelError}</Banner>}
    {panel === "deposit" && <div className="h-file-stack"><h2>Ajouter des documents</h2><p className="h-hint">Dans « {folder?.name} » · PDF, JPEG, PNG, WebP, HEIC ou HEIF · 20 Mio par fichier</p>
      {drafts.map(d => <div key={d.id} className={`h-upload-item h-upload-${d.status}`}>
        {d.status === "ready" ? <><div className="h-upload-heading"><Thumb type={d.file.type}/><span>{d.file.name} · {sizeLabel(d.file.size)}</span><Button variant="tertiary" compact onClick={() => void remove(d)}>Retirer</Button></div><TextField label="Titre du document" value={d.title} maxLength={200} error={d.error} hint="Prérempli depuis le nom du fichier. Le fichier lui-même ne change pas." onChange={e => updateDraft(d.id, { title: e.target.value })}/></> : <><strong>{d.title || d.file.name}</strong>{d.status === "sending" && <><div role="progressbar" aria-label={`Envoi de ${d.title}`} aria-valuenow={d.progress} aria-valuemin={0} aria-valuemax={100} className="h-file-progress"><span style={{ width: `${d.progress}%` }}/></div><span>Envoi en cours… {d.progress} %</span></>}{d.status === "done" && <span role="status"><Icon name="check"/> Document enregistré.</span>}{d.status === "duplicate" && <><Banner title="Déjà présent.">Un document identique est déjà consultable dans ce dossier.</Banner><div className="h-actions"><Button variant="secondary" compact disabled={busy} onClick={() => void remove(d)}>Ne pas l’ajouter</Button><Button variant="tertiary" compact disabled={busy} onClick={() => { updateDraft(d.id, { keepDuplicate: true }); void save([d.id]); }}>L’ajouter quand même</Button></div></>}{d.status === "rejected" && <><Banner tone="danger" title="Fichier refusé.">{d.error}</Banner><Button variant="tertiary" compact disabled={busy} onClick={() => void remove(d)}>Retirer</Button></>}{d.status === "failed" && <><Banner tone="danger" title="Sans confirmation.">{d.error} Le document a peut-être été enregistré ; réessayer ne créera pas de deuxième exemplaire.</Banner><Button variant="secondary" disabled={busy} onClick={() => void save([d.id])}>Vérifier et réessayer</Button><Button variant="tertiary" disabled={busy} onClick={() => void remove(d)}>Annuler</Button></>}</>}
      </div>)}
      {!drafts.length && <div className={`h-dropzone ${over ? "h-dropzone-over" : ""}`} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={e => { e.preventDefault(); setOver(false); addFiles(Array.from(e.dataTransfer.files)); }}><Icon name="upload" size={36}/><strong>{over ? "Relâchez pour déposer les fichiers" : "Glissez vos fichiers ici"}</strong><span>ou</span><Button variant="secondary" onClick={() => input.current?.click()}>Choisir des fichiers</Button><span className="h-hint">PDF ou photos · 20 Mio par fichier</span></div>}
      <div className="h-actions">{drafts.some(d => d.status === "ready") && <Button icon="check" loading={busy} onClick={() => void save()}>Enregistrer</Button>}{drafts.length > 0 && drafts.every(d => d.status === "done") && <Button icon="check" onClick={closePanel}>Terminé</Button>}<Button variant="secondary" icon="plus" disabled={busy || drafts.some(d => ["failed", "duplicate"].includes(d.status))} onClick={() => input.current?.click()}>Ajouter d’autres fichiers</Button><Button variant="tertiary" disabled={busy} onClick={closePanel}>Annuler</Button></div>
    </div>}
    {panel === "capture" && <div className="h-file-stack"><h2>Prendre une photo</h2>{capture ? <><div className="h-preview h-preview-image">{captureFailed ? <p>Aperçu indisponible</p> : <img src={capture.url} alt="Aperçu de la photo prise" onError={() => setCaptureFailed(true)}/>}</div><p>Vérifiez que la photo est nette et lisible avant de l’ajouter.</p><div className="h-actions"><Button icon="check" onClick={() => addFiles([capture.file], "camera")}>Utiliser cette photo</Button><Button variant="secondary" icon="camera" onClick={startCapture}>Reprendre</Button><Button variant="tertiary" onClick={() => { revoke(capture.url); setCapture(null); setCaptureStatus("cancelled"); }}>Annuler</Button></div></> : <><Banner title={captureStatus === "waiting" ? "L’appareil photo de votre téléphone s’ouvre." : captureStatus === "cancelled" ? "Prise de photo annulée." : "Appareil photo indisponible."}>{captureStatus === "waiting" ? "Revenez ici après la prise de vue." : "Rien n’a été ajouté au dossier."}</Banner><div className="h-actions"><Button variant="secondary" icon="camera" onClick={startCapture}>Reprendre une photo</Button><Button variant="secondary" onClick={() => imageInput.current?.click()}>Choisir une image existante</Button><Button variant="tertiary" onClick={closePanel}>Annuler</Button></div></>}</div>}
    {panel === "document" && active && <div className="h-file-stack"><div className="h-upload-heading"><Thumb type={active.mediaType}/><h2>{active.title}</h2></div>{title !== null && <form onSubmit={e => { e.preventDefault(); void rename(); }} className="h-file-stack"><TextField label="Titre du document" hint="Le fichier d’origine ne sera pas modifié." value={title} maxLength={200} onChange={e => setTitle(e.target.value)}/><div className="h-actions"><Button type="submit" variant="secondary" loading={busy}>Enregistrer le titre</Button><Button variant="tertiary" onClick={() => setTitle(null)}>Annuler</Button></div></form>}
      <FilePreview source={preview} doc={active} state={previewState} onFailure={() => { revoke(preview); setPreview(undefined); setPreviewState("unavailable"); }}/>
      <div className="h-actions">{active.capabilities.includes("consulter") && active.capabilities.includes("exporter") && <Button variant="secondary" icon="download" loading={busy} onClick={() => void download()}>Télécharger</Button>}{active.capabilities.includes("modifier") && title === null && <Button variant="secondary" icon="pencil" onClick={() => setTitle(active.title)}>Renommer</Button>}</div><dl className="h-file-metadata"><div><dt>Fichier d’origine</dt><dd>{active.fileName}</dd></div><div><dt>Ajouté</dt><dd>{dateLabel(active.createdAt)} par {active.uploadedByName} · {active.source === "camera" ? "Photo" : "Import"}</dd></div><div><dt>Taille</dt><dd>{sizeLabel(active.size)}</dd></div></dl>{active.capabilities.includes("supprimer") && <Button variant="secondary" disabled title="Disponible dans la prochaine étape">Mettre à la corbeille</Button>}</div>}
  </aside>, host);
  return <>
    <input ref={input} type="file" accept={ACCEPT} multiple hidden aria-label="Fichiers à ajouter" onChange={e => { addFiles(Array.from(e.target.files || [])); e.target.value = ""; }}/>
    <input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" hidden aria-label="Image existante" onChange={e => { addFiles(Array.from(e.target.files || [])); e.target.value = ""; }}/>
    {query !== undefined && <><PageHeader title="Recherche" summary={query.trim() ? `${documents.length} document${documents.length > 1 ? "s" : ""}` : ""}/><TextField label="Rechercher" type="search" hint="Titre ou nom d’origine d’un document, nom d’un dossier" value={query} onChange={e => onQuery?.(e.target.value)}/></>}
    {canDeposit && <div className="h-actions"><Button icon="upload" onClick={() => { closePanel(); setPanel("deposit"); input.current?.click(); }}>Ajouter un document</Button><Button variant="secondary" icon="camera" disabled={!camera} title={camera ? undefined : "La prise de photo est disponible sur téléphone et tablette."} onClick={startCapture}>Prendre une photo</Button></div>}
    {loading ? <Skeleton/> : failure ? <Banner tone="danger" title="Chargement impossible.">{failure}</Banner> : query !== undefined && !query.trim() ? <EmptyState title="Que recherchez-vous ?">Saisissez un titre de document ou un nom de dossier.</EmptyState> : <>{matchingFolders.length > 0 && <><div className="h-overline">Dossiers · {matchingFolders.length}</div><ul className="h-document-list">{matchingFolders.map(f => <li key={f.id}><button className="h-document-row cdv-focus" onClick={() => onFolder?.(f.id)}><Icon name="folder"/><span className="h-row-text"><strong>{f.name}</strong></span></button></li>)}</ul></>}{documents.length > 0 ? <><div className="h-overline">Documents · {documents.length}</div><ul className="h-document-list">{documents.map(d => <li key={d.id}><button className="h-document-row cdv-focus" onClick={() => void openDocument(d)}><Thumb type={d.mediaType}/><span className="h-row-text"><strong>{d.title}</strong><span>{d.fileName} · {dateLabel(d.createdAt)}</span></span></button></li>)}</ul></> : matchingFolders.length === 0 && <EmptyState title={query !== undefined ? "Aucun résultat" : "Ce dossier est vide"}>{query !== undefined ? "La recherche porte sur les documents et dossiers auxquels vous avez accès. Les documents à la corbeille n’apparaissent pas." : "Aucun document n’a encore été ajouté."}</EmptyState>}</>}
    {panelContent}
  </>;
}

function FilePreview({ source, doc, state, onFailure }: { source?: string; doc: FileDocument; state: "loading" | "ready" | "unavailable"; onFailure: () => void }) {
  if (state === "loading") return <div className="h-preview" role="status"><Icon name="loader" size={28}/><span>Préparation de l’aperçu…</span></div>;
  if (state === "unavailable" || !source) return <div className="h-preview h-preview-unavailable" role="status"><Icon name="eye" size={28}/><strong>Aperçu indisponible</strong><span>{doc.capabilities.includes("exporter") ? "Hestia ne sait pas afficher ce fichier. Vous pouvez le télécharger pour l’ouvrir sur votre appareil." : "Hestia ne sait pas afficher ce fichier, et votre accès ne permet pas de le télécharger."}</span></div>;
  if (doc.mediaType === "application/pdf") return <PdfPreview source={source} title={doc.title} onFailure={onFailure}/>;
  return <div className="h-preview h-preview-image"><img src={source} alt={`Aperçu de ${doc.title}`} onError={onFailure}/></div>;
}
function PdfPreview({ source, title, onFailure }: { source: string; title: string; onFailure: () => void }) {
  const target = useRef<HTMLDivElement>(null);
  const failureRef = useRef(onFailure);
  useEffect(() => { failureRef.current = onFailure; }, [onFailure]);
  useEffect(() => {
    let stopped = false;
    let destroy: (() => void) | undefined;
    let observer: IntersectionObserver | undefined;
    const tasks = new Map<Element, { cancel: () => void }>();
    const container = target.current;
    async function render() {
      const pdf = await import("pdfjs-dist");
      pdf.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const task = pdf.getDocument({ url: source, enableXfa: false });
      destroy = () => { void task.destroy(); };
      const document = await task.promise;
      const pages = new Map<Element, { index: number; width: number; height: number; scale: number }>();
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const frame = entry.target as HTMLDivElement;
          if (!entry.isIntersecting) { tasks.get(frame)?.cancel(); tasks.delete(frame); frame.replaceChildren(); continue; }
          if (frame.childElementCount || stopped) continue;
          const info = pages.get(frame)!;
          const canvas = window.document.createElement("canvas"); canvas.width = info.width; canvas.height = info.height;
          canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", `Aperçu de ${title}, page ${info.index}`);
          frame.appendChild(canvas);
          void document.getPage(info.index).then(page => {
            if (stopped || !canvas.isConnected) return;
            const task = page.render({canvas, viewport: page.getViewport({scale: info.scale})}); tasks.set(frame,task);
            return task.promise.catch(error => { if (error?.name !== "RenderingCancelledException") throw error; });
          }).catch(() => { if (!stopped) failureRef.current(); });
        }
      }, { root: container, rootMargin: "100px" });
      for (let index = 1; index <= document.numPages; index++) {
        if (stopped) return;
        const page = await document.getPage(index);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(1.5, 900 / base.width, 1400 / base.height);
        const viewport = page.getViewport({ scale });
        const frame = window.document.createElement("div"); frame.className = "h-pdf-page"; frame.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
        pages.set(frame, {index, scale, width: Math.ceil(viewport.width), height: Math.ceil(viewport.height)});
        if (stopped) return;
        container?.appendChild(frame); observer.observe(frame);
      }
    }
    void render().catch(() => { if (!stopped) failureRef.current(); });
    return () => { stopped = true; observer?.disconnect(); for (const task of tasks.values()) task.cancel(); tasks.clear(); destroy?.(); container?.replaceChildren(); };
  }, [source, title]);
  return <div ref={target} className="h-preview h-preview-pdf"/>;
}
