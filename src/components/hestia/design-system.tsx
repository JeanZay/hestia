import type { CSSProperties, ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from "react";
import { useId } from "react";

// Technical React/TypeScript port of the validated Clé de voûte 1.0 hand-off.
export function Logo({ dark = false }: { dark?: boolean }) {
  return <span className="h-logo"><svg width="32" height="32" viewBox="0 0 48 48" fill="none" role="img" aria-label="Hestia"><path d="M9 44V24a15 15 0 0 1 9.5-13.95" stroke={dark ? "#FFFFFF" : "var(--cdv-ink)"} strokeWidth="6"/><path d="M39 44V24a15 15 0 0 0-9.5-13.95" stroke={dark ? "#FFFFFF" : "var(--cdv-ink)"} strokeWidth="6"/><path d="M20.5 4.5h7l3 9.5h-13z" fill={dark ? "#5FB3C6" : "var(--cdv-action)"}/></svg><span aria-hidden="true">Hestia</span></span>;
}
const paths: Record<string, ReactNode> = {
  user: <><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
  search: <><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></>,
  folder: <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>,
  plus: <><path d="M5 12h14"/><path d="M12 5v14"/></>,
  lock: <><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>,
  home: <><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></>,
  check: <path d="M20 6 9 17l-5-5"/>, x: <><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>,
  info: <><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></>,
  alert: <><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></>,
  loader: <path d="M21 12a9 9 0 1 1-6.2-8.56"/>,
  "chevron-right": <path d="m9 18 6-6-6-6"/>,
  "chevron-left": <path d="m15 18-6-6 6-6"/>,
  "log-out": <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/></>,
  upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></>,
  camera: <><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></>,
  share: <><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98"/><path d="m15.41 6.51-6.82 3.98"/></>,
  pencil: <><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></>,
};
export function Icon({ name, size = 20, style }: { name: string; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={size <= 16 ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", ...style }}>{paths[name]}</svg>;
}
export function Button({ variant = "primary", icon, loading, compact, children, className = "", disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "tertiary"; icon?: string; loading?: boolean; compact?: boolean }) {
  return <button {...props} type={props.type || "button"} className={`cdv-focus h-button h-button-${variant} ${compact ? "h-compact" : ""} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined}>{(loading || icon) && <Icon name={loading ? "loader" : icon!} size={18} style={loading ? { animation: "cdv-spin 1s linear infinite" } : undefined}/>}<span>{children}</span></button>;
}
export function TextField({ label, hint, error, id, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const generated = useId(); const fieldId = id || generated;
  return <div className="h-field"><label htmlFor={fieldId}>{label}</label>{hint && <div className="h-hint" id={`${fieldId}-hint`}>{hint}</div>}<input {...props} id={fieldId} className="cdv-focus" aria-invalid={!!error || undefined} aria-describedby={[hint && `${fieldId}-hint`, error && `${fieldId}-error`].filter(Boolean).join(" ") || undefined}/>{error && <div className="h-field-error" id={`${fieldId}-error`} role="alert"><Icon name="alert" size={18}/>{error}</div>}</div>;
}
export function Banner({ tone = "info", title, children }: { tone?: "info" | "danger" | "success"; title: string; children?: ReactNode }) {
  return <div role={tone === "danger" ? "alert" : "status"} className={`h-banner h-banner-${tone}`}><Icon name={tone === "danger" ? "x" : tone === "success" ? "check" : "info"}/><div><strong>{title} </strong>{children}</div></div>;
}
export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return <div className="h-empty"><Icon name="folder" size={40}/><h2>{title}</h2><p>{children}</p></div>;
}
export function ScopeBadge() { return <span className="h-scope"><Icon name="lock" size={14}/>Personnel</span>; }
export function PageHeader({ title, summary, overline }: { title: string; summary: string; overline?: string }) {
  return <div className="h-page-heading">{overline && <div className="h-overline">{overline}</div>}<h1>{title}</h1><p>{summary}</p></div>;
}
export function Avatar({ name }: { name: string }) {
  let hash = 0; for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return <span className="h-avatar" role="img" aria-label={name} style={{ background: hash % 2 ? "var(--cdv-info)" : "var(--cdv-action)" }}>{name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("")}</span>;
}

export function Breadcrumb({ folderName, onFolders }: { folderName: string; onFolders: () => void }) {
  return <nav className="h-breadcrumb" aria-label="Fil d'Ariane"><ol><li><a href="#" className="cdv-focus" onClick={event => { event.preventDefault(); onFolders(); }}>Dossiers</a><Icon name="chevron-right" size={14}/></li><li><span aria-current="page">{folderName}</span></li></ol></nav>;
}
export function Skeleton({ rows = 5, label = "Chargement en cours" }: { rows?: number; label?: string }) {
  return <div role="status" aria-label={label} aria-busy="true" className="h-skeleton">{Array.from({ length: rows }, (_, i) => <div key={i} aria-hidden="true" className="h-skeleton-row"><span className="h-skeleton-thumb"/><div><span style={{ height: 14, width: (60 - i * 10) + "%" }}/><span style={{ height: 12, width: (40 - i * 5) + "%" }}/></div></div>)}</div>;
}
