import { invokeMailWorker } from './mail-worker.mjs';

const MAX_BODY_BYTES = 4096;
const identifier = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const exactKeys = (value, keys) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && Object.keys(value).length === keys.length
  && keys.every((key) => Object.hasOwn(value, key));
const secret = (value, minimum) => typeof value === 'string'
  && value.length >= minimum && value.length <= 4096 && /^[\x21-\x7e]+$/.test(value);
const reply = (status, state, metadata = {}) => Response.json({ status: state, ...metadata }, {
  status, headers: { 'cache-control': 'no-store' },
});

async function readEnvelope(request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) throw Error('BODY');
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw Error('BODY');
  if (!request.body) throw Error('BODY');
  const reader = request.body.getReader();
  let timer;
  try {
    const read = async () => {
      const chunks = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) throw Error('BODY');
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    };
    return await Promise.race([read(), new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('BODY')), 5000);
      timer?.unref?.();
    })]);
  } finally {
    clearTimeout(timer);
    // Cancellation cannot hold the handler open or expose a stream error.
    void reader.cancel().catch(() => {});
  }
}

function validEnvelope(body, invocationId, triggerName) {
  if (!exactKeys(body, ['version', 'invocation_id', 'trigger', 'data'])
    || body.version !== 1 || body.invocation_id !== invocationId
    || !exactKeys(body.trigger, ['type', 'id', 'name'])
    || body.trigger.type !== 'schedule' || !identifier(body.trigger.id)
    || body.trigger.name !== triggerName || !exactKeys(body.data, ['scheduled_at'])) return false;
  const date = body.data.scheduled_at;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(date)) return false;
  const parsed = new Date(date);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 19) === date.slice(0, 19);
}

// Only deploy behind the native Neon proxy: it strips client-supplied X-Neon-*.
// Matching a caller-controlled body and header alone would not authenticate it.
export async function handleMailRetry(request, env = process.env, outbound = fetch, record = () => {}) {
  try {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/mail' || url.search || url.hash) return reply(404, 'REJECTED');
    const invocationId = request.headers.get('x-neon-trigger-invocation-id');
    if (!identifier(invocationId)) return reply(401, 'REJECTED');
    if (!identifier(env.HESTIA_EXPECTED_BRANCH) || env.NEON_BRANCH !== env.HESTIA_EXPECTED_BRANCH
      || !identifier(env.HESTIA_MAIL_TRIGGER_NAME)) return reply(503, 'FAILED');
    let body;
    try { body = await readEnvelope(request); } catch { return reply(400, 'REJECTED'); }
    if (!validEnvelope(body, invocationId, env.HESTIA_MAIL_TRIGGER_NAME)) return reply(400, 'REJECTED');

    // Read only these explicit settings, after caller, branch and payload guards.
    const origin = new URL(env.AUTH_BASE_URL);
    if (origin.protocol !== 'https:' || origin.origin !== env.AUTH_BASE_URL
      || !secret(env.MAIL_WORKER_SECRET, 32) || !secret(env.VERCEL_AUTOMATION_BYPASS_SECRET, 16)) return reply(503, 'FAILED');
    const result = await invokeMailWorker({
      AUTH_BASE_URL: origin.origin,
      MAIL_WORKER_SECRET: env.MAIL_WORKER_SECRET,
      VERCEL_AUTOMATION_BYPASS_SECRET: env.VERCEL_AUTOMATION_BYPASS_SECRET,
    }, outbound);
    try {
      record({ invocationId, triggerId: body.trigger.id, scheduledAt: body.data.scheduled_at,
        status: result.status, httpStatus: result.httpStatus });
    } catch { /* A logging failure must not turn completed work into a retry. */ }
    return reply(result.status === 'PASS' ? 200 : 503, result.status, {
      httpStatus: result.httpStatus, invocation_id: invocationId, scheduled_at: body.data.scheduled_at,
    });
  } catch { return reply(503, 'FAILED'); }
}

const relay = { fetch: (request) => handleMailRetry(request, process.env, fetch,
  (metadata) => console.log(JSON.stringify(metadata))) };
export default relay;
