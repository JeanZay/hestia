"use client";
import { useId, useState } from "react";
import type { CaptureDestination, ClassificationResultDto } from "../../shared/capture-contract";
import { normalizeCaptureLevel, resolveCapturePath } from "../../shared/capture-path";
import { Banner, Button, Icon, RadioGroup, TextField } from "./design-system";
import { StatusPill } from "./family-ui";
import type { TreeFolder } from "./folder-tree";
import { PickRow } from "./move-design";
import { CapturePathPlan, type CapturePathSegment } from "./capture-path-plan";

export type CapturePathDraft = ClassificationResultDto["created"][number] & { originalParentId: string | null; picks: Record<number, string> };
export const capturePathDrafts = (result: ClassificationResultDto): CapturePathDraft[] => result.created.map(value => ({ ...value, originalParentId: value.parentId, picks: {} }));
const pathLabel = (folder: TreeFolder) => folder.breadcrumbs.map(p => p.name).join(" / ") || folder.name;
const rootDescription = "Personne d’autre que vous n’y aura accès tant que vous ne l’aurez pas accordé.";
const folderMeta = (folder: TreeFolder) => `Créé par ${folder.createdByName} · ${folder.childCount} sous-dossier(s), ${folder.documentCount} document(s) visibles`;

export function CaptureDestinations({ drafts, folders, title, destination, disabled, onChange, onPick }: {
  drafts: CapturePathDraft[]; folders: TreeFolder[]; title: string; destination: CaptureDestination | null; disabled: boolean;
  onChange: (index: number, draft: CapturePathDraft) => void; onPick: (value: CaptureDestination) => void;
}) {
  return <section className="hc-stack"><h2 className="hc-section-heading">3. Créer un chemin (proposé)</h2>
    <p className="hc-muted">Rien n’est créé avant votre confirmation. Hestia réutilise les dossiers du chemin qui existent déjà et ne crée que ceux qui manquent.</p>
    {drafts.map((draft, index) => <PathSuggestion key={index} draft={draft} folders={folders} title={title} destination={destination} disabled={disabled} onChange={value => onChange(index, value)} onPick={onPick}/>)}</section>;
}

