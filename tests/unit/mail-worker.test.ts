import { describe, expect, it, vi } from "vitest";
import { handleMailWorker, runMailBatch, withMailTrigger } from "../../src/server/identity/worker";

const secret = "synthetic-internal-worker-secret-0000";
const request = (method = "POST", token?: string) => new Request("https://hestia.example.invalid/api/hestia/mail-worker",
  { method, headers: token ? { authorization: `Bearer ${token}` } : {} });
describe("mail triggering and worker", () => {
  it("limits work to four messages and stops when empty/unconfigured", async () => {
    const dispatch = vi.fn(async () => ({ state: "sent" }));
    expect(await runMailBatch(dispatch)).toEqual({ sent: 4, failed: 0, cancelled: 0, available: true });
    expect(dispatch).toHaveBeenCalledTimes(4);
    expect(await runMailBatch(async () => ({ state: "idle" }))).toMatchObject({ sent: 0, available: true });
    expect(await runMailBatch(async () => ({ state: "transport-unavailable" }))).toMatchObject({ sent: 0, available: false });
  });
  it("checks method and dedicated authentication before runtime access", async () => {
    const work = vi.fn(async () => ({ sent: 1, failed: 0, cancelled: 0, available: true }));
    expect((await handleMailWorker(request("GET", secret), secret, work)).status).toBe(405);
    expect((await handleMailWorker(request(), undefined, work)).status).toBe(404);
    expect((await handleMailWorker(request(), secret, work)).status).toBe(401);
    expect((await handleMailWorker(request("POST", "wrong"), secret, work)).status).toBe(401);
    expect(work).not.toHaveBeenCalled();
    expect((await handleMailWorker(request("POST", secret), secret, work)).status).toBe(200);
    expect(work).toHaveBeenCalledOnce();
  });
  it("returns only sanitized failure and count responses", async () => {
    const r = await handleMailWorker(request("POST", secret), secret, async () => { throw Error("private details"); });
    expect(r.status).toBe(503); expect(await r.text()).not.toContain("private details");
    const failed = await handleMailWorker(request("POST", secret), secret, async () => ({ sent: 0, failed: 1, cancelled: 0, available: true }));
    expect(failed.status).toBe(503);
  });
  it("registers after commit and preserves successful response if delivery or scheduling fails", async () => {
    const events: string[] = [], tasks: (() => Promise<void>)[] = [];
    const r = await withMailTrigger(request(), async () => { events.push("commit"); return new Response("accepted"); },
      task => { events.push("scheduled"); tasks.push(task); }, async () => { events.push("delivery"); throw Error("provider"); });
    expect(events).toEqual(["commit", "scheduled"]); expect(await r.text()).toBe("accepted");
    await tasks[0](); expect(events).toEqual(["commit", "scheduled", "delivery"]);
    expect((await withMailTrigger(request(), async () => new Response(), () => { throw Error("schedule"); }, async () => {})).status).toBe(200);
  });
  it("does not schedule rejected transactions, GETs or preload requests", async () => {
    const after = vi.fn(), work = vi.fn();
    await withMailTrigger(request("GET"), async () => new Response(), after, work);
    await withMailTrigger(request(), async () => new Response(null, { status: 400 }), after, work);
    await expect(withMailTrigger(request(), async () => { throw Error("rollback"); }, after, work)).rejects.toThrow("rollback");
    expect(after).not.toHaveBeenCalled(); expect(work).not.toHaveBeenCalled();
  });
});
