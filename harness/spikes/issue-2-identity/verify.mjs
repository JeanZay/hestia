// Bounded spike suite using the repository evidence mechanism, NOT full app QA.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runVerification } from '../../../scripts/lib/verification-run.mjs';
import { closureInputs } from '../../../scripts/lib/closure-state.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const prefix='harness/spikes/issue-2-identity/';
const inputs=fs.readdirSync(path.join(root,'artifacts/qualification-inputs')).map(n=>'artifacts/qualification-inputs/'+n);
// Repository checks retain their configured Git environment. run.mjs separately
// strips inherited credentials before importing any identity dependency.
const env={...process.env};
env.NODE_ENV='test';env.BETTER_AUTH_TELEMETRY='false';
const result=runVerification({root,inputPaths:()=>inputs,closureState:()=>closureInputs(root),env,
  steps:[
    {name:'spike-scope-syntax-guard',args:[prefix+'verify-scope.mjs']},
    {name:'contract',args:['scripts/refinement-check.mjs','--contract','harness/contracts/issue-2-local-qualification.json']},
    {name:'harness-regression',args:['--test','tests/harness/*.test.mjs']},
    {name:'identity-policy-network-bench',args:[prefix+'run.mjs']},
    {name:'closure',args:['scripts/closure.mjs','check','--action','verify']},
    {name:'postgresql-library-and-sql-model',args:[prefix+'pg-run.mjs']},
    {name:'app-ui-dev-production',args:[],required:false,skipReason:'No app implementation or design handoff; outside this local spike'},
  ],execute:args=>spawnSync(process.execPath,args,{cwd:root,env,encoding:'utf8',timeout:180000,maxBuffer:16000000,stdio:'inherit'})});
console.log(JSON.stringify({status:result.report.status,reference:result.reference,scope:'bounded-spike-only',noProductExecutionApproval:true}));
process.exitCode=result.exitCode;
