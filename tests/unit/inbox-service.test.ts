import { readFileSync } from 'node:fs';
import { createHmac, createHash } from 'node:crypto';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { createInboxAcknowledgementTransport, AcknowledgementFailure, acknowledgementText } from '../../src/server/inbox/acknowledgement';
import type { ServerConfig } from '../../src/server/config';
import { canonicalEnvelope, signEnvelope, signTick, signedTickReply, type RelayEnvelope, type InboxTick } from '../../src/server/inbox/transport';
import { projectInboxAccess, inboxAccessLabel } from '../../src/server/inbox/access-projection';
import { CAPABILITIES } from '../../src/server/permissions/capabilities';
import type { AccessGraph } from '../../src/server/permissions/tree';
import type { Grant } from '../../src/server/permissions/service';
describe('outgoing minimal receipts and deployable Apps Script parity', () => {
 const config = { environment: 'dev', origin: 'https://synthetic.example.invalid' } as ServerConfig;
 const env = { HESTIA_MAIL_PROVIDER: 'resend', HESTIA_MAIL_FROM: 'hestia@example.invalid', RESEND_API_KEY: 'synthetic-only-key' };
 const message = { id: '12345678-1234-4234-8234-123456789abc', email: 'synthetic@example.invalid', outcome: 'partial', accepted: 2, rejected: 1 };
 it('never constructs an external transport in local mode', () => { expect(createInboxAcknowledgementTransport({ ...config, environment: 'local' }, env)).toBeUndefined(); });
 it('emits the fixed minimal payload with a stable opaque idempotency key', async () => {
  const request = vi.fn(async (url: string | URL | Request, options?: RequestInit) => { expect(url).toBe('https://api.resend.com/emails'); expect(options?.method).toBe('POST'); return Response.json({ id: message.id }); }); const send = createInboxAcknowledgementTransport(config, env, request)!;
  await expect(send(message)).resolves.toEqual({ providerId: message.id }); expect(request).toHaveBeenCalledTimes(1);
  const options = request.mock.calls[0][1] as RequestInit; const payload = JSON.parse(options.body as string); expect(Object.keys(payload).sort()).toEqual(['from','subject','text','to']); expect(payload.text).toContain('acceptées : 2'); expect(payload.text).toContain('refusées : 1'); expect(payload).not.toHaveProperty('attachments'); expect((options.headers as Record<string, string>)['Idempotency-Key']).toBe(`hestia/inbox/${message.id}`);
 });
 it('distinguishes a known provider refusal from an ambiguous timeout without automatic retry', async () => {
  const reject = vi.fn(async () => new Response('', { status: 400 })); await expect(createInboxAcknowledgementTransport(config, env, reject)!(message)).rejects.toMatchObject({ known: true }); expect(reject).toHaveBeenCalledTimes(1);
  const timeout = vi.fn(async () => { throw new Error('synthetic timeout'); }); await expect(createInboxAcknowledgementTransport(config, env, timeout)!(message)).rejects.toBeInstanceOf(AcknowledgementFailure); expect(timeout).toHaveBeenCalledTimes(1);
 });
 it('states each terminal outcome distinctly, omits unavailable inventory counts and emits only fixed minimal causes', () => {
  const outcomes = ['accepted','partial','no_attachments','all_rejected','message_rejected']; const texts = outcomes.map(outcome => acknowledgementText({ ...message, outcome, accepted: 0, rejected: 0 }, config.origin)); expect(new Set(texts).size).toBe(5);
  const rejected = acknowledgementText({ ...message, outcome: 'message_rejected', accepted: 0, rejected: 0, reasons: ['invalid_html_encoding','private-synthetic-subject-or-file.pdf'] }, config.origin);
  expect(rejected).toContain('refusé dans son ensemble'); expect(rejected).toContain('l’inventaire'); expect(rejected).not.toContain('Pièces acceptées :'); expect(rejected).not.toContain('Pièces refusées :'); expect(rejected).toContain('encodage invalide'); expect(rejected).not.toContain('private-synthetic');
  expect(acknowledgementText({ ...message, reasons: ['quota_exceeded'] }, config.origin)).toContain('stockage disponible est insuffisant'); expect(() => acknowledgementText({ ...message, outcome: 'sender_rejected' }, config.origin)).toThrow();
 });
 it('executes the actual Apps Script request signer against server canonicalization and verifies the bound reply', () => {
  const secret = 'synthetic-apps-script-secret-only', digest = (input: string | number[]) => createHash('sha256').update(typeof input === 'string' ? input : Buffer.from(input)).digest();
  let captured: RelayEnvelope | undefined, signature: string | undefined;
  const runtime = vm.createContext({ Utilities: { DigestAlgorithm: { SHA_256: 'SHA_256' }, computeDigest: (_type: string, input: string | number[]) => [...digest(input)], computeHmacSha256Signature: (input: string, key: string) => [...createHmac('sha256', key).update(input).digest()], getUuid: () => '12345678-1234-4234-8234-123456789abc', base64Encode: (bytes: number[]) => Buffer.from(bytes).toString('base64') }, UrlFetchApp: { fetch: (_url: string, options: { payload: string; headers: Record<string,string> }) => { captured = JSON.parse(options.payload); signature = options.headers['x-hestia-signature']; const response = { requestSha256: digest(canonicalEnvelope(captured!)).toString('hex'), nonce: captured!.nonce, result: { terminal: false, transport: 'stored' } }; const signed = { ...response, signature: createHmac('sha256', secret).update(JSON.stringify(response)).digest('hex') }; return { getResponseCode: () => 200, getContentText: () => JSON.stringify(signed) }; } } });
  vm.runInContext(readFileSync(new URL('../../scripts/gmail-relay/Code.gs', import.meta.url), 'utf8'), runtime);
  const output = vm.runInContext(`hestiaExchange({endpoint:'https://synthetic.example.invalid/relay',secret:'${secret}'},{environment:'dev',actor:'synthetic',epoch:1,gmailId:'abcdef',rawSha256:'${digest('abc').toString('hex')}',rawSize:3,chunks:1},'chunk',0,[97,98,99])`, runtime);
  expect(output.transport).toBe('stored'); expect(signature).toBe(signEnvelope(captured!, secret));
 });
 it('runs authenticated heartbeats before and after an empty Gmail poll without manufacturing a message or using mail capabilities', () => {
  const secret = 'synthetic-apps-script-heartbeat-secret-only', ticks: InboxTick[] = [], properties: Record<string, string> = { HESTIA_ENDPOINT: 'https://synthetic.example.invalid/api/hestia/inbox/relay', HESTIA_ENVIRONMENT: 'dev', HESTIA_RELAY_ACTOR: 'synthetic-dev', HESTIA_RELAY_EPOCH: '1', HESTIA_RELAY_SECRET: secret };
  let nonce = 0, released = false;
  const runtime = vm.createContext({
   Utilities: { DigestAlgorithm: { SHA_256: 'SHA_256' }, computeDigest: (_type: string, input: string) => [...createHash('sha256').update(input).digest()], computeHmacSha256Signature: (input: string, key: string) => [...createHmac('sha256', key).update(input).digest()], getUuid: () => `synthetic-heartbeat-nonce-${++nonce}` },
   LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => { released = true; } }) }, PropertiesService: { getScriptProperties: () => ({ getProperty: (key: string) => properties[key], deleteProperty: () => undefined }) }, Gmail: { Users: { Messages: { list: () => ({ messages: [] }) } } },
   UrlFetchApp: { fetch: (url: string, options: { payload: string; headers: Record<string, string> }) => { expect(url).toBe('https://synthetic.example.invalid/api/hestia/inbox/tick'); const value: InboxTick = JSON.parse(options.payload); expect(Object.keys(value).sort()).toEqual(['actor','environment','epoch','nonce','timestamp']); expect(options.headers['x-hestia-signature']).toBe(signTick(value, secret)); ticks.push(value); return { getResponseCode: () => 200, getContentText: () => JSON.stringify(signedTickReply(value, { accepted: true }, secret)) }; } },
  });
  vm.runInContext(readFileSync(new URL('../../scripts/gmail-relay/Code.gs', import.meta.url), 'utf8'), runtime); vm.runInContext('hestiaRelayTick()', runtime);
  expect(released).toBe(true); expect(ticks).toHaveLength(2); expect(ticks[0].nonce).not.toBe(ticks[1].nonce);
 });
});

