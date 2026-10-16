import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { createApplication } from '../../src/server/application';
import { createAccess, HttpError } from '../../src/server/access';
import { createAuth } from '../../src/server/auth/options';
import { readServerConfig } from '../../src/server/config';
import { migrateDatabase } from '../../src/server/db/migrate';
import { provisionSyntheticMember } from '../../src/server/db/synthetic';
import { createClassificationCredentialCipher } from '../../src/server/classification/cipher';
import { createTranscriptionService } from '../../src/server/transcription/service';
import type { InboxTranscriptionIdentity, TranscriptionDependencies } from '../../src/server/transcription/types';

function wav(){const value=Buffer.alloc(32044);value.write('RIFF');value.writeUInt32LE(value.length-8,4);value.write('WAVEfmt ',8);value.writeUInt32LE(16,16);
  value.writeUInt16LE(1,20);value.writeUInt16LE(1,22);value.writeUInt32LE(16000,24);value.writeUInt32LE(32000,28);value.writeUInt16LE(2,32);value.writeUInt16LE(16,34);value.write('data',36);value.writeUInt32LE(32000,40);return value;}

describe('inbox dictation source isolation and financial SQL receipts',()=>{
  const config=readServerConfig();
  if(config.environment!=='local'||!/^\/hestia_test_[a-z0-9_]+$/.test(new URL(config.databaseUrl).pathname)||!/^hestia-app-[a-f0-9]{16}$/.test(process.env.HESTIA_TEST_RUN_ID??''))throw new Error('Owned synthetic integration bench required');
  const pool=new Pool({connectionString:config.databaseUrl,max:8}),access=createAccess(pool,config,createAuth(pool,config)),app=createApplication(pool,config);
  let actorId:string,cookie:string,identity:InboxTranscriptionIdentity,available=true,calls=0;
  let providerEffect:()=>Promise<void>=async()=>{};
  const email=`inbox-dictation-${randomUUID()}@example.invalid`,password='Synthetic inbox dictation only!';
  const deps:TranscriptionDependencies={clock:async()=>new Date(),requestTimeoutMs:2000,allowRemote:false,readAuthorizedFolders:async()=>[],
    credentialCipher:createClassificationCredentialCipher('synthetic-inbox-transcription-secret-123456789'),
    capture:{async assertAvailable(){throw new HttpError(404,'NOT_FOUND','Synthetic capture unavailable');}},
    inbox:{async assertAvailable(client,actor,id){
      if(!available||id!==identity.inboxAttachmentId||actor.id!==actorId)throw new HttpError(404,'NOT_FOUND','Synthetic arrival unavailable');
      const epoch=Number((await client.query('SELECT epoch FROM hestia_member WHERE user_id=$1',[actor.id])).rows[0].epoch);
      return {...identity,actorEpoch:epoch};
    }},
    providers:[{id:'synthetic-inbox',mode:'synthetic',label:'Synthetic',models:[{id:'test',label:'Test',vocabularySupported:false}],quote:()=>({maximumMicros:100,currency:'EUR'}),
      async transcribe(){calls++;await providerEffect();return {text:'Texte synthétique de la pièce.',actualMicros:20};}}]};
  const service=createTranscriptionService(pool,access,deps);
  function request(query:string,body?:unknown,method=body===undefined?'GET':'POST'){
    return new Request(config.origin+query,{method,headers:{origin:config.origin,cookie,...(body===undefined?{}:{'content-type':body instanceof Uint8Array?'audio/wav':'application/json'})},
      ...(body===undefined?{}:{body:body instanceof Uint8Array?new Uint8Array(body):JSON.stringify(body)})});
  }
  const transcribe=(key=randomUUID())=>service.handleTranscriptions(request(`/api/hestia/transcriptions?inboxAttachmentId=${identity.inboxAttachmentId}&idempotencyKey=${key}`,wav()));
  async function enable(){const current=(await(await service.handleTranscriptionSettings(request('/api/hestia/transcription-settings'))).json()).settings;
    expect((await service.handleTranscriptionSettings(request('/api/hestia/transcription-settings',{version:current.version,provider:'synthetic-inbox',model:'test',enabled:true,monthlyLimitMicros:1000,apiKey:'synthetic-test-key'},'PUT'))).status).toBe(200);}
  beforeAll(async()=>{
    expect((await pool.query("SELECT to_regclass('hestia_bench_marker') AS marker")).rows[0].marker).toBeTruthy();await migrateDatabase(pool,config);
    actorId=await provisionSyntheticMember(pool,{email,name:'Dictée inbox synthétique',password,role:'admin'});
  });
  beforeEach(async()=>{
    await pool.query('DELETE FROM hestia_transcription_request');await pool.query("UPDATE hestia_transcription_config SET version=1,enabled=false,provider='',model='',credential_sealed=NULL,monthly_limit_micros=0,key_set_at=NULL WHERE id=1");
    await pool.query('UPDATE "rateLimit" SET "lastRequest"=0');
    const signed=await app.handleAuth(new Request(config.origin+'/api/auth/sign-in/email',{method:'POST',headers:{origin:config.origin,'content-type':'application/json'},body:JSON.stringify({email,password})}));
    expect(signed.status).toBe(200);cookie=signed.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
    identity={inboxAttachmentId:randomUUID(),actorId,actorEpoch:0,departureEpoch:0,attachmentVersion:1,commentVersion:1};available=true;calls=0;providerEffect=async()=>{};
  });
  afterAll(()=>pool.end());
  it('rejects ambiguous or duplicate sources before buffering or reserving any audio',async()=>{
    for(const query of [`captureId=${randomUUID()}&inboxAttachmentId=${identity.inboxAttachmentId}`,`inboxAttachmentId=${identity.inboxAttachmentId}&inboxAttachmentId=${identity.inboxAttachmentId}`,'']){
      expect((await service.handleTranscriptions(request('/api/hestia/transcriptions?'+query))).status).toBe(400);
    }
    expect((await pool.query('SELECT id FROM hestia_transcription_request')).rowCount).toBe(0);expect(calls).toBe(0);
  });
  it('transcribes an unexpired-by-design inbox arrival once and keeps no transcript or private source ID in receipts',async()=>{
    await enable();const key=randomUUID();const first=await(await transcribe(key)).json();expect(first).toMatchObject({status:'complete',text:'Texte synthétique de la pièce.'});
    expect(await(await transcribe(key)).json()).toMatchObject({transcriptionId:first.transcriptionId,status:'stale'});expect(calls).toBe(1);
    const stored=(await pool.query('SELECT * FROM hestia_transcription_request')).rows;
    expect(stored).toHaveLength(1);expect(Number(stored[0].actual_micros)).toBe(20);expect(JSON.stringify(stored)).not.toContain(identity.inboxAttachmentId);expect(JSON.stringify(stored)).not.toContain(first.text);
  });
  it('discards late results after a saved comment, attachment state or departure changes while preserving the incurred cost',async()=>{
    await enable();
    for(const change of [()=>{identity={...identity,commentVersion:identity.commentVersion+1};},()=>{identity={...identity,attachmentVersion:identity.attachmentVersion+1};},()=>{identity={...identity,departureEpoch:identity.departureEpoch+1};},()=>{available=false;}]){
      available=true;providerEffect=async()=>change();const result=await(await transcribe()).json();expect(result.status).toBe('stale');expect(result.text).toBeUndefined();
    }
    expect(calls).toBe(4);expect((await pool.query('SELECT actual_micros FROM hestia_transcription_request')).rows.map(r=>Number(r.actual_micros))).toEqual([20,20,20,20]);
  });
  it('binds idempotent inbox calls to their own source and exact saved comment revision',async()=>{
    await enable();const key=randomUUID();expect((await(await transcribe(key)).json()).status).toBe('complete');
    identity={...identity,commentVersion:2};expect((await transcribe(key)).status).toBe(409);
    identity={...identity,inboxAttachmentId:randomUUID(),commentVersion:1};expect((await transcribe(key)).status).toBe(409);expect(calls).toBe(1);
  });
});
