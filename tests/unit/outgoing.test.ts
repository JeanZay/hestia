import { describe, expect, it } from 'vitest';
import { outgoingCrypto } from '../../src/server/outgoing/crypto';
import { composition, normalizeAddress, outgoingJson, validateEnvelope } from '../../src/server/outgoing/validation';
import { readOutgoingDeployment } from '../../src/server/outgoing/deployment';
import type { ServerConfig } from '../../src/server/config';
const config:ServerConfig={environment:'local',origin:'http://127.0.0.1:3000',databaseUrl:'postgresql://synthetic@127.0.0.1/hestia_test_unit',secret:'synthetic-outgoing-unit-secret-at-least32'};
describe('outgoing private bounded contract',()=>{
  it('authenticates composition, associated identity and independent purposes',()=>{
    const crypto=outgoingCrypto(config.secret),value={to:['recipient@example.invalid'],subject:'Sujet',message:'Privé synthétique'};
    const packed=crypto.seal(value,'actor|draft|2|1');expect(packed).not.toContain('recipient');expect(crypto.open(packed,'actor|draft|2|1')).toEqual(value);
    expect(()=>crypto.open(packed,'other|draft|2|1')).toThrow();expect(()=>crypto.open(packed.slice(0,-4)+'AAAA','actor|draft|2|1')).toThrow();
    expect(crypto.mac('title','sample')).not.toBe(crypto.mac('payload','sample'));expect(crypto.matches('bad',crypto.mac('title','sample'))).toBe(false);
  });
  it('preserves multiline text, normalizes IDNA domains and validates the full envelope',()=>{
    const value=composition({to:['Alex@EXAMPLE.invalid'],subject:'  Sujet  ',message:'Un\r\nDeux\tfin'});
    expect(validateEnvelope(value)).toEqual({to:['Alex@example.invalid'],subject:'Sujet',message:'Un\nDeux\tfin'});
    expect(normalizeAddress('Alex@école.example')).toBe('Alex@xn--cole-9oa.example');
    for(const address of ['x\r\nBcc:a@b.invalid','Nom <x@example.invalid>','é@example.invalid','.x@example.invalid','x@-bad.invalid','x@example..invalid'])expect(()=>normalizeAddress(address)).toThrow();
  });
  it('retains incomplete draft fields but refuses oversized composition and invalid confirmed envelopes',()=>{
    expect(composition({to:[],subject:'',message:''})).toEqual({to:[],subject:'',message:''});
    expect(()=>validateEnvelope(composition({to:['not-an-email'],subject:'',message:''}))).toThrow();
    for(const value of [{to:Array(21).fill('x@example.invalid'),subject:'s',message:''},{to:[],subject:'a'.repeat(201),message:''},{to:[],subject:'s',message:'🙂'.repeat(20001)},{to:[],subject:'s',message:'bare\rcontrol'}])expect(()=>composition(value)).toThrow();
    expect(()=>validateEnvelope({to:['x@example.invalid','x@example.invalid'],subject:'s',message:''})).toThrow();
  });
  it('bounds JSON and closes unexpected sender fields before service work',async()=>{
    const request=(value:unknown)=>new Request('http://127.0.0.1:3000',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
    await expect(outgoingJson(request({from:'forged@example.invalid'}),['revision'])).rejects.toThrow();
    await expect(outgoingJson(request({message:'a'.repeat(131073)}),['message'])).rejects.toThrow();
  });
  it('cannot enable local real transport with inherited deployment configuration',()=>{
    expect(readOutgoingDeployment(config,{HESTIA_OUTGOING_ENABLED:'true',RESEND_API_KEY:'synthetic-only',HESTIA_MAIL_FROM:'fixed@example.invalid'})).toEqual({});
    expect(readOutgoingDeployment({...config,environment:'dev'},{})).toEqual({});
    expect(readOutgoingDeployment({...config,environment:'dev'},{HESTIA_OUTGOING_ENABLED:'true',HESTIA_OUTGOING_QUALIFIED_PROFILE:'{}'})).toEqual({});
  });
  it('admits only explicit qualified profiles within environment-specific ceilings',()=>{
    const profile={qualificationId:'outgoing-synthetic123',actorHour:3,actorDay:5,globalHour:5,globalDay:5,recipientHour:10,recipientDay:10};
    const env={HESTIA_OUTGOING_ENABLED:'true',HESTIA_MAIL_PROVIDER:'resend',HESTIA_MAIL_FROM:'fixed@example.invalid',RESEND_API_KEY:'synthetic-test-only',HESTIA_OUTGOING_QUALIFIED_PROFILE:JSON.stringify(profile)};
    expect(readOutgoingDeployment({...config,environment:'dev'},env).deployment).toMatchObject(profile);
    expect(readOutgoingDeployment({...config,environment:'dev'},{...env,HESTIA_OUTGOING_QUALIFIED_PROFILE:JSON.stringify({...profile,recipientDay:11})})).toEqual({});
    expect(readOutgoingDeployment({...config,environment:'production'},{...env,HESTIA_OUTGOING_QUALIFIED_PROFILE:JSON.stringify({...profile,actorHour:5,actorDay:10,recipientHour:20,recipientDay:20})}).deployment?.recipientDay).toBe(20);
    expect(readOutgoingDeployment({...config,environment:'production'},{...env,HESTIA_OUTGOING_QUALIFIED_PROFILE:JSON.stringify({...profile,globalDay:6})})).toEqual({});
  });
});
