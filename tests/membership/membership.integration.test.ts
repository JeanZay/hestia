import { randomUUID } from 'node:crypto';
import { beforeAll,beforeEach,afterAll,describe,it,expect } from 'vitest';
import { Pool,type PoolClient } from 'pg';
import { createApplication } from '../../src/server/application';
import { createAccess } from '../../src/server/access';
import { createAuth } from '../../src/server/auth/options';
import { createMembership } from '../../src/server/membership/service';
import { readServerConfig } from '../../src/server/config';
import { migrateDatabase } from '../../src/server/db/migrate';
import { provisionSyntheticMember } from '../../src/server/db/synthetic';
import { getFolderAccess,issueGrant } from '../../src/server/permissions/service';

describe('family membership on owned real PostgreSQL',()=>{
 const config=readServerConfig();
 if(config.environment!=='local'||!/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname)||!/^hestia-app-[a-f0-9]{16}$/.test(process.env.HESTIA_TEST_RUN_ID??''))throw Error('Owned synthetic bench required');
 const pool=new Pool({connectionString:config.databaseUrl,max:8});
 const app=createApplication(pool,config),access=createAccess(pool,config,createAuth(pool,config));
 const membership=createMembership(access,{revokeIdentityArtifacts:async(client,id)=>{await client.query('DELETE FROM session WHERE "userId"=$1',[id]);await client.query('UPDATE hestia_member SET recovering=false WHERE user_id=$1',[id]);}});
 const users:{id:string;email:string;cookie:string}[]=[];const password='Synthetic membership phrase only!';let folder:string,reference:string;
 function req(body?:unknown,user=0,method?:string){return new Request(config.origin+'/api/hestia/test',{method:method??(body===undefined?'GET':'POST'),headers:{origin:config.origin,cookie:users[user]?.cookie??'',...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
 async function tx<T>(work:(c:PoolClient)=>Promise<T>){return access.transaction(work);}
 async function grant(user:number,capability='consulter',transmit:string[]=[],authority=reference,actor=0){return tx(c=>issueGrant(c,users[actor].id,folder,{authorityId:authority,subject:users[user].id,capability,transmit}));}
 async function caps(user:number){return tx(async c=>(await getFolderAccess(c,users[user].id,folder)).capabilities);}
 async function removal(user:number,actor=1){const r=await membership.handleRemovalPreview(req(undefined,actor),users[user].id);expect(r.status).toBe(200);const p=await r.json();return {idempotencyKey:randomUUID(),expectedMembershipVersion:p.target.membershipVersion,reviewVersion:p.reviewVersion};}
 async function transfer(user:number){const r=await membership.handleManagementTransfer(req(),folder);expect(r.status).toBe(200);const p=await r.json();return {idempotencyKey:randomUUID(),referenceId:p.referenceId,nomineeId:users[user].id,reviewVersion:p.reviewVersion};}
 beforeAll(async()=>{expect((await pool.query("SELECT to_regclass('hestia_bench_marker') AS marker")).rows[0].marker).toBeTruthy();await migrateDatabase(pool,config);for(let i=0;i<5;i++){const email=`membership-${randomUUID()}@example.invalid`;const id=await provisionSyntheticMember(pool,{email,name:`Membre synthétique ${i}`,password,role:i===1?'admin':'member'});users.push({id,email,cookie:''});}});
 beforeEach(async()=>{
  await pool.query("UPDATE hestia_member SET active=true,role=CASE WHEN user_id=$2 THEN 'admin' ELSE 'member' END WHERE user_id=ANY($1::text[])",[users.map(u=>u.id),users[1].id]);
  for(const u of users){await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');const r=await app.handleAuth(new Request(config.origin+'/api/auth/sign-in/email',{method:'POST',headers:{origin:config.origin,'content-type':'application/json'},body:JSON.stringify({email:u.email,password})}));expect(r.status).toBe(200);u.cookie=r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');}
  const r=await app.handleFolders(req({name:'TITRE STRICTEMENT PRIVE'}));expect(r.status).toBe(201);folder=(await r.json()).folder.id;reference=(await pool.query('SELECT reference_grant_id FROM hestia_folder WHERE id=$1',[folder])).rows[0].reference_grant_id;
 });
 afterAll(async()=>{await pool.end();});
 it('removes once, invalidates old sessions, keeps documents provenance and direct authority descendants',async()=>{
  const mandate=await grant(2,'partager',['consulter']);await grant(3,'consulter',[],mandate,2);
  const before=(await pool.query('SELECT * FROM hestia_member WHERE user_id=$1',[users[0].id])).rows[0];const input=await removal(0);
  expect((await membership.handleRemoveMember(req(input,1),users[0].id)).status).toBe(200);
  expect((await membership.handleRemoveMember(req(input,1),users[0].id)).status).toBe(200);
  const after=(await pool.query('SELECT * FROM hestia_member WHERE user_id=$1',[users[0].id])).rows[0];
  expect(after.epoch).toBe(before.epoch+1);expect(after.departure_epoch).toBe(before.departure_epoch+1);expect(BigInt(after.membership_version)).toBe(BigInt(before.membership_version)+1n);
  expect((await app.handleFolders(req())).status).toBe(401);expect(await caps(3)).toEqual(['consulter']);
  expect((await pool.query('SELECT created_by,name FROM hestia_folder WHERE id=$1',[folder])).rows[0]).toEqual({created_by:users[0].id,name:'TITRE STRICTEMENT PRIVE'});
  expect((await membership.handleRemoveMember(req({...input,expectedMembershipVersion:'999'},1),users[0].id)).status).toBe(409);
 });
 it('rejects an admin peer, ordinary actor, stale role and unknown payload',async()=>{
  expect((await membership.handleRemovalPreview(req(undefined,2),users[0].id)).status).toBe(404);
  await pool.query("UPDATE hestia_member SET role='admin' WHERE user_id=$1",[users[2].id]);expect((await membership.handleRemovalPreview(req(undefined,1),users[2].id)).status).toBe(404);
  const input=await removal(0);await pool.query("UPDATE hestia_member SET role='admin' WHERE user_id=$1",[users[0].id]);expect((await membership.handleRemoveMember(req(input,1),users[0].id)).status).toBe(404);
  expect((await membership.handleRemoveMember(req({...input,active:false},1),users[0].id)).status).toBe(400);
  expect((await membership.handleRemovalPreview(req(undefined,1),users[1].id)).status).toBe(404);
 });
 it('transfers full bounded reference once while retaining direct powers and old absolute expiry',async()=>{
  await grant(2);const expiry=new Date(Date.now()+3600000);await pool.query('UPDATE hestia_grant SET expires_at=$2 WHERE id=$1',[reference,expiry]);
  const input=await transfer(2);expect((await membership.handleManagementTransfer(req({...input,transmitCapabilities:['consulter']}),folder)).status).toBe(400);
  const first=await membership.handleManagementTransfer(req(input),folder);expect(first.status).toBe(200);const receipt=await first.json();
  expect((await membership.handleManagementTransfer(req(input),folder)).status).toBe(200);
  expect((await (await membership.handleMembershipOperation(req(),input.idempotencyKey)).json()).receipt).toEqual(receipt);
  const rows=(await pool.query("SELECT * FROM hestia_grant WHERE folder_id=$1 AND kind='reference' ORDER BY created_at",[folder])).rows;
  expect(rows).toHaveLength(2);expect(rows[0].revoked_at).not.toBeNull();expect(rows[1].replaces_reference_id).toBe(reference);expect(rows[1].transmit).toEqual(rows[0].transmit);expect(rows[1].expires_at.getTime()).toBe(expiry.getTime());
  expect(await caps(2)).toEqual(expect.arrayContaining(['consulter','administrer']));expect(await caps(0)).toContain('partager');
  expect((await pool.query("SELECT count(*)::int AS count FROM hestia_grant WHERE folder_id=$1 AND user_id=$2 AND capability='consulter'",[folder,users[2].id])).rows[0].count).toBe(1);
 });
 it('prevents choosing a disappearing reader, changing a preview, personal folders and expired history',async()=>{
  await tx(c=>c.query(`INSERT INTO hestia_grant(id,folder_id,user_id,capability,kind,parent_id,subject_epoch) VALUES($1,$2,$3,'consulter','delegated',$4,(SELECT departure_epoch FROM hestia_member WHERE user_id=$3))`,[randomUUID(),folder,users[2].id,reference]));
  const preview=await (await membership.handleManagementTransfer(req(),folder)).json();expect(preview.eligible.map((m:{id:string})=>m.id)).not.toContain(users[2].id);
  const input={idempotencyKey:randomUUID(),referenceId:reference,nomineeId:users[2].id,reviewVersion:preview.reviewVersion};expect((await membership.handleManagementTransfer(req(input),folder)).status).toBe(409);
  await grant(2);expect((await membership.handleManagementTransfer(req(input),folder)).status).toBe(409);
  await pool.query("UPDATE hestia_folder SET governance_kind='personal' WHERE id=$1",[folder]);expect((await membership.handleManagementTransfer(req(),folder)).status).toBe(404);
  await pool.query("UPDATE hestia_folder SET governance_kind='shared' WHERE id=$1",[folder]);await pool.query("UPDATE hestia_grant SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[reference]);expect((await membership.handleManagementTransfer(req(),folder)).status).toBe(404);
 });
 it('projects vacancies without a private title and nominates only surviving reader concurrently',async()=>{
  await grant(2);const input=await removal(0);expect((await membership.handleRemoveMember(req(input,1),users[0].id)).status).toBe(200);
  const response=await membership.handleUnmanagedFolders(req(undefined,1));expect(response.status).toBe(200);const raw=await response.text();expect(raw).not.toContain('TITRE STRICTEMENT PRIVE');expect(JSON.parse(raw).folders.find((f:{id:string})=>f.id===folder).canNominate).toBe(true);
  const p=await (await membership.handleSuccessionPreview(req(undefined,1),folder)).json();expect(JSON.stringify(p)).not.toContain('TITRE STRICTEMENT PRIVE');
  const command={idempotencyKey:randomUUID(),previousReferenceId:p.previousReferenceId,nomineeId:users[2].id,reviewVersion:p.reviewVersion};
  const results=await Promise.all([membership.handleNominateSuccessor(req(command,1),folder),membership.handleNominateSuccessor(req({...command,idempotencyKey:randomUUID()},1),folder)]);expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  expect((await pool.query("SELECT count(*)::int AS count FROM hestia_grant WHERE folder_id=$1 AND kind='reference' AND revoked_at IS NULL",[folder])).rows[0].count).toBe(1);
  await expect(pool.query('UPDATE hestia_grant SET revoked_at=NULL WHERE id=$1',[reference])).rejects.toMatchObject({code:'23514'});
  await expect(pool.query('UPDATE hestia_grant SET author_id=$2 WHERE id=$1',[reference,users[1].id])).rejects.toMatchObject({code:'23514'});
 });
 it('rolls removal back if identity invalidation fails, then atomically revokes actual credentials and sessions',async()=>{
  const email='membership-atomic-'+randomUUID()+'@example.invalid';
  const id=await provisionSyntheticMember(pool,{email,name:'Retrait synthétique atomique',password});
  const preview=await (await app.handleRemovalPreview(req(undefined,1),id)).json();
  const input={idempotencyKey:randomUUID(),expectedMembershipVersion:preview.target.membershipVersion,reviewVersion:preview.reviewVersion};
  const failing=createMembership(access,{revokeIdentityArtifacts:async()=>{throw Error('SYNTHETIC_FAULT');}});
  expect((await failing.handleRemoveMember(req(input,1),id)).status).toBe(503);
  expect((await pool.query('SELECT active,membership_version FROM hestia_member WHERE user_id=$1',[id])).rows[0]).toEqual({active:true,membership_version:preview.target.membershipVersion});
  expect((await app.handleRemoveMember(req(input,1),id)).status).toBe(200);
  expect((await pool.query(`SELECT password FROM account WHERE "userId"=$1 AND "providerId"='credential'`,[id])).rows.every(r=>r.password===null)).toBe(true);
  expect((await pool.query('SELECT id FROM session WHERE "userId"=$1',[id])).rowCount).toBe(0);
 });
 it('does not nominate without a surviving reader and preserves a retired identity without resurrecting grants',async()=>{
  const input=await removal(0);expect((await membership.handleRemoveMember(req(input,1),users[0].id)).status).toBe(200);
  const p=await (await membership.handleSuccessionPreview(req(undefined,1),folder)).json();expect(p.eligible).toEqual([]);
  expect((await membership.handleNominateSuccessor(req({idempotencyKey:randomUUID(),previousReferenceId:p.previousReferenceId,nomineeId:users[2].id,reviewVersion:p.reviewVersion},1),folder)).status).toBe(409);
  await pool.query("UPDATE hestia_member SET active=true,role='member' WHERE user_id=$1",[users[0].id]);expect(await caps(0)).toEqual([]);
 });
 it('refuses unattested initial provenance and does not launder it through a successor',async()=>{
  const suspectFolder=randomUUID(),suspectReference=randomUUID(),successor=randomUUID();
  await tx(async c=>{
   await c.query("INSERT INTO hestia_folder(id,name,created_by) VALUES($1,'Historique synthétique incohérent',$2)",[suspectFolder,users[0].id]);
   await c.query(`INSERT INTO hestia_grant(id,folder_id,user_id,kind,capability,transmit,origin,author_id,subject_epoch,batch_id)
    VALUES($1,$2,$3,'reference','administrer',ARRAY['consulter'],'unattested',$3,(SELECT departure_epoch FROM hestia_member WHERE user_id=$3),$2)`,[suspectReference,suspectFolder,users[0].id]);
   await c.query("UPDATE hestia_folder SET reference_grant_id=$2 WHERE id=$1",[suspectFolder,suspectReference]);
  });
  expect((await membership.handleManagementTransfer(req(),suspectFolder)).status).toBe(404);
  await tx(async c=>{
   await c.query("UPDATE hestia_grant SET revoked_at=clock_timestamp() WHERE id=$1",[suspectReference]);
   await c.query(`INSERT INTO hestia_grant(id,folder_id,user_id,kind,capability,transmit,origin,author_id,subject_epoch,replaces_reference_id)
    VALUES($1,$2,$3,'reference','administrer',ARRAY['consulter'],'reference-transfer',$3,(SELECT departure_epoch FROM hestia_member WHERE user_id=$3),$4)`,[successor,suspectFolder,users[0].id,suspectReference]);
   await c.query("UPDATE hestia_folder SET reference_grant_id=$2 WHERE id=$1",[suspectFolder,successor]);
  });
  expect((await membership.handleManagementTransfer(req(),suspectFolder)).status).toBe(404);
 });
});
