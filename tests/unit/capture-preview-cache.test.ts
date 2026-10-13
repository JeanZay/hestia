import { afterEach, describe, expect, it, vi } from "vitest";
import { createCapturePreviewCache, type CapturePreviewKey } from "../../src/components/hestia/capture-preview-cache";
import { CaptureError } from "../../src/components/hestia/capture-client";
import type { CaptureDto } from "../../src/shared/capture-contract";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const key: CapturePreviewKey = { userId: "actor", epoch: 1, captureId: "capture", pageId: "page", pageVersion: 1, variant: "thumbnail" };
const pixels = (size = 3) => new Blob([new Uint8Array(size)], { type: "image/jpeg" });
const caches: ReturnType<typeof createCapturePreviewCache>[] = [];
function setup(loader: Parameters<typeof createCapturePreviewCache>[0] = vi.fn(async () => pixels()), options: { maxBytes?: number; maxEntries?: number; ttlMs?: number } = {}) {
  const createUrl = vi.fn(() => "blob:synthetic"), revokeUrl = vi.fn();
  const cache = createCapturePreviewCache(loader, { ...options, createUrl, revokeUrl }); caches.push(cache); cache.admit(key.userId, key.epoch);
  return { cache, createUrl, revokeUrl, loader };
}
afterEach(() => { for (const cache of caches.splice(0)) cache.revoke(); vi.useRealTimers(); });

