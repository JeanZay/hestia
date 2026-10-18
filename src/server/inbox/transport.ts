import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError, bodyBytes, invalid } from '../access';
import { MAX_RAW } from './mime';
export const RELAY_CHUNK = 720 * 1024;
export type InboxTick = { environment: string; actor: string; epoch: number; timestamp: number; nonce: string };
export type RelayAuthentication = { environment: string; relayActor: string; relayEpoch: number; relaySecret: string };
export function canonicalTick(value: InboxTick) { return JSON.stringify([1, 'hestia-inbox-tick', value.environment, value.actor, value.epoch, value.timestamp, value.nonce]); }
export const signTick = (value: InboxTick, secret: string) => createHmac('sha256', secret).update(canonicalTick(value)).digest('hex');
export function verifyTick(value: InboxTick, signature: string, config: RelayAuthentication, now: Date) {
 if (!value || Object.keys(value).sort().join(',') !== 'actor,environment,epoch,nonce,timestamp'
   || !['dev', 'production'].includes(value.environment) || value.environment !== config.environment || value.actor !== config.relayActor || !/^[A-Za-z0-9_-]{1,100}$/.test(value.actor)
   || !Number.isSafeInteger(value.epoch) || value.epoch < 1 || value.epoch !== config.relayEpoch || config.relaySecret.length < 32
   || !Number.isSafeInteger(value.timestamp) || Math.abs(now.getTime() - value.timestamp) > 300000 || typeof value.nonce !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(value.nonce) || !/^[a-f0-9]{64}$/.test(signature)) throw invalid();
 if (!timingSafeEqual(Buffer.from(signTick(value, config.relaySecret), 'hex'), Buffer.from(signature, 'hex'))) throw new HttpError(401, 'RELAY_AUTHENTICATION', 'Relais refusé.');
}
export function signedTickReply(value: InboxTick, result: { accepted: true }, secret: string) {
 const payload = { requestSha256: digest(canonicalTick(value)), nonce: value.nonce, result };
 return { ...payload, signature: createHmac('sha256', secret).update(JSON.stringify([1, 'hestia-inbox-tick-response', payload.requestSha256, payload.nonce, payload.result])).digest('hex') };
}
export type RelayEnvelope = { environment: string; actor: string; epoch: number; gmailId: string; rawSha256: string; rawSize: number; chunks: number; operation: 'chunk' | 'receipt' | 'process' | 'reject'; index: number; chunkSha256: string; timestamp: number; nonce: string; payload: string };
export const digest = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
export function canonicalEnvelope(v: RelayEnvelope) { return JSON.stringify([1, v.environment, v.actor, v.epoch, v.gmailId, v.rawSha256, v.rawSize, v.chunks, v.operation, v.index, v.chunkSha256, v.timestamp, v.nonce, v.payload]); }
export const signEnvelope = (value: RelayEnvelope, secret: string) => createHmac('sha256', secret).update(canonicalEnvelope(value)).digest('hex');
export function verifyEnvelope(value: RelayEnvelope, signature: string, config: { environment: string; relayActor: string; relayEpoch: number; relaySecret: string }, now: Date) {
  if (!value || Object.keys(value).sort().join(',') !== 'actor,chunkSha256,chunks,environment,epoch,gmailId,index,nonce,operation,payload,rawSha256,rawSize,timestamp'
    || value.environment !== config.environment || value.actor !== config.relayActor || value.epoch !== config.relayEpoch || !/^[A-Za-z0-9_-]{1,100}$/.test(value.actor)
    || !/^[a-fA-F0-9]{1,100}$/.test(value.gmailId) || !/^[a-f0-9]{64}$/.test(value.rawSha256) || !/^[a-f0-9]{64}$/.test(value.chunkSha256)
    || !Number.isSafeInteger(value.rawSize) || value.rawSize < 1 || value.rawSize > 100 * 1024 * 1024 || value.rawSize > MAX_RAW && value.operation !== 'reject' && !(value.operation === 'receipt' && value.chunks === 0) || value.chunks !== (value.operation === 'reject' || value.chunks === 0 && value.operation === 'receipt' ? 0 : Math.ceil(value.rawSize / RELAY_CHUNK))
    || !['chunk', 'receipt', 'process', 'reject'].includes(value.operation) || !Number.isSafeInteger(value.index) || value.index < 0 || (value.chunks ? value.index >= value.chunks : value.index !== 0)
    || !Number.isSafeInteger(value.timestamp) || Math.abs(now.getTime() - value.timestamp) > 300000 || !/^[a-zA-Z0-9_-]{16,100}$/.test(value.nonce)
    || typeof value.payload !== 'string' || value.payload.length > Math.ceil(RELAY_CHUNK / 3) * 4 || !/^[a-f0-9]{64}$/.test(signature)) throw invalid();
  const expected = signEnvelope(value, config.relaySecret); if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'))) throw new HttpError(401, 'RELAY_AUTHENTICATION', 'Relais refusé.');
  if (value.operation !== 'chunk' && value.payload !== '') throw invalid();
  // JSON transport uses canonical unwrapped base64; MIME line limits apply inside the raw message only.
  const bytes = value.operation === 'chunk' ? Buffer.from(value.payload, 'base64') : Buffer.alloc(0);
  if (value.operation === 'chunk' && (bytes.toString('base64') !== value.payload || bytes.length !== Math.min(RELAY_CHUNK, value.rawSize - value.index * RELAY_CHUNK) || digest(bytes) !== value.chunkSha256)) throw invalid();
  return bytes;
}
export async function readEnvelope(request: Request) {
  if (request.method !== 'POST' || request.headers.get('content-type') !== 'application/json') throw invalid();
  const raw = await bodyBytes(request, 1024 * 1024); let parsed: unknown;
  try { parsed = JSON.parse(raw.toString('utf8')); } catch { throw invalid(); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalid();
  return parsed as RelayEnvelope;
}
export function signedReply(envelope: RelayEnvelope, result: unknown, secret: string) {
  const requestSha256 = digest(canonicalEnvelope(envelope)), payload = { requestSha256, nonce: envelope.nonce, result };
  return { ...payload, signature: createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex') };
}
