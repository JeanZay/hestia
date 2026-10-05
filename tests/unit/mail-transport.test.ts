import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createResendTransport } from "../../src/server/identity/transport";
import { MailDeliveryError } from "../../src/server/identity/mail-error";
import type { ServerConfig } from "../../src/server/config";

const config: ServerConfig = { environment: "dev", origin: "https://hestia.example.invalid", databaseUrl: "", secret: "" };
const env = { HESTIA_MAIL_PROVIDER: "resend", HESTIA_MAIL_FROM: "access@example.invalid", RESEND_API_KEY: "synthetic-provider-credential" };
const link = `${config.origin}/?flowId=${randomUUID()}&kind=invite#capability=${"a".repeat(43)}`;
const message = () => ({ id: randomUUID(), template: "invitation", parameters: { email: "member@example.invalid", url: link }, bindPayload: async () => true });
const accepted = () => new Response(JSON.stringify({ id: randomUUID() }));

describe("bounded Resend transport", () => {
  it("uses one stable endpoint, payload and idempotency key for a repeated intention", async () => {
    const request = vi.fn<typeof fetch>(async () => accepted()), send = createResendTransport(config, env, request)!;
    const mail = message(); await send(mail); await send(mail);
    expect(request.mock.calls[0][0]).toBe("https://api.resend.com/emails");
    const options = request.mock.calls[0][1]!;
    expect(options).toMatchObject({ method: "POST", redirect: "error", headers: { "Idempotency-Key": `hestia/${mail.id}` } });
    expect(JSON.parse(options.body as string)).toMatchObject({ from: env.HESTIA_MAIL_FROM, to: [mail.parameters.email], text: expect.stringContaining(link) });
    expect(request.mock.calls[1][1]?.body).toBe(options.body);
    expect(request.mock.calls[1][1]?.headers).toEqual(options.headers);
  });
  it("renders only the three closed text templates", async () => {
    const request = vi.fn<typeof fetch>(async () => accepted()), send = createResendTransport(config, env, request)!;
    await send(message());
    await send({ ...message(), template: "otp", parameters: { email: "member@example.invalid", otp: "123456" } });
    await send({ ...message(), template: "email-changed", parameters: { email: "old@example.invalid" } });
    const bodies = request.mock.calls.map(c => JSON.parse(c[1]!.body as string));
    expect(bodies.map(b => b.subject)).toEqual(["Votre accès à Hestia", "Votre code Hestia", "Votre adresse Hestia a changé"]);
    for (const b of bodies) expect(Object.keys(b).sort()).toEqual(["from", "subject", "text", "to"]);
  });
  it("disables local mode even when host credentials are inherited and closes invalid configuration", () => {
    expect(createResendTransport({ ...config, environment: "local" }, env)).toBeUndefined();
    expect(createResendTransport(config, {})).toBeUndefined();
    for (const changed of [{ HESTIA_MAIL_FROM: "a@example.invalid,b@example.invalid" }, { RESEND_API_KEY: "" }, { HESTIA_MAIL_PROVIDER: "other" }])
      expect(() => createResendTransport(config, { ...env, ...changed })).toThrow("MAIL_CONFIGURATION_INVALID");
  });
  it("refuses malformed recipients, secrets, links, templates and unexpected fields without network", async () => {
    const request = vi.fn<typeof fetch>(), send = createResendTransport(config, env, request)!;
    const invalid = [
      { ...message(), id: "not-a-message" }, { ...message(), template: "custom" },
      { ...message(), parameters: { email: "a@example.invalid\r\nBCC:x@example.invalid", url: link } },
      { ...message(), parameters: { email: "a@example.invalid", url: link.replace(config.origin, "https://foreign.invalid") } },
      { ...message(), parameters: { email: "a@example.invalid", url: link.replace("flowId=", "flowId=bad&flowId=") } },
      { ...message(), parameters: { email: "a@example.invalid", url: link, otp: "123456" } },
      { ...message(), template: "otp", parameters: { email: "a@example.invalid", otp: "x" } },
    ];
    for (const mail of invalid) await expect(send(mail)).rejects.toMatchObject({ retryable: false });
    expect(request).not.toHaveBeenCalled();
  });
  it.each([400, 401, 403, 404, 422])("closes permanent HTTP %s without exposing provider text", async status => {
    const send = createResendTransport(config, env, vi.fn<typeof fetch>(async () => new Response("sensitive provider echo", { status })))!;
    await expect(send(message())).rejects.toMatchObject({ retryable: false, message: "MAIL_DELIVERY_FAILED" });
  });
  it.each([408, 409, 429, 500, 503])("retains HTTP %s for bounded retry", async status => {
    const send = createResendTransport(config, env, vi.fn<typeof fetch>(async () => new Response("untrusted", { status, headers: { "retry-after": "999999" } })))!;
    await expect(send(message())).rejects.toMatchObject({ retryable: true, retryAfterSeconds: 3600 });
  });
  it("binds the complete payload before network and refuses drift after restart", async () => {
    let stored:string|undefined;
    const bindPayload=vi.fn(async(payload:string)=>{ stored ??= payload; return stored===payload; });
    const request=vi.fn<typeof fetch>(async()=>accepted()), mail={...message(),bindPayload};
    await createResendTransport(config,env,request)!(mail);
    await expect(createResendTransport(config,{...env,HESTIA_MAIL_FROM:"other@example.invalid"},request)!(mail)).rejects.toMatchObject({retryable:false});
    expect(request).toHaveBeenCalledTimes(1);
    expect(bindPayload.mock.invocationCallOrder[0]).toBeLessThan(request.mock.invocationCallOrder[0]);
  });
  it.each([["invalid_idempotent_request",false],["concurrent_idempotent_requests",true]])("classifies Resend conflict %s", async(name,retryable)=>{
    const send=createResendTransport(config,env,vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({name,message:"private echo"}),{status:409})))!;
    await expect(send(message())).rejects.toMatchObject({retryable,message:"MAIL_DELIVERY_FAILED"});
  });
  it.each(["{}", "not json", JSON.stringify({ id: "bad" }), "x".repeat(2049)])("treats uncertain successful response as retryable", async body => {
    const send = createResendTransport(config, env, vi.fn<typeof fetch>(async () => new Response(body)))!;
    await expect(send(message())).rejects.toBeInstanceOf(MailDeliveryError);
    await expect(send(message())).rejects.toMatchObject({ retryable: true });
  });
  it("sanitizes network failures and provides a bounded abort signal", async () => {
    let signal: AbortSignal | null | undefined;
    const send = createResendTransport(config, env, vi.fn<typeof fetch>(async (_url, options) => {
      signal = options?.signal; throw Error("sensitive network details");
    }))!;
    await expect(send(message())).rejects.toMatchObject({ retryable: true, message: "MAIL_DELIVERY_FAILED" });
    expect(signal).toBeInstanceOf(AbortSignal);
  });
  it("aborts an unresponsive provider request within the lease", async () => {
    const request = vi.fn<typeof fetch>(async (_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(Error("private timeout context")), { once: true });
    }));
    const send = createResendTransport(config, env, request)!;
    await expect(send(message())).rejects.toMatchObject({ retryable: true, message: "MAIL_DELIVERY_FAILED" });
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
  }, 10000);
});