describe("private Capture preview leases", () => {
  it("shares the request and URL, releases consumers independently and reuses bounded bytes", async () => {
    const { cache, loader, createUrl, revokeUrl } = setup(), first = cache.acquire(key, vi.fn()), second = cache.acquire(key, vi.fn());
    expect(await first.ready).toBe(await second.ready); expect(loader).toHaveBeenCalledOnce(); expect(createUrl).toHaveBeenCalledOnce();
    first.release(); expect(second.current()).toBe(true); expect(revokeUrl).not.toHaveBeenCalled();
    second.release(); expect(revokeUrl).toHaveBeenCalledOnce(); expect(cache.size()).toEqual({ entries: 1, bytes: 3, leases: 0 });
    const again = cache.acquire(key, vi.fn()); await again.ready; expect(loader).toHaveBeenCalledOnce(); expect(createUrl).toHaveBeenCalledTimes(2); again.release();
  });
  it("cancels a request only after the last lease, and never publishes its late response", async () => {
    const response = deferred<Blob>(), loader = vi.fn((request: CapturePreviewKey, signal: AbortSignal) => { void request; void signal; return response.promise; });
    const { cache, createUrl } = setup(loader), first = cache.acquire(key, vi.fn()), second = cache.acquire(key, vi.fn());
    const checks = [expect(first.ready).rejects.toMatchObject({ name: "AbortError" }), expect(second.ready).rejects.toMatchObject({ name: "AbortError" })];
    await Promise.resolve(); first.release(); expect(loader.mock.calls[0][1].aborted).toBe(false);
    second.release(); expect(loader.mock.calls[0][1].aborted).toBe(true);
    response.resolve(pixels()); await Promise.all(checks); expect(createUrl).not.toHaveBeenCalled(); expect(cache.size().bytes).toBe(0);
  });
  it("purges visible consumers and rejects late bytes after hidden/logout/actor change", async () => {
    const response = deferred<Blob>(), loader = vi.fn(async (request: CapturePreviewKey) => request.pageId === "held" ? response.promise : pixels());
    const { cache, revokeUrl, createUrl } = setup(loader), notify = vi.fn(), first = cache.acquire(key, notify);
    await first.ready;
    const held = cache.acquire({ ...key, pageId: "held" }, notify), rejected = expect(held.ready).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve(); cache.revoke();
    expect(notify).toHaveBeenCalledTimes(2); expect(revokeUrl).toHaveBeenCalledOnce(); expect(first.current()).toBe(false);
    expect(() => cache.acquire(key, vi.fn())).toThrow();
    cache.admit("new-actor", 2); response.resolve(pixels()); await rejected;
    expect(createUrl).toHaveBeenCalledOnce(); expect(cache.size()).toEqual({ entries: 0, bytes: 0, leases: 0 });
    expect(() => cache.acquire(key, vi.fn())).toThrow();
  });
  it("separates variants and page versions, invalidating removed or changed pages", async () => {
    const { cache, loader } = setup();
    const thumbnail = cache.acquire(key, vi.fn()), settings = cache.acquire({ ...key, variant: "settings" }, vi.fn());
    await Promise.all([thumbnail.ready, settings.ready]); expect(loader).toHaveBeenCalledTimes(2);
    const capture = { id: key.captureId, state: "open", pages: [{ id: key.pageId, version: 2 }] } as CaptureDto;
    cache.reconcile(key.userId, key.epoch, capture); expect(thumbnail.current()).toBe(false); expect(settings.current()).toBe(false);
    const updated = cache.acquire({ ...key, pageVersion: 2 }, vi.fn()); await updated.ready; expect(loader).toHaveBeenCalledTimes(3);
    cache.reconcile(key.userId, key.epoch, { ...capture, pages: [] }); expect(updated.current()).toBe(false);
  });
  it("counts pinned bytes and revokes displayed entries when enforcing the budget", async () => {
    const { cache, revokeUrl } = setup(undefined, { maxBytes: 5, maxEntries: 2 });
    const invalidated = vi.fn(), first = cache.acquire(key, invalidated); await first.ready;
    const next = cache.acquire({ ...key, pageId: "next" }, vi.fn()); await next.ready;
    expect(first.current()).toBe(false); expect(invalidated).toHaveBeenCalledWith("evicted"); expect(revokeUrl).toHaveBeenCalledOnce();
    expect(cache.size()).toEqual({ entries: 1, bytes: 3, leases: 1 });
  });
  it("bounds pending entries and refuses an individually oversized blob without retaining it", async () => {
    const response = deferred<Blob>(), loader = vi.fn(() => response.promise), { cache, createUrl } = setup(loader, { maxEntries: 1, maxBytes: 4 });
    const first = cache.acquire(key, vi.fn()), rejected = expect(first.ready).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve(); const second = cache.acquire({ ...key, pageId: "next" }, vi.fn()), tooLarge = expect(second.ready).rejects.toThrow("budget");
    response.resolve(pixels(5)); await Promise.all([rejected, tooLarge]); expect(createUrl).not.toHaveBeenCalled(); expect(cache.size().entries).toBe(0);
  });
  it("expires referenced entries and keeps the privacy scope available for a passive revalidation", async () => {
    vi.useFakeTimers(); const { cache, revokeUrl } = setup(undefined, { ttlMs: 50 }), notify = vi.fn(), lease = cache.acquire(key, notify);
    await lease.ready; await vi.advanceTimersByTimeAsync(50);
    expect(notify).toHaveBeenCalledWith("expired"); expect(revokeUrl).toHaveBeenCalledOnce(); expect(lease.current()).toBe(false); expect(cache.admitted(key)).toBe(true);
  });
  it.each([401, 403])("revokes the shared privacy scope after observed access failure %i", async status => {
    const loader = vi.fn(async (request: CapturePreviewKey) => { if (request.pageId === "denied") throw new CaptureError(status, "UNAVAILABLE", "Denied"); return pixels(); });
    const { cache } = setup(loader), existing = cache.acquire(key, vi.fn()); await existing.ready;
    const denied = cache.acquire({ ...key, pageId: "denied" }, vi.fn()); await expect(denied.ready).rejects.toMatchObject({ status });
    expect(existing.current()).toBe(false); expect(cache.admitted(key)).toBe(false); expect(cache.size().bytes).toBe(0);
  });
  it.each([404,409,410])("invalidates every preview of an unavailable, stale or expired capture (%i)",async status=>{
    const loader=vi.fn(async(request:CapturePreviewKey)=>{if(request.pageId==="gone")throw new CaptureError(status,"UNAVAILABLE","Unavailable");return pixels();});
    const {cache}=setup(loader),existing=cache.acquire(key,vi.fn());await existing.ready;
    const gone=cache.acquire({...key,pageId:"gone"},vi.fn());await expect(gone.ready).rejects.toMatchObject({status});
    expect(existing.current()).toBe(false);expect(cache.size().bytes).toBe(0);expect(cache.admitted(key)).toBe(true);
  });
});
