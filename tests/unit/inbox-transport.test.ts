import { describe, expect, it } from 'vitest';
import { RELAY_CHUNK, canonicalEnvelope, canonicalTick, digest, signEnvelope, signTick, signedReply, signedTickReply, verifyEnvelope, verifyTick, type RelayEnvelope, type InboxTick } from '../../src/server/inbox/transport';
import { strictBase64 } from '../../src/server/inbox/mime';
const secret = 'synthetic-only-hmac-secret-for-unit-tests', now = new Date('2026-10-15T10:00:00Z');
const config = { relaySecret: secret, environment: 'dev', relayActor: 'technical-dev-stable', relayEpoch: 1 };
const envelope: RelayEnvelope = { environment: 'dev', actor: config.relayActor, epoch: 1, gmailId: 'aabb1234', rawSha256: digest('abc'), rawSize: 3, chunks: 1, operation: 'chunk', index: 0, chunkSha256: digest('abc'), timestamp: now.getTime(), nonce: 'syntheticnonce001', payload: Buffer.from('abc').toString('base64') };
describe('private relay authentication and response binding', () => {
 it('binds raw bytes and every transport identity field to one environment/epoch', () => { const signed = signEnvelope(envelope, secret); expect(verifyEnvelope(envelope, signed, config, now)).toEqual(Buffer.from('abc')); for (const field of ['environment', 'actor', 'epoch', 'gmailId', 'rawSha256', 'rawSize', 'chunks', 'operation', 'index', 'chunkSha256', 'timestamp', 'nonce', 'payload'] as const) { const changed = { ...envelope, [field]: typeof envelope[field] === 'number' ? Number(envelope[field]) + 1 : envelope[field] + 'x' }; expect(() => verifyEnvelope(changed, signed, config, now)).toThrow(); } });
 it('rejects stale requests and malformed canonical base64', () => { expect(() => verifyEnvelope(envelope, signEnvelope(envelope, secret), config, new Date(now.getTime() + 300001))).toThrow(); const invalid = { ...envelope, payload: 'YR==' }; expect(() => verifyEnvelope(invalid, signEnvelope(invalid, secret), config, now)).toThrow(); });
 it.each([747, 748, 1024, RELAY_CHUNK])('accepts the exact signed unwrapped transport bytes at size %i', size => {
  const bytes = Buffer.alloc(size, 171), input = { ...envelope, rawSize: size, rawSha256: digest(bytes), chunkSha256: digest(bytes), payload: bytes.toString('base64') };
  expect(verifyEnvelope(input, signEnvelope(input, secret), config, now)).toEqual(bytes);
  expect(() => verifyEnvelope(input, signEnvelope(input, secret + '-wrong'), config, now)).toThrow();
 });
 it.each(['YR==', 'YQ=', 'YQ===', 'YQ', 'YWJj!', 'YW Jj', 'YWJj\t', 'YWJj ', 'YWJj\n', 'YWJj\r\n'])('rejects noncanonical transport %j even when its signature, decoded size and digest match', payload => {
  const bytes = Buffer.from(payload, 'base64'), input = { ...envelope, rawSize: bytes.length, rawSha256: digest(bytes), chunkSha256: digest(bytes), payload };
  expect(() => verifyEnvelope(input, signEnvelope(input, secret), config, now)).toThrow();
 });
 it('retains transport decoded-length, digest and maximum-fragment bounds', () => {
  for (const input of [{ ...envelope, rawSize: 4 }, { ...envelope, chunkSha256: digest('xyz') }, { ...envelope, rawSize: RELAY_CHUNK + 1, chunks: 2, payload: Buffer.alloc(RELAY_CHUNK + 1).toString('base64') }]) {
   expect(() => verifyEnvelope(input, signEnvelope(input, secret), config, now)).toThrow();
  }
 });
 it('keeps MIME line-width restrictions separate from unwrapped transport', () => {
  const bytes = Buffer.alloc(748, 171), payload = bytes.toString('base64');
  expect(() => strictBase64(payload)).toThrow();
  expect(strictBase64(payload.match(/.{1,76}/g)!.join('\r\n'))).toEqual(bytes);
 });
 it('authenticates the reply for the exact request, never a detached terminal flag', () => { const reply = signedReply(envelope, { terminal: true, outcome: 'partial' }, secret); expect(reply.requestSha256).toBe(digest(canonicalEnvelope(envelope))); expect(reply.nonce).toBe(envelope.nonce); expect(reply.signature).toHaveLength(64); expect(reply.signature).not.toBe(signedReply(envelope, { terminal: false }, secret).signature); });
 it('separates heartbeat from mail envelopes, epochs and environments without accepting additional fields', () => {
  const tick: InboxTick = { environment: config.environment, actor: config.relayActor, epoch: config.relayEpoch, timestamp: now.getTime(), nonce: 'synthetic-heartbeat-nonce' }, signature = signTick(tick, secret);
  expect(() => verifyTick(tick, signature, config, now)).not.toThrow();
  expect(() => verifyTick(tick, signEnvelope(envelope, secret), config, now)).toThrow();
  for (const changed of [{ ...tick, environment: 'production' }, { ...tick, epoch: 2 }, { ...tick, actor: 'other-actor' }, { ...tick, gmailId: 'abcdef' }]) expect(() => verifyTick(changed, signature, config, now)).toThrow();
  expect(() => verifyTick(tick, signature, { ...config, relaySecret: 'too-short' }, now)).toThrow();
  expect(() => verifyTick(tick, signature, config, new Date(now.getTime() + 300001))).toThrow();
  const reply = signedTickReply(tick, { accepted: true }, secret); expect(reply.requestSha256).toBe(digest(canonicalTick(tick))); expect(reply.result).toEqual({ accepted: true }); expect(reply).not.toHaveProperty('terminal');
 });
});
