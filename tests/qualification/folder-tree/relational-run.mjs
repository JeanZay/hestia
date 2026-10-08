// Local SQL experiment: no product schema, ambient DB credentials, ports or image pull.
import { spawnSync, spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const name = `hestia-folder-study-${randomUUID().slice(0,8)}`;
const allowed = new Set(['systemroot','windir','temp','tmp','path','pathext','comspec','userprofile','localappdata','appdata','programdata','programfiles']);
const env = Object.fromEntries(Object.entries(process.env).filter(([k])=>allowed.has(k.toLowerCase())));
function docker(args, input, acceptable=[0]) {
  const r=spawnSync('docker',args,{env,input,encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:2e6});
  if(!acceptable.includes(r.status)) throw new Error(`docker-${args[0]}-failed:${r.status}`);
  return r;
}
const inventory = () => docker(['ps','-aq','--no-trunc']).stdout.trim().split(/\s+/).filter(Boolean).sort();
const before=inventory(); let created=false; let passed=false;
const receipt={name,scope:'synthetic-isolated-experimental-postgres',at:new Date().toISOString(),network:'none',ports:[],image:null,checks:[],cleanup:false};
const psql=(sql, db='hestia_test_folder_study')=>docker(['exec','-i',name,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d',db],sql).stdout;
try {
  const image=JSON.parse(docker(['image','inspect','postgres:17-alpine','--format','{{json .Id}}']).stdout);receipt.image=image;
  docker(['run','-d','--pull=never','--name',name,'--label',`hestia.study=${name}`,'--network','none','--tmpfs','/var/lib/postgresql/data:rw','-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);created=true;
  const deadline=Date.now()+15000;
  while(docker(['exec',name,'pg_isready','-U','postgres'],undefined,[0,1,2]).status!==0){if(Date.now()>deadline)throw new Error('pg-not-ready');await new Promise(r=>setTimeout(r,200));}
  psql('CREATE DATABASE hestia_test_folder_study;', 'postgres');
  psql(readFileSync(new URL('./relational.sql',import.meta.url),'utf8'));receipt.checks.push('group-membership-deadline-rollback-receipts-legacy-names');
  // Two independent SQL connections race for one sibling name; A owns the policy lock first.
  let locked; const ready=new Promise(r=>{locked=r;});
  const a=spawn('docker',['exec','-i',name,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','hestia_test_folder_study'],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let log='';a.stdout.on('data',b=>{log+=b;if(log.includes('locked-study'))locked();});a.stderr.resume();
  const done=new Promise((resolve,reject)=>{a.on('error',reject);a.on('exit',code=>resolve(code));});
  a.stdin.end("BEGIN; SELECT pg_advisory_xact_lock(480519001); SELECT 'locked-study'; SELECT pg_sleep(1); INSERT INTO folder VALUES('race-a','root','a','Course','course',NULL); COMMIT;");
  let timer; try {await Promise.race([ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('lock-timeout')),5000);})]);} finally {clearTimeout(timer);}
  const b=docker(['exec','-i',name,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','hestia_test_folder_study'],"INSERT INTO folder VALUES('race-b','root','a','COURSE','course',NULL);",[0,3]);
  assert.equal(await done,0);assert.equal(b.status,3);assert.match(b.stderr,/name_unavailable/);
  psql("SELECT require_true((SELECT count(*)=1 FROM folder WHERE name_key='course'),'serialized-collision');");receipt.checks.push('two-connections-one-collision-winner');
  const dump=docker(['exec',name,'pg_dump','-U','postgres','--no-owner','--no-acl','hestia_test_folder_study']).stdout;
  psql('CREATE DATABASE hestia_test_folder_restored;', 'postgres');psql(dump,'hestia_test_folder_restored');
  psql("SELECT require_true((SELECT count(*)=2 FROM deletion_member WHERE group_id='old'),'restored-old-group'); SELECT require_true((SELECT object_key='immutable/object' FROM doc WHERE id='active'),'restored-object-reference'); SELECT require_true((SELECT count(*)=1 FROM receipt),'restored-receipt');",'hestia_test_folder_restored');receipt.checks.push('sql-dump-restore-structural-roundtrip');passed=true;
} finally {
  if(created){const label=docker(['inspect',name,'--format','{{index .Config.Labels "hestia.study"}}']).stdout.trim();assert.equal(label,name);docker(['rm','-f',name]);receipt.cleanup=true;}
  const after=inventory();receipt.preexistingPreserved=before.every(id=>after.includes(id));assert.ok(receipt.preexistingPreserved);
  receipt.status=passed?'PASS':'FAIL';mkdirSync('artifacts/folder-study-sql',{recursive:true});writeFileSync(`artifacts/folder-study-sql/${name}.json`,JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify(receipt));
}
