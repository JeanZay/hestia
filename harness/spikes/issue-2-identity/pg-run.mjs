import {spawnSync} from 'node:child_process';
const keys=['SystemRoot','WINDIR','TEMP','TMP','PATH','PATHEXT','HESTIA_PG_HOST','HESTIA_PG_PORT','HESTIA_PG_PASSWORD','HESTIA_PG_RUN_ID'];
const env=Object.fromEntries(keys.filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
env.NODE_ENV='test';env.BETTER_AUTH_TELEMETRY='false';
const files=process.argv.slice(2).length?process.argv.slice(2):['pg-identity.test.mjs','pg-protocol.test.mjs'];
const result=spawnSync(process.execPath,['--test','--test-concurrency=1',...files],{cwd:new URL('.',import.meta.url),env,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});
process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');
if(result.error)process.stderr.write(result.error.code+'\n');process.exitCode=result.status??1;
