import { invalid, isUuid, textField } from "../access";
import type { ClassificationResultDto } from "../../shared/capture-contract";
import type { AuthorizedFolder } from "./types";

export function micros(value: unknown, positive = false): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (positive ? 1 : 0) || value > 1_000_000_000_000) throw invalid();
  return value;
}
export function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw invalid();
  return value;
}
export function utcMonth(now: Date) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString(), timeZone: "UTC" as const };
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw invalid();
  return value as Record<string, unknown>;
}
function plain(value: unknown, maximum: number) {
  const text = textField(value, maximum);
  if (/[<>\u202a-\u202e\u2066-\u2069]/u.test(text)) throw invalid();
  return text;
}
/** Hostile model output has no tool channel and cannot carry arbitrary extra fields. */
export function parseClassificationResult(value: unknown, folders: readonly AuthorizedFolder[], maxBytes: number, maximum: number): ClassificationResultDto {
  const encoded = typeof value === "string" ? value : JSON.stringify(value);
  if (!encoded || Buffer.byteLength(encoded) > maxBytes) throw invalid();
  const root = record(JSON.parse(encoded), ["existing", "created", "summary"]);
  if (!Array.isArray(root.existing) || !Array.isArray(root.created) || root.existing.length + root.created.length > maximum) throw invalid();
  const allowed = new Map(folders.map(folder => [folder.id, folder]));
  const seen = new Set<string>();
  const existing = root.existing.map(item => {
    const row = record(item, ["folderId", "reason"]);
    if (!isUuid(row.folderId)) throw invalid();
    return { folderId: row.folderId, reason: plain(row.reason, 500) };
  }).filter(item => {
    if (!allowed.has(item.folderId) || seen.has(item.folderId)) return false;
    seen.add(item.folderId); return true;
  });
  const created = root.created.map(item => {
    const row = record(item, ["parentId", "levels", "reason"]);
    if (!isUuid(row.parentId) || !Array.isArray(row.levels) || row.levels.length < 1 || row.levels.length > 4) throw invalid();
    const levels = row.levels.map(level => {
      const name = plain(level, 120).normalize("NFC");
      if (name === "." || name === ".." || /[/\\]/u.test(name)) throw invalid();
      return name;
    });
    return { parentId: row.parentId, levels, reason: plain(row.reason, 500) };
  }).filter(item => allowed.get(item.parentId)?.canCreate);
  return { existing, created, ...(root.summary === undefined ? {} : { summary: plain(root.summary, 1000) }) };
}
