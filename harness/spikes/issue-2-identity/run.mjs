import { spawnSync } from 'node:child_process';
// Explicit test environment: no inherited provider credentials or telemetry config.
const env = Object.fromEntries(['SystemRoot','WINDIR','TEMP','TMP','PATH','PATHEXT'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
env.NODE_ENV='test';env.BETTER_AUTH_TELEMETRY='false';
const files = process.argv.slice(2).length ? process.argv.slice(2) : ['identity.test.mjs','policy.test.mjs','fence.test.mjs'];
const result=spawnSync(process.execPath,['--test','--test-concurrency=1',...files],{cwd:new URL('.',import.meta.url),env,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});
process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');
if(result.error)process.stderr.write(result.error.code+'\n');
process.exitCode=result.status??1;
