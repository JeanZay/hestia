// Owns only newly created labelled, in-memory test resources. No repair/reset.
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(dir,'../../..');
const image='sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73';
const id='hestia-q-'+randomBytes(8).toString('hex'),password=randomBytes(32).toString('hex');
const env={...process.env,POSTGRES_PASSWORD:password};
const docker=args=>{const r=spawnSync('docker',args,{env,encoding:'utf8',timeout:30000,maxBuffer:1024*1024});if(r.status!==0)throw Error('DOCKER_COMMAND_FAILED_'+args[0]);return r.stdout.trim();};
const inventory=()=>docker(['ps','-a','--format','{{json .}}']).split('\n').filter(Boolean).map(s=>{const x=JSON.parse(s);return{id:x.ID,name:x.Names,image:x.Image,state:x.State};}).sort((a,b)=>a.id.localeCompare(b.id));
const before=inventory(),receipt={runId:id,at:new Date().toISOString(),image,before,scope:'ephemeral-local-only',repairPerformed:false};
let network,container,exit=1;
try{
  network=docker(['network','create','--opt','com.docker.network.bridge.enable_ip_masquerade=false','--opt','com.docker.network.bridge.enable_icc=false','--label','hestia.qualification='+id,id]);
  receipt.networkId=network;
  container=docker(['run','--detach','--rm','--pull','never','--name',id,'--label','hestia.qualification='+id,'--network',network,'--memory','1536m','--cpus','1','--pids-limit','128','--publish','127.0.0.1::5432','--tmpfs','/var/lib/postgresql/data:rw,nosuid,nodev,size=1073741824','--env','POSTGRES_USER=hestia_bench','--env','POSTGRES_DB=hestia_bench','--env','POSTGRES_PASSWORD',image,'-c','shared_buffers=32MB','-c','max_connections=40']);
  receipt.containerId=container;
  const info=JSON.parse(docker(['inspect',container]))[0],bindings=info.NetworkSettings.Ports['5432/tcp'];
  const netInfo=JSON.parse(docker(['network','inspect',network]))[0];
  receipt.isolation={owned:info.Config.Labels['hestia.qualification']===id,image:info.Image,bindings,mounts:info.Mounts.map(m=>({type:m.Type,destination:m.Destination})),tmpfs:info.HostConfig.Tmpfs,networkOptions:netInfo.Options};
  if(!receipt.isolation.owned||info.Image!==image||bindings.length!==1||bindings[0].HostIp!=='127.0.0.1'||info.Mounts.some(m=>m.Type!=='tmpfs')||!info.HostConfig.Tmpfs['/var/lib/postgresql/data']||netInfo.Options['com.docker.network.bridge.enable_ip_masquerade']!=='false'||netInfo.Options['com.docker.network.bridge.enable_icc']!=='false')throw Error('ISOLATION_MISMATCH');
  const port=bindings[0].HostPort;
  let ready=false;
  for(let i=0;i<80;i++){
    const r=spawnSync('docker',['exec',container,'pg_isready','--host','127.0.0.1','-U','hestia_bench','-d','hestia_bench'],{env,encoding:'utf8',timeout:5000});
    if(r.status===0){ready=true;break;}Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);
  }
  if(!ready)throw Error('POSTGRES_NOT_READY');
  Object.assign(process.env,{HESTIA_PG_HOST:'127.0.0.1',HESTIA_PG_PORT:port,HESTIA_PG_PASSWORD:password,HESTIA_PG_RUN_ID:id});
  const {default:pg}=await import('pg');
  const pool=new pg.Pool({host:'127.0.0.1',port:Number(port),user:'hestia_bench',password,database:'hestia_bench',ssl:false,connectionTimeoutMillis:5000});
  try{
    await pool.query('CREATE TABLE hestia_bench_marker(run_id text primary key)');
    await pool.query('INSERT INTO hestia_bench_marker VALUES($1)',[id]);
    receipt.version=(await pool.query('SELECT version() v')).rows[0].v;
    receipt.settings=(await pool.query('SELECT current_setting(\'fsync\') fsync,current_setting(\'synchronous_commit\') synchronous_commit')).rows[0];
  }finally{await pool.end();}
  receipt.containerId=container;receipt.networkId=network;receipt.hostBinding='127.0.0.1';receipt.port=Number(port);receipt.storage='tmpfs-only';
  console.log(JSON.stringify({runId:id,version:receipt.version,host:'127.0.0.1',storage:receipt.storage,repairPerformed:false}));
  const requested=process.argv.slice(2),full=requested[0]==='--verify';
  if(full&&requested.length!==1)throw Error('INVALID_DRIVER_ARGUMENTS');
  const keys=['SystemRoot','WINDIR','TEMP','TMP','PATH','PATHEXT','HESTIA_PG_HOST','HESTIA_PG_PORT','HESTIA_PG_PASSWORD','HESTIA_PG_RUN_ID'];
  // Full trusted repository verifier needs its existing Git configuration; test
  // launchers independently restrict their children to the explicit allowlist.
  const childEnv=full?{...process.env}:Object.fromEntries(keys.filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  childEnv.BETTER_AUTH_TELEMETRY='false';childEnv.NODE_ENV='test';
  const r=spawnSync(process.execPath,[path.join(dir,full?'verify.mjs':'pg-run.mjs'),...(full?[]:requested)],{cwd:root,env:childEnv,encoding:'utf8',timeout:300000,maxBuffer:24000000});
  const stdout=r.stdout??'',stderr=r.stderr??'';
  // A test failure must never expose the ephemeral database password.
  process.stdout.write(stdout.replaceAll(password,'[EPHEMERAL_REDACTED]'));process.stderr.write(stderr.replaceAll(password,'[EPHEMERAL_REDACTED]'));
  exit=r.status??1;receipt.exitCode=exit;if(r.error)receipt.error=r.error.code;
}catch(error){receipt.error=/^[A-Z_]+$/.test(error.message)?error.message:'BENCH_FAILED';receipt.errorCode=/^[A-Z0-9_]{1,30}$/.test(error.code??'')?error.code:null;console.error(receipt.error,receipt.errorCode??'');}
finally{
  try{
    if(container){
      // --rm may already have removed a crashed container. A successful exact-ID
      // inventory, not a failed inspect, is the only acceptable absence proof.
      const exists=docker(['ps','-a','--no-trunc','--filter','id='+container,'--format','{{.ID}}']);
      if(exists){
        if(exists!==container)throw Error('OWNERSHIP_MISMATCH');
        const x=JSON.parse(docker(['inspect',container]))[0];
        if(x.Id!==container||x.Config.Labels['hestia.qualification']!==id)throw Error('OWNERSHIP_MISMATCH');
        docker(['stop','--time','3',container]);
      }else receipt.containerAlreadyRemoved=true;
      receipt.containerRemoved=docker(['ps','-a','--no-trunc','--filter','id='+container,'--format','{{.ID}}'])==='';
    }
    if(network){const x=JSON.parse(docker(['network','inspect',network]))[0];if(x.Id!==network||x.Labels['hestia.qualification']!==id||Object.keys(x.Containers??{}).length!==0)throw Error('OWNERSHIP_MISMATCH');docker(['network','rm',network]);receipt.networkRemoved=docker(['network','ls','--no-trunc','--filter','id='+network,'--format','{{.ID}}'])==='';}
    receipt.after=inventory();receipt.preexistingUnchanged=JSON.stringify(before)===JSON.stringify(receipt.after);
    if(!receipt.preexistingUnchanged||!receipt.containerRemoved||!receipt.networkRemoved)exit=1;
  }catch{receipt.cleanup='FAILED_REQUIRES_RECONCILIATION';exit=1;}
  receipt.finalExitCode=exit;receipt.completedAt=new Date().toISOString();
  // Runtime evidence only, bounded unique path; no credential or family data.
  const output=path.join(root,'artifacts','pg-runs',id);fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'runtime.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({runtimeReceipt:'artifacts/pg-runs/'+id+'/runtime.json',exitCode:exit,containerRemoved:receipt.containerRemoved,networkRemoved:receipt.networkRemoved,preexistingUnchanged:receipt.preexistingUnchanged}));
}
process.exitCode=exit;
