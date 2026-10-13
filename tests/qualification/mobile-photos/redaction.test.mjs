import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';

// Replace the entire HTTP context before the script loads. No network, login,
// database or existing runtime is contacted; the marker is artificial.
test('rollback transport/cleanup failures cannot print a synthetic Cookie Call log',async()=>{
  const out=path.resolve('artifacts/qualification/mobile-photos/redaction-tests',randomUUID()+'.json');
  await mkdir(path.dirname(out),{recursive:true});
  const source=`import {request} from '@playwright/test';
    request.newContext=async()=>({fetch:async()=>{const e=new Error('Call log: Cookie: SYNTHETIC_COOKIE_SENTINEL');e.name='TimeoutError';throw e;},dispose:async()=>{throw new Error('Cookie: SYNTHETIC_COOKIE_SENTINEL');}});
    process.argv=['node','rollback.mjs','--phase','prime','--out',${JSON.stringify(out)}];
    await import('./tests/qualification/mobile-photos/rollback.mjs');`;
  const env={...process.env,HESTIA_ENVIRONMENT:'local',HESTIA_TEST_RUN_ID:'hestia-app-0000000000000000',HESTIA_TEST_PASSWORD:'synthetic-only-never-transmitted'};
  for(const key of ['DEBUG','PWDEBUG','NODE_DEBUG','NODE_DEBUG_NATIVE'])delete env[key];
  const result=spawnSync(process.execPath,['--input-type=module','-e',source],{env,encoding:'utf8',timeout:10_000,windowsHide:true});
  assert.notEqual(result.status,0);
  assert.doesNotMatch(result.stdout+result.stderr,/SYNTHETIC_COOKIE_SENTINEL|Call log:/);
  assert.match(result.stderr,/Synthetic rollback context cleanup failed/);
  const receipt=JSON.parse(await readFile(out,'utf8'));
  assert.equal(receipt.status,'FAIL');assert.equal(receipt.failure,'TIMEOUT');assert.equal(receipt.cleanupFailure,'CONTEXT_DISPOSE_FAILED');
});
