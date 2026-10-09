"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Avatar, Button, Icon } from "./design-system";
import "./family.css";

// Technical port of Clé de voûte 1.2 P5–P8, family-access v4 hand-off.
export class FamilyRequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function familyRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, { method, cache: "no-store", credentials: "same-origin", headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new FamilyRequestError(response.status, data?.error?.message || "L’action n’a pas pu aboutir. Réessayez.");
  return data as T;
}
export const familyError = (error: unknown) => error instanceof Error ? error.message : "Impossible de joindre Hestia.";
export const familyUncertain = (error: unknown) => !(error instanceof FamilyRequestError) || error.status >= 500;
export const roleLabel = (role: string) => role === "owner" ? "Propriétaire" : role === "admin" ? "Administrateur" : "Membre";
export function StatusPill({ children, dashed = false, icon }: { children: ReactNode; dashed?: boolean; icon?: string }) {
  return <span className={`hf-status ${dashed ? "hf-dashed" : ""}`}><Icon name={icon ?? (dashed ? "clock" : "check")} size={14}/><span>{children}</span></span>;
}
export function PersonRow({ name, sub, status, selected, onClick }: { name: string; sub: string; status: string; selected?: boolean; onClick: () => void }) {
  return <button className="cdv-focus hf-person" aria-current={selected || undefined} onClick={onClick}><Avatar name={name}/><span className="hf-person-text"><strong>{name}</strong><span>{sub}</span><span className="hf-mobile-status"><StatusPill>{status}</StatusPill></span></span><span className="hf-desktop-status"><StatusPill>{status}</StatusPill></span><Icon name="chevron-right"/></button>;
}
export function RecoveryCodes({ codes }: { codes: string[] }) {
  return <div className="hf-codes"><ol aria-label="Codes de secours">{codes.map((code, index) => <li key={index}><span>{index + 1}.</span><code>{code}</code></li>)}</ol></div>;
}
export function StepHeader({ step, total, label }: { step: number; total: number; label: string }) {
  return <div className="hf-step"><span>Étape {step} sur {total} · {label}</span><progress aria-label={`Étape ${step} sur ${total}`} value={step} max={total}/></div>;
}
export function FamilyPanel({ title, children, onClose, busy }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { const prior = document.activeElement as HTMLElement | null; ref.current?.focus(); return () => prior?.focus(); }, []);
  return <aside ref={ref} tabIndex={-1} className="hf-panel" aria-label={title} onKeyDown={event => { if (event.key === "Escape" && !busy) onClose(); }}><Button variant="tertiary" compact icon="x" disabled={busy} onClick={onClose}>Fermer</Button>{children}</aside>;
}
