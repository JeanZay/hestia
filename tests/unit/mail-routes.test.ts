import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn<(task: () => Promise<void>) => void>(),
  runMail: vi.fn<() => Promise<void>>(),
  identity: vi.fn<(request: Request, action: string) => Promise<Response>>(),
  invitations: vi.fn<(request: Request, id?: string, action?: string) => Promise<Response>>(),
  readmissions: vi.fn<(request: Request, id?: string, action?: string) => Promise<Response>>(),
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/server/runtime", () => ({
  getApplication: () => ({
    handleIdentity: mocks.identity,
    handleInvitations: mocks.invitations,
    handleReadmissions: mocks.readmissions,
  }),
  runApplicationMail: mocks.runMail,
}));
// Exercise the production scheduling helper, with only runtime and Next isolated.
vi.mock("@/server/identity/worker", () => import("../../src/server/identity/worker"));

import * as identity from "../../src/app/api/hestia/identity/[action]/route";
import * as invitations from "../../src/app/api/hestia/household/invitations/route";
import * as invitationAction from "../../src/app/api/hestia/household/invitations/[id]/[action]/route";
import * as readmissions from "../../src/app/api/hestia/household/readmissions/route";
import * as readmissionAction from "../../src/app/api/hestia/household/readmissions/[id]/[action]/route";

const routes = [
  ...["enter", "send-otp", "recover", "recovery-email", "finish"].map(action => ({
    name: `identity/${action}`, handler: mocks.identity, args: [action],
    post: (request: Request) => identity.POST(request, { params: Promise.resolve({ action }) }),
  })),
  { name: "invitations", handler: mocks.invitations, args: [], post: invitations.POST },
  { name: "invitations/reissue", handler: mocks.invitations, args: ["invite-id", "reissue"],
    post: (request: Request) => invitationAction.POST(request, { params: Promise.resolve({ id: "invite-id", action: "reissue" }) }) },
  { name: "readmissions", handler: mocks.readmissions, args: [], post: readmissions.POST },
  { name: "readmissions/reissue", handler: mocks.readmissions, args: ["readmit-id", "reissue"],
    post: (request: Request) => readmissionAction.POST(request, { params: Promise.resolve({ id: "readmit-id", action: "reissue" }) }) },
];
const requestFor = (name: string, method = "POST") => new Request(`https://hestia.example.invalid/api/hestia/${name}`, { method });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.runMail.mockResolvedValue(undefined);
});

describe("production mail-producing route wiring", () => {
  it.each(routes)("$name schedules only after the business handler resolves, and executes after response", async route => {
    let resolveHandler!: (response: Response) => void;
    const committed = new Promise<Response>(resolve => { resolveHandler = resolve; });
    route.handler.mockReturnValue(committed);
    const request = requestFor(route.name);
    const responsePending = route.post(request);
    await vi.waitFor(() => expect(route.handler).toHaveBeenCalledOnce());
    expect(route.handler).toHaveBeenCalledWith(request, ...route.args);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.runMail).not.toHaveBeenCalled();

    const businessResponse = new Response('{"accepted":true}', { status: 202 });
    resolveHandler(businessResponse);
    expect(await responsePending).toBe(businessResponse);
    expect(mocks.after).toHaveBeenCalledOnce();
    expect(mocks.runMail).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.runMail).toHaveBeenCalledOnce();
  });

  it.each(routes)("$name does not schedule a rejected business operation or rollback", async route => {
    route.handler.mockResolvedValueOnce(new Response(null, { status: 409 }));
    expect((await route.post(requestFor(route.name))).status).toBe(409);
    route.handler.mockRejectedValueOnce(new Error("synthetic transaction rollback"));
    await expect(route.post(requestFor(route.name))).rejects.toThrow("synthetic transaction rollback");
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.runMail).not.toHaveBeenCalled();
  });

  it.each(routes)("$name keeps the committed response when deferred delivery fails", async route => {
    const response = new Response(null, { status: 201 });
    route.handler.mockResolvedValue(response);
    mocks.runMail.mockRejectedValueOnce(new Error("synthetic provider failure"));
    expect(await route.post(requestFor(route.name))).toBe(response);
    await expect(mocks.after.mock.calls[0][0]()).resolves.toBeUndefined();
    expect(response.status).toBe(201);
  });

  it.each([
    { name: "identity/status", handler: mocks.identity,
      get: (request: Request) => identity.GET(request, { params: Promise.resolve({ action: "status" }) }) },
    { name: "invitations", handler: mocks.invitations, get: invitations.GET },
    { name: "readmissions", handler: mocks.readmissions, get: readmissions.GET },
  ])("$name GET/prefetch never schedules mail even with a successful business response", async route => {
    route.handler.mockResolvedValue(new Response('{"items":[]}'));
    const request = requestFor(route.name, "GET");
    request.headers.set("purpose", "prefetch");
    expect((await route.get(request)).status).toBe(200);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.runMail).not.toHaveBeenCalled();
  });
});
