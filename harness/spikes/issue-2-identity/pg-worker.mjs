// Child process owned only by pg-protocol.test.mjs. No server and no real data.
import './pg-fence.mjs';
import pg from 'pg';
import { bootstrap, activateInvitation, consumeIntent, admitRecovery } from './pg-protocol.mjs';

let started = false;
process.on('message', async message => {
  if (message?.type !== 'run' || started) return;
  started = true;
  const pool = new pg.Pool({ ...message.config, max: 2 });
  const operations = { bootstrap, activateInvitation, consumeIntent, admitRecovery };
  try {
    if (!Object.hasOwn(operations, message.operation)) throw new Error('UNKNOWN_OPERATION');
    const checkpoint = async (phase, { pid, attempt }) => {
      if (phase === 'transaction-start') process.send({ type: 'started', pid, attempt });
      if (message.pauseAt !== phase) return;
      await new Promise(resolve => {
        const resume = input => {
          if (input?.type === 'resume') { process.off('message', resume); resolve(); }
        };
        process.on('message', resume);
        process.send({ type: 'checkpoint', phase, pid, attempt });
      });
    };
    const result = await operations[message.operation](pool, message.input, { checkpoint });
    process.send({ type: 'result', result });
  } catch (error) {
    // Whitelist codes: never echo query/config/parameters or arbitrary errors.
    const safe = ['DENIED', 'REQUEST_MISMATCH', '40001', '40P01', '55P03'];
    process.send({ type: 'failure', code: safe.includes(error.code) ? error.code : 'WORKER_FAILURE' });
  } finally {
    await pool.end();
    process.disconnect();
  }
});
