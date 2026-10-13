import type { CaptureDto, CapturePreviewVariant } from "../../shared/capture-contract";
import { captureBlob, CaptureError } from "./capture-client";

export type CapturePreviewKey = { userId: string; epoch: number; captureId: string; pageId: string; pageVersion: number; variant: CapturePreviewVariant };
type Invalidated = "purged" | "expired" | "evicted" | "changed";
type Consumer = { active: boolean; notify: (reason: Invalidated) => void };
type Entry = { key: CapturePreviewKey; id: string; generation: number; controller: AbortController; promise: Promise<Blob>; consumers: Set<Consumer>; blob?: Blob; url?: string; timer?: ReturnType<typeof setTimeout> };
type Loader = (key: CapturePreviewKey, signal: AbortSignal) => Promise<Blob>;
const aborted = () => new DOMException("Preview no longer available", "AbortError");

export function createCapturePreviewCache(load: Loader, options: { maxBytes?: number; maxEntries?: number; ttlMs?: number; createUrl?: (blob: Blob) => string; revokeUrl?: (url: string) => void } = {}) {
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024, maxEntries = options.maxEntries ?? 32, ttlMs = options.ttlMs ?? 60_000;
  const createUrl = options.createUrl ?? (blob => URL.createObjectURL(blob)), revokeUrl = options.revokeUrl ?? (url => URL.revokeObjectURL(url));
  const entries = new Map<string, Entry>();
  let generation = 0, bytes = 0, scope: { userId: string; epoch: number } | null = null;
  const admitted = (key: Pick<CapturePreviewKey, "userId" | "epoch">) => !!scope && scope.userId === key.userId && scope.epoch === key.epoch;
  const live = (entry: Entry) => admitted(entry.key) && entry.generation === generation && entries.get(entry.id) === entry && !entry.controller.signal.aborted;
  function drop(entry: Entry, reason: Invalidated) {
    if (entries.get(entry.id) !== entry) return;
    entries.delete(entry.id); clearTimeout(entry.timer); entry.controller.abort();
    if (entry.blob) bytes -= entry.blob.size;
    entry.blob = undefined;
    entry.promise = Promise.resolve(new Blob());
    if (entry.url) revokeUrl(entry.url);
    entry.url = undefined;
    for (const consumer of entry.consumers) { consumer.active = false; consumer.notify(reason); }
    entry.consumers.clear();
  }
  function clear() {
    generation++;
    for (const entry of [...entries.values()]) drop(entry, "purged");
  }
  function invalidateCapture(captureId: string) {
    for (const entry of [...entries.values()]) if (entry.key.captureId === captureId) drop(entry, "changed");
  }
  function revoke() { scope = null; clear(); }
  return {
    admit(userId: string, epoch: number) {
      if (!admitted({ userId, epoch })) { revoke(); scope = { userId, epoch }; }
    },
    admitted,
    clear,
    revoke,
    invalidateCapture,
    reconcile(userId: string, epoch: number, capture: CaptureDto) {
      for (const entry of [...entries.values()]) {
        if (entry.key.userId !== userId || entry.key.epoch !== epoch || entry.key.captureId !== capture.id) continue;
        if (capture.state !== "open" || !capture.pages.some(page => page.id === entry.key.pageId && page.version === entry.key.pageVersion)) drop(entry, "changed");
      }
    },
    acquire(key: CapturePreviewKey, notify: Consumer["notify"]) {
      if (!admitted(key)) throw aborted();
      const id = JSON.stringify([key.userId, key.epoch, key.captureId, key.pageId, key.pageVersion, key.variant, "capture-preview-v1"]);
      let entry = entries.get(id);
      if (!entry) {
        while (entries.size >= maxEntries) drop(entries.values().next().value!, "evicted");
        entry = { key: { ...key }, id, generation, controller: new AbortController(), consumers: new Set(), promise: Promise.resolve(new Blob()) };
        const created = entry;
        entries.set(id, created);
        created.promise = Promise.resolve().then(() => {
          if (!live(created)) throw aborted();
          return load(created.key, created.controller.signal);
        }).then(blob => {
          if (!live(created)) throw aborted();
          if (!blob.size || blob.size > maxBytes) { drop(created, "evicted"); throw new Error("Preview memory budget exceeded"); }
          // The budget includes displayed images. If necessary, revoke their
          // consumers too; an active lease cannot pin unbounded Blob memory.
          while (bytes + blob.size > maxBytes) {
            const victim = [...entries.values()].find(candidate => candidate !== created && candidate.blob);
            if (!victim) break;
            drop(victim, "evicted");
          }
          if (!live(created)) throw aborted();
          created.blob = blob; bytes += blob.size;
          created.timer = setTimeout(() => drop(created, "expired"), ttlMs);
          return blob;
        }).catch(error => {
          if (live(created) && error instanceof CaptureError && [401, 403].includes(error.status)) revoke();
          else if (live(created) && error instanceof CaptureError && [404, 409, 410].includes(error.status)) invalidateCapture(created.key.captureId);
          else drop(created, "changed");
          throw error;
        });
        // A released last consumer can leave a deliberately aborted load. The
        // lease promises retain their errors; the shared load has an observer.
        void created.promise.catch(() => {});
      } else { entries.delete(id); entries.set(id, entry); }
      const selected = entry, consumer: Consumer = { active: true, notify };
      selected.consumers.add(consumer);
      const ready = selected.promise.then(blob => {
        if (!consumer.active || !live(selected)) throw aborted();
        selected.url ??= createUrl(blob);
        return selected.url;
      });
      return {
        ready,
        current: () => consumer.active && live(selected),
        release() {
          if (!consumer.active) return;
          consumer.active = false; selected.consumers.delete(consumer);
          if (!selected.consumers.size) {
            if (!selected.blob) drop(selected, "purged");
            else if (selected.url) { revokeUrl(selected.url); selected.url = undefined; }
          }
        },
      };
    },
    // Only aggregate technical counters, useful for deterministic budget tests.
    size: () => ({ entries: entries.size, bytes, leases: [...entries.values()].reduce((sum, entry) => sum + entry.consumers.size, 0) }),
  };
}

export const capturePreviews = createCapturePreviewCache((key, signal) => captureBlob(key.captureId, { pageId: key.pageId, pageVersion: key.pageVersion, variant: key.variant }, signal));
