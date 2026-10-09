import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { Pool, type PoolClient } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { CreateBucketCommand, DeleteBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { readServerConfig } from '../../src/server/config';
import { folderNameKey } from '../../src/server/db/folder-name';
import { getFolderAccess } from '../../src/server/permissions/service';
import { CAPABILITIES } from '../../src/server/permissions/capabilities';
import { createObjectStore, storageConfigFromEnv } from '../../src/server/storage';

// A synthetic roundtrip of product policy/metadata and private object bytes.
// The exported schema is constructed here: only synthetic user stubs, no
// credentials, and empty session/outbox tables. Never dump the application schema.
describe('folder tree historical migration and synthetic recovery',()=>{
  const config=readServerConfig(),run=process.env.HESTIA_TEST_RUN_ID??'';
  if(config.environment!=='local'||!/^hestia-app-[a-f0-9]{16}$/.test(run)
    ||new URL(config.databaseUrl).hostname!=='127.0.0.1'||!/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname))throw Error('Owned synthetic bench required');
  const pool=new Pool({connectionString:config.databaseUrl});afterAll(()=>pool.end());
  const migrations=['001-folders','002-documents','003-access','004-trash','005-family-members','006-family-identity','007-mail-delivery','008-folder-tree'];
  const sql=(id:string)=>readFile(new URL(`../../src/server/db/migrations/${id}.sql`,import.meta.url),'utf8');
  async function upgradeTree(c:PoolClient){await c.query('SET CONSTRAINTS ALL IMMEDIATE');await c.query(await sql('008-folder-tree'));for(const row of (await c.query('SELECT id,name FROM hestia_folder')).rows)await c.query('UPDATE hestia_folder SET name_key=$2 WHERE id=$1',[row.id,folderNameKey(row.name)]);await c.query('ALTER TABLE hestia_folder ALTER COLUMN name_key SET NOT NULL');await c.query('SET CONSTRAINTS ALL DEFERRED');}
  async function emptySchema(c:PoolClient,schema:string,tree=false){await c.query(`CREATE SCHEMA ${schema}`);await c.query(`SET LOCAL search_path TO ${schema}`);await c.query('CREATE TABLE "user"(id text PRIMARY KEY,name text NOT NULL); CREATE TABLE session(id text PRIMARY KEY)');for(const id of migrations.slice(0,tree?7:4))await c.query(await sql(id));if(tree)await upgradeTree(c);}
  function docker(args:string[],input?:string){
    const result=spawnSync('docker',args,{input,encoding:'utf8',timeout:15000,maxBuffer:4*1024*1024,windowsHide:true});
    if(result.status!==0)throw Error('Synthetic schema dump/restore failed');
    return result.stdout;
  }
  it('preserves historical homonyms, references, immutable objects, receipt identity and current rights through a fresh restore',async()=>{
    const c=await pool.connect(),suffix=randomUUID().replaceAll('-',''),source=`tree_source_${suffix}`,restored=`tree_restore_${suffix}`;
    const root=randomUUID(),homonym=randomUUID(),child=randomUUID(),reference=randomUUID(),read=randomUUID(),expired=randomUUID(),restriction=randomUUID();
    const localReference=randomUUID(),delegation=randomUUID(),leaf=randomUUID();
    const upload=randomUUID(),document=randomUUID(),operation=randomUUID(),key=`recovery/${suffix}/original`;
    const bytes=Buffer.from('ORIGINAL ENTIEREMENT SYNTHETIQUE — recovery tree');
    const digest=createHash('sha256').update(bytes).digest('hex');
    const storageConfig=storageConfigFromEnv(),store=createObjectStore(storageConfig),bucket=`hestia-test-${run.slice('hestia-app-'.length)}-restore`;
    const transport=new S3Client({endpoint:storageConfig.endpoint,region:storageConfig.region,credentials:{accessKeyId:storageConfig.accessKeyId,secretAccessKey:storageConfig.secretAccessKey},forcePathStyle:true,maxAttempts:1});
    const restoredStore=createObjectStore({...storageConfig,bucket});let bucketCreated=false;
    try{
      await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(480519001)');await emptySchema(c,source);
      await c.query('INSERT INTO "user" VALUES(\'owner\',\'Propriétaire synthétique\'),(\'reader\',\'Lecteur synthétique\'),(\'expired\',\'Accès échu synthétique\'),(\'delegate\',\'Délégation synthétique\')');
      await c.query("INSERT INTO hestia_member(user_id,role) VALUES('owner','owner'),('reader','member'),('expired','member'),('delegate','member')");
      await c.query("INSERT INTO hestia_folder(id,name,created_by) VALUES($1,'Étage','owner'),($2,'Étage','owner')",[root,homonym]);
      await c.query(`INSERT INTO hestia_grant(id,folder_id,user_id,author_id,batch_id,capability,kind,transmit)
        VALUES($1,$2,'owner','owner',$2,'administrer','reference',$3),($4,$2,'reader','owner',NULL,'consulter','direct','{}'),($5,$2,'expired','owner',NULL,'consulter','direct','{}')`,[reference,root,[...CAPABILITIES],read,expired]);
      for(const id of migrations.slice(4,7))await c.query(await sql(id));
      const beforeFolders=(await c.query('SELECT * FROM hestia_folder ORDER BY id')).rows;
      const beforeGrants=(await c.query('SELECT * FROM hestia_grant ORDER BY id')).rows;
      await upgradeTree(c);
      const afterFolders=(await c.query('SELECT * FROM hestia_folder ORDER BY id')).rows;
      expect(afterFolders.map(({parent_folder_id,name_key,trashed_at,...f})=>{expect(parent_folder_id).toBeNull();expect(trashed_at).toBeNull();expect(name_key).toBe('étage');return f;})).toEqual(beforeFolders);
      expect((await c.query('SELECT * FROM hestia_grant ORDER BY id')).rows.map(({anchor_reference_id,...g})=>{expect(anchor_reference_id).toBeNull();return g;})).toEqual(beforeGrants);
      await c.query("INSERT INTO hestia_folder(id,name,name_key,created_by,parent_folder_id) VALUES($1,'Enfant','enfant','owner',$2)",[child,root]);
      await c.query("INSERT INTO hestia_folder_restriction(id,folder_id,user_id,capability,authority_grant_id,author_id) VALUES($1,$2,'reader','exporter',$3,'owner')",[restriction,child,reference]);
      await c.query("INSERT INTO hestia_folder_receipt(actor_id,idempotency_key,request_sha256,actor_epoch,folder_id,kind) VALUES('owner',$1,$2,0,$3,'create')",[operation,'a'.repeat(64),child]);
      await c.query(`INSERT INTO hestia_upload(id,actor_id,folder_id,owner_id,idempotency_key,identity_sha,title,file_name,media_type,size,sha256,source,status,reservation_released)
        VALUES($1,'owner',$2,'owner',$3,$4,'Original synthétique','original.txt','text/plain',$5,$4,'import','completed',true)`,[upload,child,randomUUID(),digest,bytes.length]);
      await c.query("INSERT INTO hestia_upload_object(object_key,upload_id,kind,size,sha256,ready) VALUES($1,$2,'original',$3,$4,true)",[key,upload,bytes.length,digest]);
      await c.query(`INSERT INTO hestia_document(id,folder_id,owner_id,uploaded_by,uploaded_by_name,title,file_name,media_type,size,sha256,source,object_key,preview_supported)
        VALUES($1,$2,'owner','owner','Propriétaire synthétique','Original synthétique','original.txt','text/plain',$3,$4,'import',$5,false)`,[document,child,bytes.length,digest,key]);
      expect((await getFolderAccess(c,'reader',child)).capabilities).toEqual(['consulter']);
      await c.query(`INSERT INTO hestia_grant(id,folder_id,user_id,author_id,capability,kind,transmit,origin,anchor_reference_id)
        VALUES($1,$2,'reader','owner','administrer','reference',$3,'reference-inherited-transfer',$4)`,[localReference,child,[...CAPABILITIES],reference]);
      await c.query('UPDATE hestia_folder SET reference_grant_id=$2 WHERE id=$1',[child,localReference]);
      await c.query('INSERT INTO hestia_management_cut(folder_id,source_reference_id,new_reference_id) VALUES($1,$2,$3)',[child,reference,localReference]);
      await c.query("INSERT INTO hestia_folder(id,name,name_key,created_by,parent_folder_id) VALUES($1,'Descendant','descendant','owner',$2)",[leaf,child]);
      await c.query(`INSERT INTO hestia_grant(id,folder_id,user_id,author_id,capability,kind,parent_id,origin,lineage)
        VALUES($1,$2,'delegate','reader','consulter','delegated',$3,'delegation-command',ARRAY['reader'])`,[delegation,leaf,localReference]);
      await c.query('UPDATE hestia_grant SET revoked_at=clock_timestamp() WHERE id=$1',[reference]);
      expect((await getFolderAccess(c,'delegate',leaf)).capabilities).toEqual(['consulter']);
      await c.query("UPDATE hestia_grant SET expires_at=clock_timestamp()+interval '300 milliseconds' WHERE id=$1",[expired]);
      expect((await getFolderAccess(c,'expired',child)).capabilities).toEqual(['consulter']);
      await c.query('SET CONSTRAINTS ALL IMMEDIATE');await c.query('SET CONSTRAINTS ALL DEFERRED');
      const tables=['user','hestia_member','hestia_folder','hestia_grant','hestia_folder_restriction','hestia_management_cut','hestia_folder_receipt','hestia_upload','hestia_upload_object','hestia_document'];
      const snapshot:Record<string,Record<string,unknown>[]>={};
      for(const table of tables)snapshot[table]=(await c.query(`SELECT * FROM "${table}" ORDER BY 1`)).rows;
      await c.query('COMMIT');
      const container=JSON.parse(docker(['inspect',run]))[0];
      if(container.Name!==`/${run}`||container.Config.Labels['hestia.qualification']!==run)throw Error('Synthetic container ownership mismatch');
      const database=new URL(config.databaseUrl).pathname.slice(1);
      // pg_dump restores data before post-data constraints/triggers. Replaying
      // historical anchors as new live commands is not a valid restore method.
      const dump=docker(['exec',run,'pg_dump','-U','hestia_test','-d',database,'--schema',source,'--no-owner','--no-privileges']);
      if(!dump.includes(`CREATE SCHEMA ${source}`))throw Error('Missing synthetic schema');
      docker(['exec','-i',run,'psql','-X','-v','ON_ERROR_STOP=1','-U','hestia_test','-d',database],dump.replaceAll(source,restored));
      await store.put(key,bytes,'text/plain');const savedBytes=await store.getRange(key,0,bytes.length-1);
      expect(createHash('sha256').update(savedBytes).digest('hex')).toBe(digest);
      await transport.send(new CreateBucketCommand({Bucket:bucket}));bucketCreated=true;
      await restoredStore.put(key,savedBytes,'text/plain');
      await c.query('BEGIN');await c.query(`SET LOCAL search_path TO ${restored}`);
      // Current time, never snapshot time, decides whether restored rights live.
      await new Promise(resolve=>setTimeout(resolve,350));
      expect((await getFolderAccess(c,'expired',child)).capabilities).toEqual([]);
      expect((await getFolderAccess(c,'reader',child)).capabilities.sort()).toEqual(['administrer','consulter']);
      expect((await getFolderAccess(c,'delegate',leaf)).capabilities).toEqual(['consulter']);
      for(const table of tables)expect((await c.query(`SELECT * FROM "${table}" ORDER BY 1`)).rows).toEqual(snapshot[table]);
      expect((await c.query('SELECT count(*) FROM session')).rows[0].count).toBe('0');
      const restoredBytes=await restoredStore.getRange(key,0,bytes.length-1);expect(createHash('sha256').update(restoredBytes).digest('hex')).toBe(digest);
      expect((await c.query('SELECT sum(d.size)::text AS bytes FROM hestia_document d JOIN hestia_upload_object o ON o.object_key=d.object_key WHERE o.deleted_at IS NULL')).rows[0].bytes).toBe(String(bytes.length));
    }finally{
      await c.query('ROLLBACK');
      // Only the two UUID-named schemas created by this test are removed.
      if(!/^tree_source_[a-f0-9]{32}$/.test(source)||!/^tree_restore_[a-f0-9]{32}$/.test(restored))throw Error('Invalid synthetic schema');
      await c.query(`DROP SCHEMA IF EXISTS ${restored} CASCADE; DROP SCHEMA IF EXISTS ${source} CASCADE`);c.release();
      await store.delete(key);
      if(bucketCreated){await restoredStore.delete(key);await transport.send(new DeleteBucketCommand({Bucket:bucket}));}
      transport.destroy();
    }
  });
});
