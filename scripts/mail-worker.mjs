// One bounded invocation. Secrets arrive through the process environment only.
import { pathToFileURL } from 'node:url';

export async function invokeMailWorker(env = process.env, request = fetch) {
  try {
    const origin = new URL(env.AUTH_BASE_URL);
    if (origin.protocol !== 'https:' || origin.origin !== env.AUTH_BASE_URL
      || !env.MAIL_WORKER_SECRET || env.MAIL_WORKER_SECRET.length < 32) throw Error('CONFIG');
    const result = await request(new URL('/api/hestia/mail-worker', origin), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(55000),
      headers: { authorization: `Bearer ${env.MAIL_WORKER_SECRET}`,
        ...(env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}) },
    });
    // The response is deliberately not printed, even for proxy/provider errors.
    await result.body?.cancel();
    return { status: result.ok ? 'PASS' : 'FAILED', httpStatus: result.status };
  } catch { return { status: 'FAILED', httpStatus: null }; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = process.argv.length === 2 ? await invokeMailWorker() : { status: 'FAILED', httpStatus: null };
  console.log(JSON.stringify(result));
  process.exitCode = result.status === 'PASS' ? 0 : 1;
}
