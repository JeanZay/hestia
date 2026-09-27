import './network-fence.mjs';
import { networkAttempts } from './network-fence.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import https from 'node:https';
test('Q1 network instrumentation actually refuses deliberate fetch/socket/HTTPS probes',()=>{
  assert.throws(()=>fetch('https://example.invalid'),/TEST_EGRESS_DENIED/);
  assert.throws(()=>new net.Socket().connect(443,'example.invalid'),/TEST_EGRESS_DENIED/);
  assert.throws(()=>https.request('https://example.invalid'),/TEST_EGRESS_DENIED/);
  assert.deepEqual(networkAttempts,['fetch','socket','http']);
  // Isolated test process: intentional probes are not erased or counted as
  // telemetry from the independently executing identity test process.
});
