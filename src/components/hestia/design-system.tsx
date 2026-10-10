import type { CSSProperties, ReactNode, ButtonHTMLAttributes, InputHTMLAttributes } from "react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

// Technical React/TypeScript port of the validated Clé de voûte 1.0 hand-off.
export function Logo({ dark = false }: { dark?: boolean }) {
  return <span className="h-logo"><svg width="32" height="32" viewBox="0 0 48 48" fill="none" role="img" aria-label="Hestia"><path d="M9 44V24a15 15 0 0 1 9.5-13.95" stroke={dark ? "#FFFFFF" : "var(--cdv-ink)"} strokeWidth="6"/><path d="M39 44V24a15 15 0 0 0-9.5-13.95" stroke={dark ? "#FFFFFF" : "var(--cdv-ink)"} strokeWidth="6"/><path d="M20.5 4.5h7l3 9.5h-13z" fill={dark ? "#5FB3C6" : "var(--cdv-action)"}/></svg><span aria-hidden="true">Hestia</span></span>;
}
const paths: Record<string, ReactNode> = {
  // Clé de voûte 1.4 P16, validated Capture hand-off; Lucide ISC.
  "rotate-cw": <><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></>,
  crop: <><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></>,
  "file-text": <><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></>,
  lightbulb: <><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></>,
  "arrow-up": <><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></>,
  "folder-input": <><path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1"/><path d="M2 13h10"/><path d="m9 16 3-3-3-3"/></>,
  "user-plus": <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/></>,
  "user-minus": <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="22" x2="16" y1="11" y2="11"/></>,
  "arrow-right-left": <><path d="m16 3 4 4-4 4"/><path d="M20 7H4"/><path d="m8 21-4-4 4-4"/><path d="M4 17h16"/></>,
  "folder-plus": <><path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></>,
  "folder-open": <><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></>,
  "list-tree": <><path d="M21 12h-8"/><path d="M21 6H8"/><path d="M21 18h-8"/><path d="M3 6v4c0 1.1.9 2 2 2h3"/><path d="M3 10v6c0 1.1.9 2 2 2h3"/></>,
  more: <><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></>,
  ban: <><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></>,
  "arrow-down": <><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></>,
  key: <><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/></>,
  trash: <><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></>,
  "rotate-ccw": <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></>,
  clock: <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>,
  "chevron-down": <path d="m6 9 6 6 6-6"/>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
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
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/></>,
  eye: <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></>,
  camera: <><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/></>,
  share: <><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98"/><path d="m15.41 6.51-6.82 3.98"/></>,
  pencil: <><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></>,
};
export function Icon({ name, size = 20, style }: { name: string; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={size <= 16 ? 2.5 : 2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", ...style }}>{paths[name]}</svg>;
}
export function Button({ variant = "primary", icon, loading, compact, children, className = "", disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "tertiary" | "danger"; icon?: string; loading?: boolean; compact?: boolean }) {
  return <button {...props} type={props.type || "button"} className={`cdv-focus h-button h-button-${variant} ${compact ? "h-compact" : ""} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined}>{(loading || icon) && <Icon name={loading ? "loader" : icon!} size={18} style={loading ? { animation: "cdv-spin 1s linear infinite" } : undefined}/>}<span>{children}</span></button>;
}
export function TextField({ label, hint, error, id, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const generated = useId(); const fieldId = id || generated;
  return <div className="h-field"><label htmlFor={fieldId}>{label}</label>{hint && <div className="h-hint" id={`${fieldId}-hint`}>{hint}</div>}<input {...props} id={fieldId} className="cdv-focus" aria-invalid={!!error || undefined} aria-describedby={[hint && `${fieldId}-hint`, error && `${fieldId}-error`].filter(Boolean).join(" ") || undefined}/>{error && <div className="h-field-error" id={`${fieldId}-error`} role="alert"><Icon name="alert" size={18}/>{error}</div>}</div>;
}
export function Banner({ tone = "info", title, children, action, onAction }: { tone?: "info" | "danger" | "success" | "warning"; title: string; children?: ReactNode; action?: string; onAction?: () => void }) {
  return <div role={tone === "danger" || tone === "warning" ? "alert" : "status"} className={`h-banner h-banner-${tone}`} style={tone === "warning" ? {background:"var(--cdv-warning-tint)",borderColor:"var(--cdv-warning)"} : undefined}><Icon name={tone === "danger" ? "x" : tone === "success" ? "check" : tone === "warning" ? "alert" : "info"}/><div><strong>{title} </strong>{children}{action && <button type="button" className="cdv-focus" onClick={onAction} style={{marginLeft:6,border:0,background:"transparent",padding:0,color:"var(--cdv-action)",fontWeight:700,fontSize:15,textDecoration:"underline",textUnderlineOffset:3,textDecorationThickness:2,cursor:"pointer",fontFamily:"inherit"}}>{action}</button>}</div></div>;
}
export function EmptyState({ title, children, icon = "folder" }: { title: string; children: ReactNode; icon?: string }) {
  return <div className="h-empty"><Icon name={icon} size={40}/><h2>{title}</h2><p>{children}</p></div>;
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

// Additional components faithfully ported from the same validated hand-off.
export function Tabs({ items, active, onChange }: { items: {id: string; label: string}[]; active: string; onChange: (id: string) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(0, items.findIndex(item => item.id === active));
  return <div className="h-tabs" role="tablist" aria-label="Sections du dossier" onKeyDown={event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    onChange(items[index].id); refs.current[index]?.focus();
  }}>{items.map((item, index) => <button className="cdv-focus" key={item.id} ref={el => { refs.current[index] = el; }} role="tab" type="button" aria-selected={active === item.id} tabIndex={active === item.id ? 0 : -1} onClick={() => onChange(item.id)}>{item.label}</button>)}</div>;
}
export function Select({ label, hint, options, value, disabled, onChange }: { label: string; hint?: string; options: {value: string; label: string}[]; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  const id = useId();
  return <div className="h-field"><label htmlFor={id}>{label}</label>{hint && <div className="h-hint" id={`${id}-hint`}>{hint}</div>}<div className="h-select"><select id={id} className="cdv-focus" aria-describedby={hint ? `${id}-hint` : undefined} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><Icon name="chevron-down"/></div></div>;
}
export function Checkbox({ label, description, checked, disabled, onChange }: { label: string; description: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  const id = useId();
  return <label className="h-checkbox"><input type="checkbox" aria-label={label} checked={checked} disabled={disabled} aria-describedby={`${id}-description`} onChange={e => onChange(e.target.checked)}/><span className="h-checkbox-box" aria-hidden="true">{checked && <Icon name="check" size={16}/>}</span><span>{label}<span className="h-hint" id={`${id}-description`}>{description}</span></span></label>;
}
// Controlled technical ports of the validated DS 1.0 forms, reused by Capture 1.4.
export function Switch({label,description,checked,disabled,onChange}:{label:string;description:string;checked:boolean;disabled?:boolean;onChange:(value:boolean)=>void}) {
  return <label style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,minHeight:44,cursor:disabled?"not-allowed":"pointer",fontFamily:"var(--cdv-font-text)",fontSize:16,color:disabled?"var(--cdv-ink-3)":"var(--cdv-ink)"}}><span style={{display:"flex",flexDirection:"column"}}>{label}<span style={{fontSize:14,color:"var(--cdv-ink-3)"}}>{description}</span></span><button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className="cdv-focus" onClick={()=>onChange(!checked)} style={{width:52,height:30,borderRadius:15,position:"relative",flex:"none",cursor:disabled?"not-allowed":"pointer",padding:0,boxSizing:"border-box",background:disabled?"var(--cdv-surface-disabled)":checked?"var(--cdv-action)":"var(--cdv-surface)",border:disabled?"2px dashed var(--cdv-border-strong)":checked?"2px solid var(--cdv-action)":"2px solid var(--cdv-ink-3)",transition:"background var(--cdv-duration) var(--cdv-ease)"}}><span aria-hidden="true" style={{position:"absolute",top:1,left:checked?23:1,width:24,height:24,borderRadius:"50%",background:disabled?"var(--cdv-border-strong)":checked?"var(--cdv-on-action)":"var(--cdv-ink-3)",display:"flex",alignItems:"center",justifyContent:"center",transition:"left var(--cdv-duration) var(--cdv-ease)"}}><Icon name={checked?"check":"x"} size={14} style={{color:checked?"var(--cdv-action)":"var(--cdv-surface)"}}/></span></button></label>;
}
export function RadioGroup({label,name,options,value,disabled,onChange}:{label:string;name:string;options:{value:string;label:string}[];value:string;disabled?:boolean;onChange:(value:string)=>void}) {
  return <fieldset style={{border:0,padding:0,margin:0,display:"flex",flexDirection:"column",gap:0,fontFamily:"var(--cdv-font-text)"}}><legend style={{fontSize:16,fontWeight:700,marginBottom:6,color:"var(--cdv-ink)"}}>{label}</legend>{options.map(option=><label key={option.value} style={{display:"flex",alignItems:"center",gap:12,minHeight:44,cursor:disabled?"not-allowed":"pointer",color:disabled?"var(--cdv-ink-3)":"var(--cdv-ink)",fontSize:16,position:"relative"}}><input type="radio" className="cdv-focus" name={name} value={option.value} checked={value===option.value} disabled={disabled} onChange={()=>onChange(option.value)} style={{width:24,height:24,margin:0,accentColor:"var(--cdv-action)"}}/><span>{option.label}</span></label>)}</fieldset>;
}
export function Dialog({ title, children, confirmLabel, confirmIcon, confirmVariant = "primary", cancelLabel = "Annuler", busy, onConfirm, onCancel }: { title: string; children: ReactNode; confirmLabel: string; confirmIcon?: string; confirmVariant?: "primary" | "danger"; cancelLabel?: string; busy?: boolean; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null); const id = useId();
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); dialog?.querySelector<HTMLButtonElement>("button")?.focus(); return () => dialog?.close(); }, []);
  // Mobile detail panels hide the main ancestor. A body portal keeps the native
  // modal visible and focusable regardless of which responsive pane is active.
  return typeof document === "undefined" ? null : createPortal(<dialog ref={ref} className="cdv-root h-dialog" aria-labelledby={id} onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}><div className="h-dialog-content"><h2 id={id}>{title}</h2><div className="h-dialog-body">{children}</div><div className="h-actions"><Button variant="tertiary" disabled={busy} onClick={onCancel}>{cancelLabel}</Button><Button variant={confirmVariant} className="h-dialog-confirm" icon={confirmIcon} loading={busy} onClick={onConfirm}>{confirmLabel}</Button></div></div></dialog>, document.body);
}
export function Toast({ children, action, onAction }: { children: ReactNode; action?: string; onAction?: () => void }) {
  return <div className="h-toast-host"><div className="h-toast" role="status"><Icon name="check"/><div>{children}</div>{action && <button type="button" className="cdv-focus" onClick={onAction}>{action}</button>}</div></div>;
}
