import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceReader, coalesceWorkspaceRefresh } from "../../src/components/hestia/workspace-client";

function deferred<T>() { let resolve!: (value:T)=>void; let reject!: (error:unknown)=>void; const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject}; }
afterEach(()=>vi.useRealTimers());

describe("workspace reads",()=>{
  it("aborts the older fetch and ignores its success even when the transport ignores abort",async()=>{
    const reader=new WorkspaceReader(),old=deferred<string>(),fresh=deferred<string>();
    let signal!:AbortSignal;
    const first=reader.read(current=>{signal=current;return old.promise;});
    const next=reader.read(()=>fresh.promise);
    expect(signal.aborted).toBe(true);fresh.resolve("current");expect(await next).toBe("current");
    old.resolve("deleted document");expect(await first).toBeUndefined();
  });
  it("does not lose a confirmation which invalidates a read already in flight",async()=>{
    const reader=new WorkspaceReader(),before=deferred<string>(),between=deferred<string>();
    const initial=reader.read(()=>before.promise);reader.invalidate(); // mutation engaged
    const firstConfirmation=reader.read(()=>between.promise);
    reader.invalidate(); // another mutation confirms before that read finishes
    const latest=reader.read(async()=>"both writes are present");
    between.resolve("first write only");before.resolve("before writes");
    expect(await latest).toBe("both writes are present");
    expect(await firstConfirmation).toBeUndefined();expect(await initial).toBeUndefined();
  });
  it("clearing private state prevents late data and errors from reappearing",async()=>{
    const reader=new WorkspaceReader(),data=deferred<string>(),error=deferred<string>();
    const a=reader.read(()=>data.promise);reader.invalidate();data.resolve("private");expect(await a).toBeUndefined();
    const b=reader.read(()=>error.promise);reader.invalidate();error.reject(new Error("old failure"));expect(await b).toBeUndefined();
  });
  it("surfaces a current refresh failure without replaying a mutation",async()=>{
    const reader=new WorkspaceReader();const read=vi.fn().mockRejectedValue(new Error("503"));
    await expect(reader.read(read)).rejects.toThrow("503");expect(read).toHaveBeenCalledTimes(1);expect(reader.pending).toBe(false);
  });
  it("allows the consumer to guard the microtask gap before publishing",async()=>{
    const reader=new WorkspaceReader();const pending=reader.read(async()=>"old");const revision=reader.revision;
    const value=await pending;reader.invalidate();expect(value).toBe("old");expect(reader.revision).not.toBe(revision);
  });
  it("coalesces a foreground burst and cancels a queued refresh on hiding",async()=>{
    vi.useFakeTimers();const run=vi.fn(),foreground=coalesceWorkspaceRefresh(run);
    foreground.schedule();foreground.schedule();foreground.schedule();
    await vi.advanceTimersByTimeAsync(80);expect(run).toHaveBeenCalledTimes(1);
    foreground.schedule();foreground.cancel();await vi.advanceTimersByTimeAsync(80);expect(run).toHaveBeenCalledTimes(1);
  });
});
