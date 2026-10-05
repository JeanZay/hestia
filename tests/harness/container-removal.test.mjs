import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForContainerRemoval } from '../helpers/container-removal.mjs';
import { stopS3Bench } from '../helpers/s3-bench.mjs';

const runId = 'hestia-app-0123456789abcdef';
const ownedId = 'a'.repeat(64);
const otherId = 'b'.repeat(64);
function clock() {
  let time = 0;
  return { now: () => time, pause: async ms => { time += ms; }, advance: ms => { time += ms; } };
}

test('removal succeeds only when the exact name inventory becomes empty', async () => {
  const calls = [], timing = clock();
  const docker = (args, timeout) => { calls.push({ args, timeout }); return calls.length < 3 ? ownedId : ''; };
  assert.equal(await waitForContainerRemoval(docker, runId, ownedId, timing), true);
  assert.equal(calls.length, 3);
  assert.equal(timing.now(), 200);
  for (const { args, timeout } of calls) {
    assert.deepEqual(args, ['ps', '-a', '--no-trunc', '--filter', `name=^/${runId}$`, '--format', '{{.ID}}']);
    assert.ok(timeout > 0 && timeout <= 5000);
  }
  assert.deepEqual(calls.map(x => x.timeout), [5000, 4900, 4800]);
});

test('already absent resources need no stop, delay or mutation', async () => {
  const timing = clock();
  let calls = 0;
  assert.equal(await waitForContainerRemoval(args => { assert.equal(args[0], 'ps'); calls++; return ''; }, runId, null, timing), true);
  assert.equal(calls, 1);
  assert.equal(timing.now(), 0);
});

test('a resource still present at the deadline remains a failed cleanup', async () => {
  const timing = clock();
  let calls = 0;
  assert.equal(await waitForContainerRemoval(() => { calls++; return ownedId; }, runId, ownedId, timing), false);
  assert.equal(timing.now(), 5000);
  assert.equal(calls, 50);
});

test('the Docker call consumes the same deadline and late absence is not success', async () => {
  const timing = clock();
  let calls = 0;
  const docker = (_args, timeout) => {
    calls++;
    assert.equal(timeout, 5000);
    timing.advance(5001);
    return '';
  };
  assert.equal(await waitForContainerRemoval(docker, runId, ownedId, timing), false);
  assert.equal(calls, 1);
});

test('replacement IDs, duplicate matches and Docker errors never become absence', async () => {
  for (const output of [otherId, `${ownedId}\n${otherId}`, 'malformed']) {
    await assert.rejects(waitForContainerRemoval(() => output, runId, ownedId, clock()), /REMOVAL_OWNERSHIP_MISMATCH/);
  }
  await assert.rejects(waitForContainerRemoval(() => ownedId, runId, null, clock()), /REMOVAL_OWNERSHIP_MISMATCH/);
  await assert.rejects(waitForContainerRemoval(() => { throw Error('DOCKER_PS_FAILED'); }, runId, ownedId, clock()), /DOCKER_PS_FAILED/);
});

test('invalid selectors are refused before reading Docker', async () => {
  for (const [name, id] of [['.*', ownedId], [runId, 'short'], ['another-container', ownedId]]) {
    await assert.rejects(waitForContainerRemoval(() => { throw Error('UNEXPECTED_CALL'); }, name, id, clock()), /REMOVAL_OWNERSHIP_INVALID/);
  }
});

test('S3 cleanup retains ownership validation and waits after its exact stop', async () => {
  let stopped = false, afterStop = 0;
  const calls = [];
  const docker = (args, timeout) => {
    calls.push(args);
    if (args[0] === 'inspect') return JSON.stringify([{ Id: ownedId, Name: `/${runId}-s3`, Config: { Labels: { 'hestia.qualification': runId } } }]);
    if (args[0] === 'stop') { assert.deepEqual(args, ['stop', '--time', '3', ownedId]); stopped = true; return ownedId; }
    assert.equal(args[0], 'ps');
    if (!stopped) return ownedId;
    assert.ok(timeout > 0 && timeout <= 5000);
    return ++afterStop < 2 ? ownedId : '';
  };
  assert.equal(await stopS3Bench(docker, runId), true);
  assert.equal(afterStop, 2);
  assert.equal(calls.filter(x => x[0] === 'stop').length, 1);
});

test('S3 cleanup refuses an unowned container before any stop', async () => {
  let stops = 0;
  const docker = args => {
    if (args[0] === 'ps') return ownedId;
    if (args[0] === 'stop') stops++;
    return JSON.stringify([{ Id: ownedId, Name: `/${runId}-s3`, Config: { Labels: { 'hestia.qualification': 'other-run' } } }]);
  };
  await assert.rejects(stopS3Bench(docker, runId), /S3_OWNERSHIP_MISMATCH/);
  assert.equal(stops, 0);
});