describe('current destination access disclosure uses the Capture permissions envelope', () => {
 const actor = { id: 'alice', name: 'Alice synthétique', email: 'alice@example.invalid' };
 function grant(user: string, capability: string, transmit: string[] = [], kind = 'direct'): Grant { return { id: `${user}-${capability}`, folder_id: 'folder', user_id: user, capability, kind, parent_id: null, transmit, lineage: [], origin: 'initial', author_id: 'owner', subject_epoch: 0, batch_id: 'folder', created_at: new Date(0), revoked_at: null, expires_at: null }; }
 function graph(): AccessGraph { return { now: 1000, folders: [{ id: 'folder', created_by: 'owner', parent_folder_id: null }], members: [{ user_id: 'owner', name: 'Propriétaire synthétique', active: true, departure_epoch: 0 }, { user_id: 'alice', name: actor.name, active: true, departure_epoch: 0 }, { user_id: 'bob', name: 'Bob synthétique privé', active: true, departure_epoch: 0 }], restrictions: [], cuts: [], grants: [...CAPABILITIES.map(cap => grant('owner', cap, cap === 'administrer' || cap === 'partager' ? [...CAPABILITIES] : [], cap === 'administrer' ? 'reference' : 'direct')), grant('alice', 'consulter'), grant('alice', 'déposer'), grant('bob', 'consulter')] }; }
 it('lists actual rights while hiding other members when the actor lacks a sharing envelope', () => { const projection = projectInboxAccess(graph(), actor, 'folder'); expect(projection.capabilities).toEqual(['consulter','déposer']); expect(projection.people).toBeUndefined(); const label = inboxAccessLabel(projection, false); expect(label).toContain('consulter, déposer'); expect(JSON.stringify(projection)).not.toContain('Bob'); expect(label).not.toContain('administrer'); });
 it('discloses only people and capabilities inside the current sharing authority', () => { const value = graph(); const owner = { ...actor, id: 'owner', name: 'Propriétaire synthétique' }; const projection = projectInboxAccess(value, owner, 'folder'); expect(projection.people?.find(person => person.id === 'bob')).toEqual({ id: 'bob', name: 'Bob synthétique privé', capabilities: ['consulter'] }); expect(projection.people?.find(person => person.id === 'alice')?.capabilities).toEqual(['consulter','déposer']); });
 it('makes a new root explicitly private to its creator and never infers access from an administrator identifier', () => { const value = graph(), projection = projectInboxAccess(value, actor, null); expect(projection.message).toContain('Privé — vous seul'); expect(projection.people).toEqual([{ id: actor.id, name: actor.name, capabilities: [...CAPABILITIES] }]); expect(inboxAccessLabel(projection, true)).toContain('Privé — vous seul'); const outsider = projectInboxAccess(value, { ...actor, id: 'administrator-without-grants' }, 'folder'); expect(outsider.capabilities).toEqual([]); expect(outsider.people).toBeUndefined(); });
 it('re-evaluates expirations and revoked sharing before revealing any other profile', () => { const value = graph(); value.grants.push(grant('alice', 'partager', ['consulter','déposer'])); expect(projectInboxAccess(value, actor, 'folder').people?.some(person => person.id === 'bob')).toBe(true); value.grants[value.grants.length - 1].expires_at = new Date(value.now); expect(projectInboxAccess(value, actor, 'folder').people).toBeUndefined(); });
});
