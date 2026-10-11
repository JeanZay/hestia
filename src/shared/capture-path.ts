/** Pure resolution over the caller's authorized projection; never an access check. */
export const CAPTURE_PATH_MAX_LEVELS = 20;
export type CapturePathFolder = { id: string; name: string; visibleParentId: string | null; capabilities: readonly string[] };
export type CapturePathResolution = {
  status: "ready" | "ambiguous" | "unavailable" | "invalid" | "resource-limit";
  reused: { id: string; name: string }[]; missing: string[];
  baseId: string | null; finalId: string | null; allExist: boolean;
  ambiguity: { levelIndex: number; candidates: { id: string; name: string }[] } | null;
};
export function normalizeCaptureLevel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().normalize("NFC");
  return !name || [...name].length > 120 || name === "." || name === ".." || /[/\\<>\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(name) ? null : name;
}
const key = (name: string) => name.trim().normalize("NFC").toLowerCase();
export function resolveCapturePath(rows: readonly CapturePathFolder[], parentId: string | null, levels: readonly string[], picks: Readonly<Record<number, string>> = {}): CapturePathResolution {
  const result: CapturePathResolution = { status: "invalid", reused: [], missing: [], baseId: parentId, finalId: null, allExist: false, ambiguity: null };
  if (rows.length > 10000) return { ...result, status: "resource-limit" };
  if (!levels.length || levels.length > CAPTURE_PATH_MAX_LEVELS) return result;
  const normalized = levels.map(normalizeCaptureLevel);
  if (normalized.some(name => name === null)) return result;
  const visible = rows.filter(row => row.capabilities.includes("consulter"));
  const byId = new Map(visible.map(row => [row.id, row]));
  if (byId.size !== visible.length) return result;
  if (parentId !== null && !byId.has(parentId)) return { ...result, status: "unavailable" };
  const children = new Map<string | null, Map<string, CapturePathFolder[]>>();
  for (const row of visible) {
    const siblings = children.get(row.visibleParentId) ?? new Map<string, CapturePathFolder[]>();
    const names = siblings.get(key(row.name)) ?? []; names.push(row); siblings.set(key(row.name), names); children.set(row.visibleParentId, siblings);
  }
  const visited = new Set(parentId === null ? [] : [parentId]);
  for (let index = 0; index < normalized.length; index++) {
    const name = normalized[index]!;
    const candidates = children.get(result.baseId)?.get(key(name)) ?? [];
    if (!candidates.length) { result.missing = normalized.slice(index) as string[]; break; }
    const selected = candidates.length === 1 ? candidates[0] : candidates.find(row => row.id === picks[index]);
    if (!selected) return { ...result, status: "ambiguous", ambiguity: { levelIndex: index, candidates: candidates.map(({ id, name }) => ({ id, name })).sort((a, b) => a.id.localeCompare(b.id)) } };
    if (visited.has(selected.id)) return result;
    visited.add(selected.id); result.reused.push({ id: selected.id, name: selected.name }); result.baseId = selected.id;
  }
  result.allExist = result.missing.length === 0;
  result.finalId = result.allExist ? result.baseId : null;
  if (result.baseId !== null) {
    const capabilities = byId.get(result.baseId)!.capabilities;
    if (!capabilities.includes("déposer") || (!result.allExist && !capabilities.includes("modifier"))) return { ...result, status: "unavailable" };
  }
  return { ...result, status: "ready" };
}
