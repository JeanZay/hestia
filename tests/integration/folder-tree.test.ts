import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool, type PoolClient } from 'pg';
import { createApplication } from '../../src/server/application';
import { readServerConfig } from '../../src/server/config';
import { migrateDatabase } from '../../src/server/db/migrate';
import { provisionSyntheticMember } from '../../src/server/db/synthetic';
import { issueGrant, getFolderAccess, POLICY_LOCK_KEY } from '../../src/server/permissions/service';

describe('folder tree HTTP transactions and private navigation',()=>{
  const config=readServerConfig();
  if(config.environment!=='local'||!/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname)
    || !/^hestia-app-[a-f0-9]{16}$/.test(process.env.HESTIA_TEST_RUN_ID??''))throw Error('Owned synthetic bench required');
  const pool=new Pool({connectionString:config.databaseUrl,max:8}), app=createApplication(pool,config);
  const users:{id:string;email:string;cookie:string}[]=[];
  const password='Synthetic folder tree phrase!';
  let root:string,reference:string;
  function req(path:string,body?:unknown,user=0,method?:string){return new Request(config.origin+path,{method:method??(body===undefined?'GET':'POST'),headers:{origin:config.origin,cookie:users[user]?.cookie??'',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
  async function tx<T>(action:(c:PoolClient)=>Promise<T>){const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock($1)',[POLICY_LOCK_KEY]);const x=await action(c);await c.query('COMMIT');return x;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  const create=(name:string,parentId:string|null=root,user=0,idempotencyKey=randomUUID())=>app.handleFolders(req('/api/hestia/folders',{name,parentId,idempotencyKey},user));
  const list=(user=0)=>app.handleFolders(req('/api/hestia/folders',undefined,user));
  const detail=(id:string,user=0)=>app.handleFolder(req(`/api/hestia/folders/${id}`,undefined,user),id);
  async function child(name='Enfant',parent=root,user=0){const r=await create(name,parent,user);expect(r.status).toBe(201);return (await r.json()).folder as {id:string;name:string;version:number;capabilities:string[]};}
  async function grant(user:number,capability:string,folder=root){return tx(c=>issueGrant(c,users[0].id,folder,{authorityId:reference,subject:users[user].id,capability}));}
  beforeAll(async()=>{
    expect((await pool.query("SELECT to_regclass('hestia_bench_marker') AS marker")).rows[0].marker).toBeTruthy();
    await migrateDatabase(pool,config);
    for(let n=0;n<3;n++){const email=`tree-${randomUUID()}@example.invalid`;users.push({email,id:await provisionSyntheticMember(pool,{email,name:`Arbre synthétique ${n}`,password,role:n===2?'admin':'member'}),cookie:''});}
  });
  beforeEach(async()=>{
    for(const user of users){await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');const r=await app.handleAuth(req('/api/auth/sign-in/email',{email:user.email,password}));expect(r.status).toBe(200);user.cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');}
    const r=await create(`Racine privée ${randomUUID()}`,null);expect(r.status).toBe(201);root=(await r.json()).folder.id;
    reference=(await pool.query('SELECT reference_grant_id FROM hestia_folder WHERE id=$1',[root])).rows[0].reference_grant_id;
  });
  afterAll(async()=>{await pool.end();});
  it('creates children through parent rights without any grant or manager minted to their creator',async()=>{
    const read=await grant(1,'consulter');await grant(1,'modifier');
    const made=await child('Créé par un autre membre',root,1);
    expect(made.capabilities.sort()).toEqual(['consulter','modifier']);
    const row=(await pool.query('SELECT parent_folder_id,created_by,reference_grant_id FROM hestia_folder WHERE id=$1',[made.id])).rows[0];
    expect(row).toEqual({parent_folder_id:root,created_by:users[1].id,reference_grant_id:null});
    expect((await pool.query('SELECT id FROM hestia_grant WHERE folder_id=$1',[made.id])).rowCount).toBe(0);
    await pool.query('UPDATE hestia_grant SET revoked_at=clock_timestamp() WHERE id=$1',[read]);
    expect((await detail(made.id,1)).status).toBe(404);
    expect((await create('Interdit',made.id,1)).status).toBe(404);
    expect((await detail(made.id,2)).status).toBe(404);
  });
  it('refuses creation with only consulter and disallows a fake parent or forged authority',async()=>{
    await grant(1,'consulter');
    const before=(await pool.query('SELECT count(*) FROM hestia_folder')).rows[0].count;
    for(const parent of [root,randomUUID()])expect((await create('Impossible',parent,1)).status).toBe(404);
    expect((await app.handleFolders(req('/api/hestia/folders',{name:'Impossible',parentId:root,capabilities:['administrer']},1))).status).toBe(400);
    expect((await pool.query('SELECT count(*) FROM hestia_folder')).rows[0].count).toBe(before);
  });
  it('returns only contiguous visible ancestors and visible direct child counts',async()=>{
    const branch=await child('SECRET ANCESTOR'), leaf=await child('Partagé seul',branch.id);
    await grant(1,'consulter',leaf.id);
    const hidden=await (await list(1)).json();
    const entry=hidden.folders.find((f:{id:string})=>f.id===leaf.id);
    expect(entry).toMatchObject({visibleParentId:null,breadcrumbs:[{id:leaf.id,name:'Partagé seul'}],childCount:0});
    expect(JSON.stringify(hidden)).not.toContain('SECRET ANCESTOR');expect(JSON.stringify(hidden)).not.toContain(branch.id);expect(JSON.stringify(hidden)).not.toContain(root);
    const full=(await (await detail(root)).json()).folder;
    expect(full.childCount).toBe(1);
    expect((await (await detail(leaf.id)).json()).folder.breadcrumbs.map((f:{id:string})=>f.id)).toEqual([root,branch.id,leaf.id]);
  });
  it('normalizes sibling names while keeping accents and branches distinct',async()=>{
    await child('  Étage  ');
    expect((await create('e\u0301TAGE')).status).toBe(409);
    expect((await create('Etage')).status).toBe(201);
    const sibling=await child('Autre branche');
    expect((await create('Étage',sibling.id)).status).toBe(201);
    expect((await create('Deux  espaces')).status).toBe(201);
    expect((await create('Deux espaces')).status).toBe(201);
    const rootName=`Même racine ${randomUUID()}`;
    expect((await create(rootName,null,0)).status).toBe(201);expect((await create(rootName,null,1)).status).toBe(201);
    expect((await create(rootName.toUpperCase(),null,0)).status).toBe(409);
  });
  it('serializes a collision across independent connections with no partial grant or receipt',async()=>{
    const results=await Promise.all([create('Concurrent'),create(' concurrent ')]);
    expect(results.map(r=>r.status).sort()).toEqual([201,409]);
    const rows=(await pool.query('SELECT id FROM hestia_folder WHERE parent_folder_id=$1 AND name_key=$2',[root,'concurrent'])).rows;
    expect(rows).toHaveLength(1);
    expect((await pool.query('SELECT id FROM hestia_grant WHERE folder_id=$1',[rows[0].id])).rowCount).toBe(0);
    expect((await pool.query('SELECT folder_id FROM hestia_folder_receipt WHERE folder_id=$1',[rows[0].id])).rowCount).toBe(1);
  });
  it('reconciles a lost creation response by operation identity and never by matching name',async()=>{
    const key=randomUUID(),name='Réponse perdue';
    const first=await create(name,root,0,key);expect(first.status).toBe(201);const id=(await first.json()).folder.id;
    const check=await app.handleFolderOperation(req(`/api/hestia/folder-operations/${key}`,{kind:'create',name,parentId:root}),key);
    expect(check.status).toBe(200);expect(await check.json()).toMatchObject({status:'committed',folder:{id}});
    expect((await (await create(name,root,0,key)).json()).folder.id).toBe(id);
    expect((await create('Corps différent',root,0,key)).status).toBe(409);
    expect((await pool.query('SELECT id FROM hestia_folder WHERE parent_folder_id=$1 AND name=$2',[root,name])).rowCount).toBe(1);
    expect(await (await app.handleFolderOperation(req(`/api/hestia/folder-operations/${key}`,{kind:'create',name,parentId:root},1),key)).json()).toEqual({status:'not-recorded'});
  });
  it('reconciles a rename once, preserves versions and prevents receipt disclosure after access withdrawal',async()=>{
    await grant(1,'consulter');await grant(1,'modifier');const made=await child('Avant');const key=randomUUID();
    const rename=()=>app.handleFolder(req(`/api/hestia/folders/${made.id}`,{name:'Après',version:1,idempotencyKey:key},1,'PATCH'),made.id);
    expect((await rename()).status).toBe(200);expect((await rename()).status).toBe(200);
    expect((await pool.query('SELECT name,version FROM hestia_folder WHERE id=$1',[made.id])).rows[0]).toEqual({name:'Après',version:2});
    await pool.query('UPDATE hestia_grant SET revoked_at=clock_timestamp() WHERE folder_id=$1 AND user_id=$2',[root,users[1].id]);
    const result=await app.handleFolderOperation(req(`/api/hestia/folder-operations/${key}`,{kind:'rename',name:'Après',folderId:made.id,version:1},1),key);
    expect(result.status).toBe(404);expect(JSON.stringify(await result.json())).not.toContain('Après');
  });
  it('rolls back the folder if its durable receipt fails',async()=>{
    await pool.query(`CREATE FUNCTION hestia_test_tree_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF EXISTS(SELECT 1 FROM hestia_folder WHERE id=NEW.folder_id AND name='Receipt rollback') THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER hestia_test_tree_failure BEFORE INSERT ON hestia_folder_receipt FOR EACH ROW EXECUTE FUNCTION hestia_test_tree_failure()`);
    try{expect((await create('Receipt rollback')).status).toBe(503);expect((await pool.query('SELECT id FROM hestia_folder WHERE name=$1',['Receipt rollback'])).rowCount).toBe(0);}
    finally{await pool.query('DROP TRIGGER hestia_test_tree_failure ON hestia_folder_receipt; DROP FUNCTION hestia_test_tree_failure()');}
  });
  it('keeps a deep hierarchy readable without adding per-level authority',async()=>{
    const started=performance.now();let id=root;const ids=[id];for(let i=0;i<18;i++){id=(await child(`Niveau ${i}`,id)).id;ids.push(id);}
    expect((await (await detail(id)).json()).folder.breadcrumbs.map((f:{id:string})=>f.id)).toEqual(ids);
    expect((await tx(c=>getFolderAccess(c,users[0].id,id))).capabilities).toContain('modifier');
    expect((await pool.query('SELECT id FROM hestia_grant WHERE folder_id=ANY($1::uuid[])',[ids.slice(1)])).rowCount).toBe(0);
    console.log(JSON.stringify({test:'tree depth 18 create and read',durationMs:Math.round(performance.now()-started)}));
  });
  it('rolls back creation at the graph resource boundary and refuses an oversized inventory without partial data',async()=>{
    const prefix=`Budget ${randomUUID()} `,key=randomUUID();
    const count=Number((await pool.query('SELECT count(*) FROM hestia_folder')).rows[0].count);
    const beforeReceipts=(await pool.query('SELECT count(*) FROM hestia_folder_receipt')).rows[0].count;
    try{
      await pool.query(`INSERT INTO hestia_folder(id,name,name_key,created_by,parent_folder_id)
        SELECT gen_random_uuid(),$1||i,$1||i,$2,$3 FROM generate_series(1,$4::int) i`,[prefix,users[0].id,root,10000-count]);
      const started=performance.now(),result=await create('Dépassement atomique',root,0,key);
      expect(result.status).toBe(503);expect(await result.json()).toMatchObject({error:{code:'RESOURCE_LIMIT'}});
      expect((await pool.query('SELECT count(*) FROM hestia_folder')).rows[0].count).toBe('10000');
      expect((await pool.query('SELECT count(*) FROM hestia_folder_receipt')).rows[0].count).toBe(beforeReceipts);
      expect((await pool.query('SELECT id FROM hestia_folder WHERE name=$1',['Dépassement atomique'])).rowCount).toBe(0);
      await pool.query('INSERT INTO hestia_folder(id,name,name_key,created_by,parent_folder_id) VALUES($1,$2,$2,$3,$4)',[randomUUID(),prefix+'extra',users[0].id,root]);
      const inventory=await list();expect(inventory.status).toBe(503);expect(await inventory.json()).toMatchObject({error:{code:'RESOURCE_LIMIT'}});
      console.log(JSON.stringify({test:'tree resource boundary',folders:10001,refusalAndRollbackMs:Math.round(performance.now()-started)}));
    }finally{await pool.query('DELETE FROM hestia_folder WHERE name LIKE $1',[prefix+'%']);}
  });
});