// Port of the received Capture root cards and their in-card start-point picker.
function PathSuggestion({ draft, folders, title, destination, disabled, onChange, onPick }: {
  draft: CapturePathDraft; folders: TreeFolder[]; title: string; destination: CaptureDestination | null; disabled: boolean;
  onChange: (value: CapturePathDraft) => void; onPick: (value: CaptureDestination) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false), [at, setAt] = useState<string | null>(null);
  const choiceName = useId();
  const plan = resolveCapturePath(folders, draft.parentId, draft.levels, draft.picks);
  const start = folders.find(folder => folder.id === draft.parentId);
  const original = folders.find(folder => folder.id === draft.originalParentId);
  const reusedRoot = !draft.parentId && plan.reused.length > 0;
  const rootLike = !draft.parentId && !reusedRoot && !plan.ambiguity;
  const changeParent = (parentId: string | null) => { onChange({ ...draft, parentId, picks: {} }); setPickerOpen(false); };
  const canonical: CaptureDestination | null = plan.status !== "ready" ? null : plan.allExist && plan.finalId ? { kind: "existing", folderId: plan.finalId } : { kind: "create", parentId: plan.baseId, levels: plan.missing };
  const selected = !!canonical && JSON.stringify(canonical) === JSON.stringify(destination);
  const segments: CapturePathSegment[] = [
    ...(draft.parentId ? [{ name: start ? pathLabel(start) : "Dossier indisponible", status: "start" as const, tag: "Point de départ · existant" }] : rootLike ? [{ name: "Votre espace", status: "root" as const }] : []),
    ...plan.reused.map((folder, index) => ({ name: folder.name, status: "reused" as const, ...(reusedRoot && index === 0 ? { tag: "Point de départ · existant" } : {}), ...(draft.picks[index] ? { meta: "choisi par vous" } : {}) })),
    ...(plan.ambiguity ? draft.levels.slice(plan.ambiguity.levelIndex).map((name, index) => ({ name, status: index === 0 ? "ambiguous" as const : "pending" as const })) : plan.missing.map(name => ({ name, status: "new" as const }))),
    ...(plan.status === "ready" ? [{ name: title || "Document", status: "doc" as const }] : []),
  ];
  const base = folders.find(folder => folder.id === plan.baseId);
  const unavailable = !["ready", "ambiguous", "invalid"].includes(plan.status);
  return <div className={`hc-stack hc-card hc-path-suggestion${selected ? " hc-path-selected" : ""}`}>
    <div className="hc-row" style={{ justifyContent: "space-between" }}><strong>{draft.parentId ? "Sous un dossier existant" : plan.ambiguity ? "Chemin à préciser" : reusedRoot ? "Chemin dans vos dossiers existants" : "Nouvelle racine privée"}</strong>{selected && <StatusPill icon="check">Choisie</StatusPill>}</div>
    <div className="hc-row hc-muted" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}><Icon name={rootLike ? "lock" : "folder"} size={18}/><span>{draft.parentId ? `Point de départ : « ${start ? pathLabel(start) : "dossier indisponible"} ». Les dossiers créés en reprendront les accès.` : plan.ambiguity ? "Plusieurs de vos dossiers portent ce nom : choisissez lequel utiliser avant de voir le chemin et ses accès." : reusedRoot ? `Le début de ce chemin existe déjà dans vos dossiers (« ${plan.reused[0].name} »).${plan.missing.length && base ? ` Les dossiers créés reprendront les accès de « ${base.name} ».` : ""}` : `Point de départ : racine de votre espace. ${rootDescription}`}</span></div>
    {draft.parentId !== draft.originalParentId && <div className="hc-path-start-note"><StatusPill>Point de départ modifié par vous</StatusPill><span className="hc-muted">Proposé au départ : {draft.originalParentId ? original ? `« ${pathLabel(original)} »` : "un dossier devenu indisponible" : "la racine de votre espace (privée)"}.</span><Button variant="tertiary" compact icon="rotate-ccw" disabled={disabled} onClick={() => changeParent(draft.originalParentId)}>Revenir au point de départ proposé</Button></div>}
    <div><Button variant="secondary" compact icon="folder-open" disabled={disabled} aria-expanded={pickerOpen} onClick={() => { setPickerOpen(!pickerOpen); setAt(null); }}>Changer de point de départ</Button></div>
    {pickerOpen && <div className="hc-path-picker" role="group" aria-label="Choisir le point de départ du chemin">
      <strong>Choisir le point de départ</strong><span className="hc-muted">Rien ne change tant que vous n’avez pas choisi.</span>
      <div className="hc-card" style={{ padding: 0 }} role="radiogroup" aria-label="Racine de votre espace"><PickRow label="Racine de votre espace (privé)" meta={rootDescription} selected={draft.parentId === null} disabled={disabled} onPick={() => changeParent(null)} last/></div>
      <span className="hc-muted">Ou dans un dossier existant :</span>
      <div className="hc-row">{at && <Button variant="tertiary" compact icon="chevron-left" disabled={disabled} onClick={() => setAt(folders.find(folder => folder.id === at)?.visibleParentId ?? null)}>Remonter</Button>}<span className="hc-muted">{at ? folders.find(folder => folder.id === at)?.name || "Dossier indisponible" : "Tous vos dossiers"}</span></div>
      <div className="hc-card" style={{ padding: 0 }} role="radiogroup" aria-label="Dossiers existants">{folders.filter(folder => folder.visibleParentId === at).map((folder, index, rows) => {
        const candidate = resolveCapturePath(folders, folder.id, draft.levels);
        const canUse = ["ready", "ambiguous"].includes(candidate.status);
        return <PickRow key={folder.id} label={folder.name} selected={draft.parentId === folder.id} disabled={disabled || !canUse} reason={!canUse ? "Droits insuffisants pour ce chemin, ou noms à corriger." : undefined} onPick={() => changeParent(folder.id)} onOpen={folder.childCount > 0 ? () => setAt(folder.id) : undefined} last={index === rows.length - 1}/>;
      })}</div><div><Button variant="tertiary" compact icon="x" onClick={() => setPickerOpen(false)}>Annuler le changement</Button></div>
    </div>}
    {draft.levels.map((level, index) => <TextField key={index} label={draft.levels.length > 1 ? `Niveau ${index + 1}${index ? `, dans le niveau ${index}` : ""}` : "Nom du dossier"} maxLength={120} value={level} disabled={disabled} error={normalizeCaptureLevel(level) === null ? "Indiquez un nom valide, sans séparateur de chemin." : undefined} onChange={event => onChange({ ...draft, levels: draft.levels.map((value, levelIndex) => index === levelIndex ? event.target.value : value), picks: {} })}/>)}
    <div className="hc-stack" style={{ gap: 8 }}><strong>Chemin prévu</strong><CapturePathPlan segments={segments}/><span className="hc-muted">{plan.ambiguity ? "Choisissez d’abord lequel des dossiers utiliser." : plan.allExist ? "Tout ce chemin existe déjà : aucun dossier ne sera créé." : `${plan.reused.length ? `${plan.reused.length} dossier(s) existant(s) réutilisé(s) · ` : ""}${plan.missing.length} dossier(s) à créer, seulement à l’enregistrement.`}</span></div>
    {plan.ambiguity && <RadioGroup label={`Plusieurs de vos dossiers s’appellent « ${draft.levels[plan.ambiguity.levelIndex]} ». Lequel utiliser ?`} name={choiceName} value="" disabled={disabled} options={plan.ambiguity.candidates.map(candidate => { const folder = folders.find(row => row.id === candidate.id)!; return { value: candidate.id, label: `${candidate.name} — ${folderMeta(folder)}` }; })} onChange={value => onChange({ ...draft, picks: { ...draft.picks, [plan.ambiguity!.levelIndex]: value } })}/>}
    {unavailable && <Banner tone="danger" title="Indisponible.">Ce chemin ne peut pas être utilisé avec vos accès actuels. Choisissez un autre point de départ.</Banner>}
    <span className="hc-muted">Pourquoi : {draft.reason}</span><div><Button variant="secondary" compact icon="folder-plus" disabled={disabled || !canonical || selected} onClick={() => { if (canonical) onPick(canonical); }}>{selected ? "Proposition choisie" : plan.allExist && plan.finalId ? `Choisir « ${folders.find(folder => folder.id === plan.finalId)?.name} » (existant)` : "Choisir cette proposition"}</Button></div>
  </div>;
}
