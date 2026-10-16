import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createApplication } from '../../src/server/application';
import { createAuth } from '../../src/server/auth/options';
import { createAccess } from '../../src/server/access';
import { readServerConfig } from '../../src/server/config';
import { migrateDatabase } from '../../src/server/db/migrate';
import { provisionSyntheticMember } from '../../src/server/db/synthetic';
import { createObjectStore, type ObjectStore } from '../../src/server/storage';
import { createStorageBudget } from '../../src/server/storage/quota';
import { createInboxService } from '../../src/server/inbox';
import { acknowledgementText } from '../../src/server/inbox/acknowledgement';
import { RELAY_CHUNK, canonicalTick, digest, signEnvelope, signTick, type RelayEnvelope, type InboxTick } from '../../src/server/inbox/transport';
import type { InboxQueueDto } from '../../src/shared/inbox-contract';

describe('inbox durable SQL admission, physical custody and human placement', () => {
 const config = readServerConfig();
 if (config.environment !== 'local' || !/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname) || !/^hestia-app-[a-f0-9]{16}$/.test(process.env.HESTIA_TEST_RUN_ID ?? '')) throw new Error('Owned synthetic bench required');
 const pool = new Pool({ connectionString: config.databaseUrl, max: 8 }), realStore = createObjectStore(), access = createAccess(pool, config, createAuth(pool, config));
 const secret = 'synthetic-inbox-relay-secret-never-live', relayActor = 'synthetic-relay', budget = createStorageBudget();
 let now = new Date(), failPut = false, failDelete = false, hook: (() => Promise<void>) | undefined;
 const store: ObjectStore = { async put(key, bytes, type) { await realStore.put(key, bytes, type); await hook?.(); if (failPut) throw new Error('synthetic lost storage response'); }, getRange: (key, start, end) => realStore.getRange(key, start, end), async delete(key) { if (failDelete) throw new Error('synthetic storage unavailable'); await realStore.delete(key); } };
 let identitySender = '', actorId: string, cookie: string, otherCookie: string, otherEmail: string, folderId: string;
 const app = createApplication(pool, config, { store }), password = 'Synthetic inbox phrase only!';
 const makeService = (epoch = 1, selectedBudget = budget) => createInboxService(pool, access, { store, budget: selectedBudget, environment: 'dev', address: 'synthetic-technical@gmail.com', relayActor, relayEpoch: epoch, relaySecret: secret, clock: async () => now, authenticate: async () => ({ sender: identitySender, recipient: 'synthetic-technical@gmail.com' }) });
 const service = makeService();
 function req(body?: unknown, method = body === undefined ? 'GET' : 'POST', selectedCookie = cookie) { return new Request(config.origin + '/api/hestia/inbox', { method, headers: { origin: config.origin, cookie: selectedCookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); }
 async function result(response: Response, status = 200) { const value = await response.json(); expect(response.status, JSON.stringify(value)).toBe(status); return value; }
 async function login(email: string) { await pool.query('UPDATE "rateLimit" SET "lastRequest"=0'); const response = await app.handleAuth(new Request(config.origin + '/api/auth/sign-in/email', { method: 'POST', headers: { origin: config.origin, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })); expect(response.status).toBe(200); return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; '); }
 function raw(file = 'synthetic.bin', body = Buffer.from('Synthetic original bytes'), extraParts: string[] = []) { return Buffer.from(`From: ${identitySender}\r\nTo: synthetic-technical@gmail.com\r\nSubject: Private synthetic mail\r\nMessage-ID: <${randomUUID()}@example.invalid>\r\nDate: Thu, 15 Oct 2026 10:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=boundary\r\n\r\n--boundary\r\nContent-Type: text/plain\r\n\r\nPrivate mail context\r\n--boundary\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename="${file}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${body.toString('base64')}${extraParts.map(part => '\r\n--boundary\r\n' + part).join('')}\r\n--boundary--\r\n`); }
 function envelope(bytes: Uint8Array, gmailId: string, operation: RelayEnvelope['operation'], index = 0, epoch = 1): RelayEnvelope { const chunk = bytes.subarray(index * RELAY_CHUNK, (index + 1) * RELAY_CHUNK); return { environment: 'dev', actor: relayActor, epoch, gmailId, rawSha256: digest(bytes), rawSize: bytes.length, chunks: Math.ceil(bytes.length / RELAY_CHUNK), operation, index, chunkSha256: digest(operation === 'chunk' ? chunk : ''), timestamp: now.getTime(), nonce: randomUUID().replaceAll('-', ''), payload: operation === 'chunk' ? Buffer.from(chunk).toString('base64') : '' }; }
 async function send(value: RelayEnvelope, instance = service, expected = 200) { return result(await instance.handleInboxRelay(new Request(config.origin + '/api/hestia/inbox/relay', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hestia-signature': signEnvelope(value, secret) }, body: JSON.stringify(value) })), expected); }
 async function receive(bytes = raw(), gmailId = randomUUID().replaceAll('-', ''), instance = service) { for (let index = 0; index < Math.ceil(bytes.length / RELAY_CHUNK); index++) await send(envelope(bytes, gmailId, 'chunk', index), instance); const received = await send(envelope(bytes, gmailId, 'process'), instance); return { bytes, gmailId, eventId: received.result.eventId as string, outcome: received.result.outcome as string }; }
 async function attachment(eventId: string, selectedCookie = cookie) { const queue = await result(await service.handleInbox(req(undefined, 'GET', selectedCookie))); return queue.attachments.find((row: { messageId: string }) => row.messageId === eventId); }
 async function publish(item: { id: string; version: number }, title: string, destinationFolder = folderId, selectedCookie = cookie) {
  const input = { version: item.version, destination: { kind: 'existing', folderId: destinationFolder }, mode: 'add', title }, preview = await result(await service.handleInboxPreview(req(input, 'POST', selectedCookie), item.id));
  return result(await service.handleInboxPlace(req({ ...input, previewToken: preview.previewToken, idempotencyKey: randomUUID() }, 'POST', selectedCookie), item.id));
 }
 async function queueVolume(input: { pending: number; discarded?: number; expiredDiscarded?: number; notices?: number; heavy?: boolean }) {
  const tag = `queue-${randomUUID()}`, email = `${tag}@example.invalid`, owner = await provisionSyntheticMember(pool, { email, name: 'File de volume synthétique', password, role: 'member' }), selectedCookie = await login(email);
  const discarded = input.discarded ?? 0, expired = input.expiredDiscarded ?? 0, attachmentCount = input.pending + discarded + expired, noticeCount = input.notices ?? 0;
  const events = Array.from({ length: attachmentCount + noticeCount }, () => randomUUID()), ids = Array.from({ length: attachmentCount }, () => randomUUID()), contents = ids.map(() => randomUUID());
  const context = input.heavy ? '😀'.repeat(4000) : '', comment = input.heavy ? '😀'.repeat(2000) : '';
  const analysis = input.heavy ? { status: 'ready', suggestions: Array.from({ length: 4 }, (_, i) => { const levels = Array.from({ length: 20 }, (_, j) => `${i}-${j}-${'é'.repeat(110)}`); return { destination: { kind: 'create', parentId: null, levels }, label: levels.join(' / '), reason: 'é'.repeat(500) }; }) } : { status: 'unavailable', suggestions: [] };
  // These rows exercise SQL queue projection at volume. Only a content explicitly published below needs a physical object; no fixture invokes a reader or an AI worker.
  await access.transaction(async client => {
   await client.query(`INSERT INTO hestia_inbox_event(id,environment,relay_actor,gmail_id_sha256,raw_sha256,raw_size,chunk_count,configuration_epoch,state,first_at,staging_until,terminal_at,owner_id,attributed_actor_id,owner_epoch,departure_epoch,sender,subject,context,notice_until)
     SELECT id,'dev',$3,id::text,$4,1,1,1,CASE WHEN n<=$5 THEN 'accepted' ELSE 'no_attachments' END,
       CASE WHEN n<=$5 THEN $6::timestamptz+n*interval '1 second' ELSE $7::timestamptz-interval '1 hour'+n*interval '1 millisecond' END,
       $7::timestamptz+interval '24 hours',$7,$2,$2,0,0,$8,$3||n::text,$9,CASE WHEN n>$5 THEN $7::timestamptz+interval '7 days' END
     FROM unnest($1::uuid[]) WITH ORDINALITY source(id,n)`, [events, owner, tag, digest('q'), attachmentCount, new Date(now.getTime() - 365 * 86400000), now, email, context]);
   if (attachmentCount) {
    await client.query(`INSERT INTO hestia_content(id,object_key,owner_id,size,sha256,media_type,file_name,preview_supported)
      SELECT id,'queue-volume/'||id::text,$2,1,$3,'application/octet-stream',$4||n::text||'.bin',false FROM unnest($1::uuid[]) WITH ORDINALITY source(id,n)`, [contents, owner, digest('q'), tag]);
    await client.query(`INSERT INTO hestia_inbox_attachment(id,event_id,position,actor_id,departure_epoch,content_id,ready,state,received_at,discarded_until,comment,analysis)
      SELECT id,($2::uuid[])[n::integer],'0.1',$4,0,($3::uuid[])[n::integer],true,CASE WHEN n<=$5 THEN 'pending' ELSE 'discarded' END,
        $8::timestamptz+n*interval '1 second',CASE WHEN n>$5 AND n<=$5+$6 THEN $7::timestamptz+interval '1 hour'+n*interval '1 millisecond' WHEN n>$5+$6 THEN $7 END,$9,$10::jsonb
      FROM unnest($1::uuid[]) WITH ORDINALITY source(id,n)`, [ids, events, contents, owner, input.pending, discarded, now, new Date(now.getTime() - 365 * 86400000), comment, JSON.stringify(analysis)]);
    await client.query("UPDATE hestia_content_summary SET status='unavailable',permitted=false WHERE content_id=ANY($1::uuid[])", [contents]);
   }
  });
  return { tag, owner, cookie: selectedCookie, events, ids, contents, context, comment, analysis };
 }
 function coherentQueue(queue: InboxQueueDto) { const parents = new Set(queue.messages.map(message => message.id)); expect(queue.attachments.every(item => parents.has(item.messageId))).toBe(true); expect(new Set(queue.messages.map(message => message.id)).size).toBe(queue.messages.length); }
 beforeAll(async () => {
  expect((await pool.query("SELECT to_regclass('hestia_bench_marker') AS marker")).rows[0].marker).toBeTruthy(); await migrateDatabase(pool, config);
  const syntheticEmail = `inbox-${randomUUID()}@example.invalid`; actorId = await provisionSyntheticMember(pool, { email: syntheticEmail, name: 'Membre synthétique Inbox', password, role: 'member' }); cookie = await login(syntheticEmail);
  // Qualified Gmail syntax is synthetic test input only. The owned database and injected verifier/transport prevent remote mail access.
  identitySender = `inbox-${randomUUID()}@gmail.com`; await pool.query('UPDATE "user" SET email=$2 WHERE id=$1', [actorId, identitySender]);
  otherEmail = `inbox-admin-${randomUUID()}@example.invalid`; await provisionSyntheticMember(pool, { email: otherEmail, name: 'Admin synthétique Inbox', password, role: 'admin' }); otherCookie = await login(otherEmail);
  const folder = await result(await app.handleFolders(req({ name: `Inbox ${randomUUID()}` })), 201); folderId = folder.folder.id;
  const settings = await result(await service.handleInboxSettings(req())); expect(settings.enabled).toBe(false); expect(settings.automaticAnalysis).toBe(false); await result(await service.handleInboxSettings(req({ version: settings.version, enabled: true }, 'PATCH')));
 });
 afterAll(async () => { await pool.end(); });
 it('records each authenticated heartbeat nonce once across concurrent requests, rejects cross-environment/epoch replay and creates no message tombstone', async () => {
  const value: InboxTick = { environment: 'dev', actor: relayActor, epoch: 1, timestamp: now.getTime(), nonce: randomUUID().replaceAll('-', '') };
  const before = Number((await pool.query('SELECT count(*) FROM hestia_inbox_event')).rows[0].count);
  const tick = (input: InboxTick, instance = service) => instance.handleInboxTick(new Request(config.origin + '/api/hestia/inbox/tick', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hestia-signature': signTick(input, secret) }, body: JSON.stringify(input) }));
  const attempts = await Promise.all([tick(value), tick(value)]); expect(attempts.map(response => response.status).sort()).toEqual([200,409]);
  const body = await attempts.find(response => response.status === 200)!.json(); expect(body.result).toEqual({ accepted: true }); expect(body).not.toHaveProperty('terminal');
  const stored = (await pool.query('SELECT request_sha256 FROM hestia_inbox_nonce WHERE environment=$1 AND actor=$2 AND nonce=$3', ['dev', relayActor, value.nonce])).rows; expect(stored).toEqual([{ request_sha256: digest(canonicalTick(value)) }]);
  expect((await tick({ ...value, environment: 'production', nonce: randomUUID().replaceAll('-', '') })).status).toBe(400); expect((await tick(value, makeService(2))).status).toBe(400);
  expect(Number((await pool.query('SELECT count(*) FROM hestia_inbox_event')).rows[0].count)).toBe(before);
 });
 it('transfers the physical raw charge once on admission, with no extra charge on replay', async () => {
  const bytes = raw(), id = randomUUID().replaceAll('-', ''), before = await access.transaction(client => budget.usage(client, actorId));
  await send(envelope(bytes, id, 'chunk')); const staged = await access.transaction(client => budget.usage(client, actorId)); expect(staged.memberBytes).toBe(before.memberBytes); expect(staged.totalBytes).toBe(before.totalBytes + bytes.length);
  const response = await send(envelope(bytes, id, 'process')); expect(response.result.outcome).toBe('accepted');
  const after = await access.transaction(client => budget.usage(client, actorId)); expect(after.memberBytes).toBe(before.memberBytes + bytes.length + Buffer.byteLength('Synthetic original bytes'));
  await send(envelope(bytes, id, 'process')); expect(await access.transaction(client => budget.usage(client, actorId))).toEqual(after);
 });
 it('records a known quota refusal once while keeping untransferred raw bytes charged globally until confirmed deletion', async () => {
  const bytes = raw(), id = randomUUID().replaceAll('-', ''), before = await access.transaction(client => budget.usage(client, actorId));
  const constrained = makeService(1, createStorageBudget(before.memberBytes + bytes.length - 1));
  await send(envelope(bytes, id, 'chunk'), constrained); const response = await send(envelope(bytes, id, 'process'), constrained); expect(response.result).toMatchObject({ terminal: true, outcome: 'message_rejected' });
  const eventId = response.result.eventId, event = (await pool.query('SELECT owner_id,attributed_actor_id,rejected FROM hestia_inbox_event WHERE id=$1', [eventId])).rows[0]; expect(event).toEqual({ owner_id: null, attributed_actor_id: actorId, rejected: [{ reason: 'quota_exceeded' }] });
  expect((await access.transaction(client => budget.usage(client, actorId))).memberBytes).toBe(before.memberBytes); expect((await result(await constrained.handleInbox(req()))).messages.find((row: { id: string }) => row.id === eventId)?.outcome).toBe('message_rejected');
  await send(envelope(bytes, id, 'process'), constrained); expect(Number((await pool.query('SELECT count(*) FROM hestia_inbox_ack WHERE event_id=$1', [eventId])).rows[0].count)).toBe(1); expect(Number((await pool.query('SELECT count(*) FROM hestia_inbox_attachment WHERE event_id=$1', [eventId])).rows[0].count)).toBe(0);
  await constrained.cleanup(); expect((await pool.query('SELECT deleted_at FROM hestia_inbox_chunk WHERE event_id=$1', [eventId])).rows.every(row => row.deleted_at)).toBe(true);
 });
 it('keeps explicit arrivals private, persists exact bytes, replays one Gmail ID across key epochs and rejects conflicting digest', async () => {
  const delivery = await receive(); expect(delivery.outcome).toBe('accepted'); const item = await attachment(delivery.eventId); expect(item.sha256).toBe(digest('Synthetic original bytes')); expect((await service.handleInboxAttachment(req(undefined, 'GET', otherCookie), item.id)).status).toBe(404);
  const bytes = await service.handleInboxContent(req(), item.id); expect(Buffer.from(await bytes.arrayBuffer()).toString()).toBe('Synthetic original bytes'); expect(bytes.headers.get('cache-control')).toBe('private, no-store');
  const rotated = makeService(2), receipt = await send(envelope(delivery.bytes, delivery.gmailId, 'receipt', 0, 2), rotated); expect(receipt.result).toMatchObject({ terminal: true, outcome: 'accepted', eventId: delivery.eventId });
  const changed = raw('different.bin'); await send(envelope(changed, delivery.gmailId, 'chunk', 0, 2), rotated, 409);
  expect(Number((await pool.query('SELECT count(*) FROM hestia_inbox_attachment WHERE event_id=$1', [delivery.eventId])).rows[0].count)).toBe(1);
 });
 it('recovers from a lost object-store response without publishing a phantom or importing twice', async () => {
  const bytes = raw(), id = randomUUID().replaceAll('-', ''); failPut = true; try { await send(envelope(bytes, id, 'chunk'), service, 503); } finally { failPut = false; }
  const before = await result(await service.handleInbox(req())); const event = (await pool.query('SELECT id FROM hestia_inbox_event WHERE gmail_id_sha256=$1', [digest(id)])).rows[0]; expect(before.attachments.some((row: { messageId: string }) => row.messageId === event.id)).toBe(false);
  await send(envelope(bytes, id, 'chunk')); const first = await send(envelope(bytes, id, 'process')); const second = await send(envelope(bytes, id, 'process')); expect(first.result.outcome).toBe('accepted'); expect(second.result).toMatchObject({ eventId: first.result.eventId, terminal: true });
 });
 it('revokes activation during physical I/O, publishes nothing and retains a terminal rejection', async () => {
  const bytes = raw(), id = randomUUID().replaceAll('-', ''); await send(envelope(bytes, id, 'chunk'));
  hook = async () => { hook = undefined; await pool.query('UPDATE hestia_inbox_settings SET enabled=false WHERE actor_id=$1', [actorId]); };
  const response = await send(envelope(bytes, id, 'process')); expect(response.result.outcome).toBe('sender_rejected'); expect(await attachment(response.result.eventId)).toBeUndefined();
  await pool.query('UPDATE hestia_inbox_settings SET enabled=true WHERE actor_id=$1', [actorId]);
 });
 it('preserves pending arrivals beyond seven days and enforces discarded expiry exactly without releasing failed deletions', async () => {
  const delivery = await receive(), item = await attachment(delivery.eventId), key = randomUUID();
  const body = { version: item.version, idempotencyKey: key }; await result(await service.handleInboxDiscard(req(body), item.id)); await result(await service.handleInboxDiscard(req(body), item.id));
  const deadline = (await pool.query('SELECT discarded_until FROM hestia_inbox_attachment WHERE id=$1', [item.id])).rows[0].discarded_until; const prior = now;
  now = new Date(deadline); expect((await service.handleInboxRestore(req({ version: item.version + 1, idempotencyKey: randomUUID() }), item.id)).status).toBe(404);
  failDelete = true; await service.cleanup(); const physical = (await pool.query('SELECT c.* FROM hestia_content c JOIN hestia_inbox_attachment a ON a.content_id=c.id WHERE a.id=$1', [item.id])).rows[0]; expect(physical.deleted_at).toBeNull(); expect(physical.purge_pending_at).toBeTruthy();
  failDelete = false; await service.cleanup(); expect((await pool.query('SELECT c.deleted_at,c.file_name FROM hestia_content c JOIN hestia_inbox_attachment a ON a.content_id=c.id WHERE a.id=$1', [item.id])).rows[0]).toEqual({ deleted_at: now, file_name: null }); now = prior;
 });
 it('places atomically, reconciles a lost response and creates no second document for the same operation', async () => {
  const delivery = await receive(), item = await attachment(delivery.eventId), input = { version: item.version, destination: { kind: 'existing', folderId }, mode: 'add', title: 'Rangement synthétique' };
  const preview = await result(await service.handleInboxPreview(req(input), item.id)); const body = { ...input, previewToken: preview.previewToken, idempotencyKey: randomUUID() };
  expect(preview.access.capabilities).toContain('consulter'); expect(preview.access.capabilities).toContain('déposer'); expect(preview.accessLabel).toContain('Vos droits');
  const wrongPath = new Request(config.origin + `/api/hestia/inbox/${randomUUID()}/operations/${body.idempotencyKey}`, { method: 'POST', headers: { origin: config.origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ ...body, attachmentId: item.id }) }); expect((await service.handleInboxOperation(wrongPath, body.idempotencyKey)).status).toBe(400);
  const [one, two] = await Promise.all([service.handleInboxPlace(req(body), item.id), service.handleInboxPlace(req(body), item.id)]); const replies = await Promise.all([one.json(), two.json()]); expect([one.status, two.status]).toContain(200); expect(replies.some(value => value.status === 'recorded')).toBe(true);
  const replay = await result(await service.handleInboxOperation(req({ ...body, attachmentId: item.id }), body.idempotencyKey)); expect(replay.status).toBe('recorded');
  expect(Number((await pool.query('SELECT count(*) FROM hestia_document_revision WHERE content_id=$1', [(await pool.query('SELECT content_id FROM hestia_inbox_attachment WHERE id=$1', [item.id])).rows[0].content_id])).rows[0].count)).toBe(1);
  expect(await attachment(delivery.eventId)).toBeUndefined();
 });
 it('previews a new root as private to its creator with explicit rights and no other household profiles', async () => {
  const delivery = await receive(), item = await attachment(delivery.eventId), input = { version: item.version, destination: { kind: 'create', parentId: null, levels: [`Privé ${randomUUID()}`] }, mode: 'add' };
  const preview = await result(await service.handleInboxPreview(req(input), item.id)); expect(preview.accessLabel).toContain('Privé — vous seul'); expect(preview.access.capabilities).toEqual(['consulter','déposer','modifier','supprimer','partager','exporter','administrer']); expect(preview.access.people.map((person: { id: string }) => person.id)).toEqual([actorId]);
 });
 it('rejects a stale preview after comment change while preserving the pending original', async () => {
  const delivery = await receive(), item = await attachment(delivery.eventId), input = { version: item.version, destination: { kind: 'existing', folderId }, mode: 'add' };
  const preview = await result(await service.handleInboxPreview(req(input), item.id)); await result(await service.handleInboxComment(req({ commentVersion: item.commentVersion, comment: 'Contexte mis à jour' }, 'PATCH'), item.id));
  expect((await service.handleInboxPlace(req({ ...input, previewToken: preview.previewToken, idempotencyKey: randomUUID() }), item.id)).status).toBe(409); expect((await attachment(delivery.eventId)).state).toBe('pending');
 });
 it('requires a new human confirmation after a visible duplicate appears, then permits explicit Add with that duplicate presented', async () => {
  const bytes = Buffer.from(`Duplicate appearance ${randomUUID()}`), first = await receive(raw('appearance.bin', bytes)), second = await receive(raw('appearance.bin', bytes)), item = await attachment(first.eventId), later = await attachment(second.eventId);
  const input = { version: item.version, destination: { kind: 'existing', folderId }, mode: 'add', title: `Appearance ${randomUUID()}` }, preview = await result(await service.handleInboxPreview(req(input), item.id)), operationId = randomUUID(); expect(preview.duplicates).toEqual([]);
  const created = await publish(later, 'Visible document created after preview');
  expect((await service.handleInboxPlace(req({ ...input, previewToken: preview.previewToken, idempotencyKey: operationId }), item.id)).status).toBe(409);
  expect((await attachment(first.eventId)).state).toBe('pending'); expect(Number((await pool.query('SELECT count(*) FROM hestia_inbox_receipt WHERE actor_id=$1 AND operation_id=$2', [actorId, operationId])).rows[0].count)).toBe(0);
  const fresh = await result(await service.handleInboxPreview(req(input), item.id)); expect(fresh.duplicates.map((duplicate: { documentId: string }) => duplicate.documentId)).toContain(created.documentId);
  const added = await result(await service.handleInboxPlace(req({ ...input, previewToken: fresh.previewToken, idempotencyKey: randomUUID() }), item.id)); expect(added.documentId).not.toBe(created.documentId);
 });
 it.each(['disappearance','rename','version','replace-right'] as const)('rejects a previously confirmed visible duplicate after %s and preserves its pending original', async mutation => {
  const targetFolder = (await result(await app.handleFolders(req({ name: `Duplicate ${randomUUID()}` })), 201)).folder.id, bytes = Buffer.from(`Duplicate change ${randomUUID()}`);
  const seed = await receive(raw('duplicate-change.bin', bytes)), seeded = await publish(await attachment(seed.eventId), 'Visible initial duplicate', targetFolder), arrival = await receive(raw('duplicate-change.bin', bytes)), item = await attachment(arrival.eventId);
  const input = { version: item.version, destination: { kind: 'existing', folderId: targetFolder }, mode: 'add', title: `Candidate ${randomUUID()}` }, preview = await result(await service.handleInboxPreview(req(input), item.id)), key = randomUUID(); expect(preview.duplicates.find((duplicate: { documentId: string }) => duplicate.documentId === seeded.documentId)).toBeTruthy();
  if (mutation === 'disappearance') await pool.query('UPDATE hestia_document SET trashed_at=$2,version=version+1 WHERE id=$1', [seeded.documentId, now]);
  else if (mutation === 'rename') await pool.query('UPDATE hestia_document SET title=$2 WHERE id=$1', [seeded.documentId, 'Visible renamed duplicate']);
  else if (mutation === 'version') await pool.query('UPDATE hestia_document SET version=version+1 WHERE id=$1', [seeded.documentId]);
  else await pool.query("UPDATE hestia_grant SET revoked_at=$3 WHERE folder_id=$1 AND user_id=$2 AND capability='modifier' AND revoked_at IS NULL", [targetFolder, actorId, now]);
  expect((await service.handleInboxPlace(req({ ...input, previewToken: preview.previewToken, idempotencyKey: key }), item.id)).status).toBe(409); expect((await attachment(arrival.eventId)).state).toBe('pending'); expect(Number((await pool.query('SELECT count(*) FROM hestia_inbox_receipt WHERE actor_id=$1 AND operation_id=$2', [actorId, key])).rows[0].count)).toBe(0);
 });
 it('does not expose or invalidate confirmation for a duplicate created in an inaccessible folder', async () => {
  const hiddenFolder = (await result(await app.handleFolders(req({ name: `Private hidden folder ${randomUUID()}` }, 'POST', otherCookie)), 201)).folder.id, bytes = Buffer.from(`Hidden duplicate ${randomUUID()}`), privateTitle = `PRIVATE_SYNTHETIC_TITLE_${randomUUID()}`;
  const otherSettings = await result(await service.handleInboxSettings(req(undefined, 'GET', otherCookie))); await result(await service.handleInboxSettings(req({ version: otherSettings.version, enabled: true }, 'PATCH', otherCookie)));
  const sender = identitySender; let hiddenArrival: Awaited<ReturnType<typeof receive>>;
  try { identitySender = otherEmail; hiddenArrival = await receive(raw('private-hidden-file.bin', bytes)); } finally { identitySender = sender; }
  const hidden = await attachment(hiddenArrival.eventId, otherCookie), arrival = await receive(raw('public-candidate.bin', bytes)), item = await attachment(arrival.eventId), input = { version: item.version, destination: { kind: 'existing', folderId }, mode: 'add', title: `Public candidate ${randomUUID()}` };
  const preview = await result(await service.handleInboxPreview(req(input), item.id)); expect(preview.duplicates).toEqual([]);
  const created = await publish(hidden, privateTitle, hiddenFolder, otherCookie), after = await result(await service.handleInboxPreview(req(input), item.id)); expect(after.duplicates).toEqual([]);
  for (const value of [preview, after]) { const text = JSON.stringify(value); expect(text).not.toContain(privateTitle); expect(text).not.toContain('private-hidden-file'); expect(text).not.toContain(hiddenFolder); expect(text).not.toContain(created.documentId); }
  expect((await service.handleInboxPlace(req({ ...input, previewToken: preview.previewToken, idempotencyKey: randomUUID() }), item.id)).status).toBe(200);
 });
 it('preserves an authenticated whole-message refusal cause for its minimal acknowledgement without claiming a zero-attachment inventory', async () => {
  const bytes = raw('synthetic-private-name.bin', Buffer.from('synthetic original'), ['Content-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n=ZZ']), delivery = await receive(bytes);
  expect(delivery.outcome).toBe('message_rejected'); const event = (await pool.query('SELECT state,rejected,excluded_inline FROM hestia_inbox_event WHERE id=$1', [delivery.eventId])).rows[0]; expect(event).toEqual({ state: 'message_rejected', rejected: [{ reason: 'invalid_html_encoding' }], excluded_inline: null });
  expect(Number((await pool.query('SELECT count(*) FROM hestia_inbox_attachment WHERE event_id=$1', [delivery.eventId])).rows[0].count)).toBe(0);
  const ack = (await pool.query('SELECT * FROM hestia_inbox_ack WHERE event_id=$1', [delivery.eventId])).rows[0]; expect(ack).toMatchObject({ state: 'pending', outcome: 'message_rejected', accepted: 0, rejected: 0 });
  const text = acknowledgementText({ id: ack.id, email: ack.email, outcome: ack.outcome, accepted: ack.accepted, rejected: ack.rejected, reasons: event.rejected.map((item: { reason: string }) => item.reason) }, config.origin);
  expect(text).toContain('refusé dans son ensemble'); expect(text).toContain('encodage invalide'); expect(text).not.toContain('Pièces refusées : 0'); expect(text).not.toContain('synthetic-private-name'); expect(text).not.toContain('Private synthetic mail');
 });
 it('scrubs terminal mail context immediately when nothing remains recoverable while retaining the minimal seven-day notice', async () => {
  const bytes = Buffer.from(raw().toString('ascii').replace('Content-Disposition: attachment;', 'Content-Disposition: inline;')), delivery = await receive(bytes); expect(delivery.outcome).toBe('no_attachments');
  const before = (await pool.query('SELECT sender,subject,context,notice_until FROM hestia_inbox_event WHERE id=$1', [delivery.eventId])).rows[0]; expect(before.context).toContain('Private mail context'); expect(before.subject).toBe('Private synthetic mail');
  await service.cleanup(); const after = (await pool.query('SELECT sender,subject,context,context_purged_at,notice_until,state FROM hestia_inbox_event WHERE id=$1', [delivery.eventId])).rows[0]; expect(after).toEqual({ sender: null, subject: null, context: null, context_purged_at: now, notice_until: before.notice_until, state: 'no_attachments' }); expect(after.notice_until.getTime()).toBe(now.getTime() + 7 * 86400000);
 });
 it('keeps an old pending attachment and its parent visible ahead of more than1000 recent notices', async () => {
  const fixture = await queueVolume({ pending: 1, notices: 1001 }), queue = await result(await service.handleInbox(req(undefined, 'GET', fixture.cookie))) as InboxQueueDto;
  expect(queue.pendingCount).toBe(1); expect(queue.attachments.map(item => item.id)).toEqual([fixture.ids[0]]); expect(queue.messages[0].id).toBe(fixture.events[0]); expect(queue.messages.length).toBe(101); coherentQueue(queue);
  const foreign = await (await service.handleInbox(req(undefined, 'GET', otherCookie))).text(); expect(foreign).not.toContain(fixture.tag); expect(foreign).not.toContain(fixture.events[0]);
 });
 it('advances FIFO beyond1000 independent pending messages after placement and discard while retaining recoverable parents', async () => {
  const fixture = await queueVolume({ pending: 1001, discarded: 1, expiredDiscarded: 1 }), read = async () => await result(await service.handleInbox(req(undefined, 'GET', fixture.cookie))) as InboxQueueDto;
  const first = await read(); coherentQueue(first); expect(first.pendingCount).toBe(1001); expect(first.attachments.filter(item => item.state === 'pending').map(item => item.id)).toEqual(fixture.ids.slice(0, 50)); expect(first.attachments.find(item => item.state === 'discarded')?.id).toBe(fixture.ids[1001]); expect(first.attachments.some(item => item.id === fixture.ids[1002])).toBe(false); expect(first.messages.some(message => message.id === fixture.events[1002])).toBe(false);
  const folder = (await result(await app.handleFolders(req({ name: `FIFO ${randomUUID()}` }, 'POST', fixture.cookie)), 201)).folder.id;
  await store.put(`queue-volume/${fixture.contents[0]}`, Buffer.from('q'), 'application/octet-stream'); await publish(first.attachments[0], 'Premier document FIFO', folder, fixture.cookie);
  const second = await read(); coherentQueue(second); expect(second.pendingCount).toBe(1000); expect(second.attachments.filter(item => item.state === 'pending').map(item => item.id)).toEqual(fixture.ids.slice(1, 51));
  const discarded = second.attachments.find(item => item.id === fixture.ids[1])!; await result(await service.handleInboxDiscard(req({ version: discarded.version, idempotencyKey: randomUUID() }, 'POST', fixture.cookie), discarded.id));
  const third = await read(); coherentQueue(third); expect(third.pendingCount).toBe(999); expect(third.attachments.filter(item => item.state === 'pending').map(item => item.id)).toEqual(fixture.ids.slice(2, 52)); expect(third.attachments.filter(item => item.state === 'discarded').map(item => item.id)).toEqual([fixture.ids[1001], fixture.ids[1]]);
  expect(Number((await pool.query("SELECT count(*) FROM hestia_inbox_attachment WHERE actor_id=$1 AND state='pending'", [fixture.owner])).rows[0].count)).toBe(999);
  // Model the remaining preceding decisions in the volume fixture, after checking the real placement/discard endpoints above.
  await pool.query("UPDATE hestia_inbox_attachment SET state='discarded',discarded_until=$2,version=version+1 WHERE id=ANY($1::uuid[])", [fixture.ids.slice(2, 1000), new Date(now.getTime() + 7 * 86400000)]);
  const tail = await read(); coherentQueue(tail); expect(tail.pendingCount).toBe(1); expect(tail.attachments.filter(item => item.state === 'pending').map(item => item.id)).toEqual([fixture.ids[1000]]); expect(tail.attachments.filter(item => item.state === 'discarded')).toHaveLength(50);
 });
 it('bounds complete Unicode queue DTOs below3MiB without truncation and keeps both oldest pending and recoverable work accessible', async () => {
  const fixture = await queueVolume({ pending: 70, discarded: 70, notices: 1001, heavy: true }); let summaryReads = 0;
  const bounded = createInboxService(pool, access, { store, budget, clock: async () => now, readSummary: async (client, id) => { summaryReads++; await client.query('SELECT content_id FROM hestia_content_summary WHERE content_id=$1', [id]); return { status: 'unavailable' }; } });
  const response = await bounded.handleInbox(req(undefined, 'GET', fixture.cookie)), text = await response.text(); expect(response.status).toBe(200); expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(3 * 1024 * 1024);
  const queue = JSON.parse(text) as InboxQueueDto; coherentQueue(queue); expect(queue.pendingCount).toBe(70); expect(queue.attachments.some(item => item.id === fixture.ids[0])).toBe(true); expect(queue.attachments.some(item => item.id === fixture.ids[70])).toBe(true); expect(queue.attachments.filter(item => item.state === 'pending').length).toBeLessThan(50); expect(summaryReads).toBeLessThanOrEqual(100);
  for (const item of queue.attachments) { expect(item.comment).toBe(fixture.comment); expect(item.analysis).toEqual(fixture.analysis); } for (const message of queue.messages) expect(message.context).toBe(fixture.context);
 });
});
