import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { inspectFile } from '../../../scripts/guard.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
// Cover committed candidate changes as well as staged/unstaged/untracked ones.
// Otherwise committing the spike would silently turn this guard into a no-op.
const base=git(['merge-base','HEAD','main']);
const changed=[...new Set([...git(['diff','--name-only',base]).split('\n'),...git(['ls-files','--others','--exclude-standard']).split('\n')].filter(Boolean))];
const allowed=p=>p.startsWith('harness/spikes/issue-2-identity/')||p==='harness/contracts/issue-2-local-qualification.json';
if(changed.some(p=>!allowed(p)))throw Error('Out-of-scope source change');
const inputs=fs.readdirSync(path.join(root,'artifacts/qualification-inputs')).map(n=>'artifacts/qualification-inputs/'+n);
const findings=[];
for(const p of [...changed,...inputs]){
  const file=path.join(root,p);if(!fs.lstatSync(file).isFile())throw Error('Not a regular source');
  const scan=inspectFile(p,fs.readFileSync(file));if(scan.binary||scan.findings.length)findings.push(p);
  if(p.endsWith('.mjs'))execFileSync(process.execPath,['--check',file],{encoding:'utf8'});
}
if(findings.length)throw Error('Source guard findings');
git(['diff','--check']);
console.log(JSON.stringify({sourceFiles:changed.length,inputFiles:inputs.length,sourceScope:'spike-and-contract-only',guardFindings:[],syntax:'PASS',productChanges:false,limits:'Recognized text patterns and syntax, not exhaustive DLP or product qualification'}));
