import { Icon } from "./design-system";

export type CapturePathSegment = { name: string; status: "root" | "start" | "reused" | "new" | "pending" | "ambiguous" | "doc"; tag?: string; meta?: string };
const kinds = {
  root: { icon: "lock", tag: "Racine de votre espace · privé" },
  start: { icon: "folder", tag: "Point de départ" },
  reused: { icon: "folder", tag: "Existant · réutilisé" },
  new: { icon: "folder-plus", tag: "Nouveau · créé à l’enregistrement" },
  pending: { icon: "folder", tag: "À déterminer" },
  ambiguous: { icon: "alert", tag: "Plusieurs dossiers portent ce nom : choisissez" },
  doc: { icon: "file-text", tag: "Ce document" },
};

// Technical port of Claude Design Clé de voûte 1.5, P19 PathPlan.
export function CapturePathPlan({ segments, label = "Chemin prévu" }: { segments: CapturePathSegment[]; label?: string }) {
  return <ol className="hc-path-plan" aria-label={label}>{segments.map((segment, index) => {
    const kind = kinds[segment.status];
    return <li key={index} data-status={segment.status}>
      <span className="hc-path-axis" aria-hidden="true"><span className="hc-path-icon"><Icon name={kind.icon} size={16}/></span>{index < segments.length - 1 && <span className="hc-path-line"/>}</span>
      <span className="hc-path-content"><span className="hc-path-name">{segment.name || (segment.status === "root" ? "Tous vos dossiers" : "(nom à indiquer)")}</span><span className="hc-path-tag">{segment.tag || kind.tag}{segment.meta && ` · ${segment.meta}`}</span></span>
    </li>;
  })}</ol>;
}
