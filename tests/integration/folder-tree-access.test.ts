import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {Pool} from 'pg';
import {createApplication} from '../../src/server/application';
import {createAccess} from '../../src/server/access';
import {createAuth} from '../../src/server/auth/options';
import {readServerConfig} from '../../src/server/config';
import {migrateDatabase} from '../../src/server/db/migrate';
import {provisionSyntheticMember} from '../../src/server/db/synthetic';
import {getFolderAccess,issueGrant} from '../../src/server/permissions/service';

describe('tree access with PostgreSQL and signed sessions',()=>{
 const config=readServerConfig();if(config.environment!=='local'||!/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname)||!/^hestia-app-[a-f0-9]{16}$/.test(process.env.HESTIA_TEST_RUN_ID??''))throw Error('Owned synthetic bench required');
 const pool=new Pool({connectionString:config.databaseUrl,max:8}),app=createApplication(pool,config),access=createAccess(pool,config,createAuth(pool,config));
 const users:{id:string;email:string;cookie:string}[]=[],password='Synthetic tree permissions phrase!';let root:string,child:string,leaf:string,sibling:string,reference:string;
 function req(body?:unknown,user=0,method?:string){return new Request(config.origin+'/api/hestia/test',{method:method??(body===undefined?'GET':'POST'),headers:{origin:config.origin,cookie:users[user]?.cookie??'',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
 async function create(parentId?:string){const r=await app.handleFolders(req({name:`Tree ${randomUUID()}`,...(parentId?{parentId}:{}),idempotencyKey:randomUUID()}));expect(r.status).toBe(201);return (await r.json()).folder.id as string;}
 async function rights(user:number,folder=leaf){return access.transaction(async c=>(await getFolderAccess(c,users[user].id,folder)).capabilities);}
 async function grant(user:number,capability:string,folder=root,authority=reference,actor=0,transmit:string[]=[]){return access.transaction(c=>issueGrant(c,users[actor].id,folder,{authorityId:authority,subject:users[user].id,capability,transmit}));}
 beforeAll(async()=>{expect((await pool.query("SELECT to_regclass('hestia_bench_marker') AS marker")).rows[0].marker).toBeTruthy();await migrateDatabase(pool,config);for(let i=0;i<4;i++){const email=`tree-access-${randomUUID()}@example.invalid`,id=await provisionSyntheticMember(pool,{email,name:`Tree reader ${i}`,password,role:'member'});users.push({id,email,cookie:''});}});
 beforeEach(async()=>{for(const u of users){await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');const r=await app.handleAuth(new Request(config.origin+'/api/auth/sign-in/email',{method:'POST',headers:{origin:config.origin,'content-type':'application/json'},body:JSON.stringify({email:u.email,password})}));expect(r.status).toBe(200);u.cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');}root=await create();child=await create(root);leaf=await create(child);sibling=await create(root);reference=(await pool.query('SELECT reference_grant_id FROM hestia_folder WHERE id=$1',[root])).rows[0].reference_grant_id;});
 afterAll(async()=>{await pool.end();});
 it('persists an inherited share as a dependent grant and loses it when its exact source is revoked',async()=>{const r=await app.handleSharing(req({memberId:users[1].id,export:true,deposit:false,idempotencyKey:randomUUID()}),child);expect(r.status).toBe(200);const rows=(await pool.query('SELECT * FROM hestia_grant WHERE folder_id=$1',[child])).rows;expect(rows).toHaveLength(2);const source=rows[0].parent_id;expect(source).toBeTruthy();expect(rows.every(g=>g.kind==='delegated'&&g.parent_id===source)).toBe(true);expect((await pool.query('SELECT folder_id FROM hestia_grant WHERE id=$1',[source])).rows[0].folder_id).toBe(root);expect(await rights(1)).toEqual(expect.arrayContaining(['consulter','exporter']));expect(await rights(1,root)).toEqual([]);await pool.query('UPDATE hestia_grant SET revoked_at=clock_timestamp() WHERE id=$1',[source]);expect(await rights(1)).toEqual([]);});
 it('restricts a capability through the subtree, blocks lower sharing bypass, and lifts only at its anchor',async()=>{await grant(1,'consulter');expect((await app.handleFolderRestriction(req({memberId:users[1].id,capabilities:['consulter'],restricted:true}),child)).status).toBe(200);expect(await rights(1)).toEqual([]);expect(await rights(1,sibling)).toEqual(['consulter']);expect((await app.handleSharing(req({memberId:users[1].id,export:false,deposit:false,idempotencyKey:randomUUID()}),leaf)).status).toBe(404);expect((await app.handleFolderRestriction(req({memberId:users[1].id,capabilities:['consulter'],restricted:false}),leaf)).status).toBe(404);expect(await rights(1)).toEqual([]);expect((await app.handleFolderRestriction(req({memberId:users[1].id,capabilities:['consulter'],restricted:false}),child)).status).toBe(200);expect(await rights(1)).toEqual(['consulter']);});
 it('invalidates delegated contributions when the issuer is restricted in a descendant',async()=>{const mandate=await grant(1,'partager',root,reference,0,['consulter','modifier']);await grant(2,'consulter',root,mandate,1);expect(await rights(2)).toEqual(['consulter']);expect((await app.handleFolderRestriction(req({memberId:users[1].id,capabilities:['partager'],restricted:true}),child)).status).toBe(200);expect(await rights(2)).toEqual([]);expect(await rights(2,sibling)).toEqual(['consulter']);});
 it('propagates an ultimate capability restriction through two different holders in SQL',async()=>{const mandate=await grant(1,'partager',child,reference,0,['consulter']);await grant(2,'consulter',leaf,mandate,1);expect(await rights(2)).toEqual(['consulter']);expect((await app.handleFolderRestriction(req({memberId:users[0].id,capabilities:['consulter'],restricted:true}),leaf)).status).toBe(200);expect(await rights(2)).toEqual([]);const options=await app.handleSharing(req(undefined,1),leaf);expect(options.status).toBe(404);expect(await rights(0,sibling)).toContain('consulter');});
 it('exposes exact four-checkbox combinations and permits access inspection to a sharer without admin',async()=>{await grant(1,'consulter');await grant(1,'partager',root,reference,0,['consulter','modifier','supprimer']);const options=await app.handleSharing(req(undefined,1),child);expect(options.status).toBe(200);const member=(await options.json()).members.find((m:{id:string})=>m.id===users[2].id);expect(member.allowedCapabilitySets).toContainEqual(['consulter','modifier','supprimer']);expect(member.allowedCapabilitySets.every((s:string[])=>!s.includes('exporter'))).toBe(true);const r=await app.handleSharing(req({memberId:users[2].id,export:false,deposit:false,modify:true,delete:true,idempotencyKey:randomUUID()},1),child);expect(r.status).toBe(200);expect(await rights(2)).toEqual(expect.arrayContaining(['consulter','modifier','supprimer']));const view=await app.handleFolderAccess(req(undefined,1),child);expect(view.status).toBe(200);expect(JSON.stringify(await view.json())).not.toContain(root);});
 it('refuses a subtree restriction with hidden affected descendants without any partial change',async()=>{await grant(1,'consulter');await grant(1,'administrer',root,reference,0,['consulter']);await pool.query('INSERT INTO hestia_folder_restriction(id,folder_id,user_id,capability,authority_grant_id,author_id) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),leaf,users[1].id,'consulter',reference,users[0].id]);const r=await app.handleFolderRestriction(req({memberId:users[2].id,capabilities:['consulter'],restricted:true},1),child);expect(r.status).toBe(404);expect((await pool.query('SELECT count(*)::int n FROM hestia_folder_restriction WHERE user_id=$1',[users[2].id])).rows[0].n).toBe(0);});
 it('refuses grant-producing writers at capacity without receipts or a global read outage',async()=>{
  const started=performance.now();let populated=started,checked=started;
  await grant(1,'consulter');const marker=`capacity-${randomUUID()}`;
  const preview=await app.handleManagementTransfer(req(),child);expect(preview.status).toBe(200);const p=await preview.json();
  const count=Number((await pool.query('SELECT count(*)::int n FROM hestia_grant')).rows[0].n);
  try{
   await pool.query(`INSERT INTO hestia_grant(id,folder_id,user_id,capability,kind,revoked_at,origin)
    SELECT gen_random_uuid(),$1,$2,'consulter','direct',clock_timestamp(),$3 FROM generate_series(1,$4::int)`,[root,users[0].id,marker,50000-count]);
   populated=performance.now();
   const key=randomUUID(),shared=await app.handleSharing(req({memberId:users[2].id,export:true,deposit:false,idempotencyKey:key}),child);
   expect(shared.status).toBe(503);expect((await shared.json()).error.code).toBe('RESOURCE_LIMIT');
   await expect(grant(2,'consulter')).rejects.toMatchObject({status:503,code:'RESOURCE_LIMIT'});
   expect((await pool.query('SELECT count(*)::int n FROM hestia_share_receipt WHERE actor_id=$1 AND idempotency_key=$2',[users[0].id,key])).rows[0].n).toBe(0);
   const operation=randomUUID();
   const transferred=await app.handleManagementTransfer(req({idempotencyKey:operation,referenceId:p.referenceId,nomineeId:users[1].id,reviewVersion:p.reviewVersion}),child);
   expect(transferred.status).toBe(503);expect((await transferred.json()).error.code).toBe('RESOURCE_LIMIT');
   expect((await pool.query('SELECT count(*)::int n FROM hestia_membership_receipt WHERE actor_id=$1 AND idempotency_key=$2',[users[0].id,operation])).rows[0].n).toBe(0);
   expect((await pool.query('SELECT count(*)::int n FROM hestia_grant')).rows[0].n).toBe(50000);
   expect(await rights(0)).toContain('consulter');expect((await pool.query('SELECT reference_grant_id FROM hestia_folder WHERE id=$1',[child])).rows[0].reference_grant_id).toBeNull();
   checked=performance.now();
  }finally{await pool.query('DELETE FROM hestia_grant WHERE origin=$1',[marker]);console.log(JSON.stringify({test:'grant capacity 50000',populationMs:Math.round(populated-started),checksMs:Math.round(Math.max(0,checked-populated)),cleanupMs:Math.round(performance.now()-Math.max(populated,checked))}));}
 // Includes inserting/removing 50,000 real rows on the single-CPU owned bench;
 // the operation/refusal assertions and all policy limits remain unchanged.
 },120000);
 it('refuses an additional restriction at capacity and retains an operable policy graph',async()=>{
  const marker=`capacity-${randomUUID()}`,ids:string[]=[];
  try{
   const count=Number((await pool.query('SELECT count(*)::int n FROM hestia_folder_restriction')).rows[0].n),needed=50000-count;
   const folders=(await pool.query(`INSERT INTO hestia_folder(id,name,name_key,created_by)
    SELECT gen_random_uuid(),$1||n::text,$1||n::text,$2 FROM generate_series(1,$3::int) n RETURNING id`,[marker,users[0].id,Math.ceil(needed/7)])).rows;
   ids.push(...folders.map(f=>String(f.id)));
   await pool.query(`INSERT INTO hestia_folder_restriction(id,folder_id,user_id,capability,authority_grant_id,author_id)
    SELECT gen_random_uuid(),f,$2,c,$3,$4 FROM unnest($1::uuid[]) f CROSS JOIN unnest(ARRAY['consulter','déposer','modifier','supprimer','partager','exporter','administrer']) c LIMIT $5`,[ids,users[2].id,reference,users[0].id,needed]);
   const r=await app.handleFolderRestriction(req({memberId:users[1].id,capabilities:['exporter'],restricted:true}),child);
   expect(r.status).toBe(503);expect((await r.json()).error.code).toBe('RESOURCE_LIMIT');
   expect((await pool.query('SELECT count(*)::int n FROM hestia_folder_restriction')).rows[0].n).toBe(50000);
   expect((await pool.query('SELECT count(*)::int n FROM hestia_folder_restriction WHERE folder_id=$1 AND user_id=$2',[child,users[1].id])).rows[0].n).toBe(0);
   expect(await rights(0)).toContain('consulter');
  }finally{if(ids.length){await pool.query('DELETE FROM hestia_folder_restriction WHERE folder_id=ANY($1::uuid[])',[ids]);await pool.query('DELETE FROM hestia_folder WHERE id=ANY($1::uuid[])',[ids]);}}
 },60000);
});
