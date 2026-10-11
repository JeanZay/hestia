import type { CaptureDestination, CapturePreviewDto } from "../../shared/capture-contract";
import { resolveCapturePath } from "../../shared/capture-path";
import { HttpError, invalid, unavailable } from "../access";
import { conflict } from "./model";

export type DestinationFolder = { id: string; name: string; parent_folder_id: string | null; version: number };
export function planCaptureDestination(destination: CaptureDestination, rows: readonly DestinationFolder[], capabilitiesFor: (id: string) => readonly string[]) {
  if (rows.length > 10000) throw new HttpError(503, "RESOURCE_LIMIT", "Trop de dossiers pour cette opération.");
  const byId = new Map(rows.map(row => [row.id, row]));
  const capabilities = new Map(rows.map(row => [row.id, capabilitiesFor(row.id)]));
  let baseId: string | null, missing: string[];
  if (destination.kind === "existing") {
    baseId = destination.folderId; missing = [];
    const caps = capabilities.get(baseId);
    if (!caps?.includes("consulter") || !caps.includes("déposer")) throw unavailable();
  } else {
    const visible = rows.filter(row => capabilities.get(row.id)!.includes("consulter"));
    const visibleIds = new Set(visible.map(row => row.id));
    const resolution = resolveCapturePath(visible.map(row => ({ id: row.id, name: row.name, visibleParentId: row.parent_folder_id && visibleIds.has(row.parent_folder_id) ? row.parent_folder_id : null, capabilities: capabilities.get(row.id)! })), destination.parentId, destination.levels);
    if (resolution.status === "ambiguous") throw conflict("AMBIGUOUS_PATH", "Précisez le dossier à utiliser avant de confirmer.");
    if (resolution.status === "unavailable") throw unavailable();
    if (resolution.status !== "ready") throw invalid();
    baseId = resolution.baseId; missing = resolution.missing;
  }
  if (rows.length + missing.length > 10000) throw new HttpError(503, "RESOURCE_LIMIT", "Trop de dossiers pour cette opération.");
  const path: CapturePreviewDto["path"] = [], identity: { id: string; version: number; parentId: string | null; name: string }[] = [];
  let current = baseId ? byId.get(baseId) : undefined, visibleChain = true;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current.id)) throw invalid(); seen.add(current.id);
    identity.unshift({ id: current.id, version: current.version, parentId: current.parent_folder_id, name: current.name });
    visibleChain = visibleChain && capabilities.get(current.id)!.includes("consulter");
    if (visibleChain) path.unshift({ id: current.id, name: current.name, isNew: false });
    current = current.parent_folder_id ? byId.get(current.parent_folder_id) : undefined;
  }
  path.push(...missing.map(name => ({ name, isNew: true })));
  return { baseId, missing, path, identity, allExist: missing.length === 0 };
}
