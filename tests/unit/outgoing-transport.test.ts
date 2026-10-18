import { describe, expect, it, vi } from 'vitest';
import { createOutgoingResendTransport, type OutgoingPayload } from '../../src/server/outgoing/transport';
import type { ServerConfig } from '../../src/server/config';
const id='10000000-0000-4000-8000-000000000001';
const config:ServerConfig={environment:'dev',origin:'https://hestia.example.invalid',databaseUrl:'postgresql://synthetic@localhost/hestia_test_unit',secret:'synthetic-outgoing-test-secret-long-enough'};
const payload:OutgoingPayload={from:'Hestia au nom de Camille <fixed@example.invalid>',reply_to:'member@example.invalid',to:['a@example.invalid','b@example.invalid'],subject:'Objet',text:'Texte\nSeul',attachments:[{filename:'même.pdf',content:'YQ==',content_type:'application/pdf'},{filename:'même.pdf',content:'Yg==',content_type:'application/pdf'}]};
describe('separate documentary Resend adapter with simulated fetch',()=>{
  it('passes the complete envelope unchanged and binds the stable provider identity',async()=>{
    const fetcher=vi.fn(async()=>Response.json({id})),transport=createOutgoingResendTransport(config,'synthetic-provider-test',fetcher)!;
    expect(await transport.send({id,payload:JSON.stringify(payload),signal:AbortSignal.timeout(5000)})).toEqual({status:'accepted',providerId:id});
    const [url,options]=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe('https://api.resend.com/emails');
    expect(JSON.parse(options.body as string)).toEqual(payload);expect(new Headers(options.headers).get('Idempotency-Key')).toBe('hestia/outgoing/'+id);
    expect(options.redirect).toBe('error');expect(options.signal).toBeInstanceOf(AbortSignal);
  });
  it('does not confuse certain rejection, ambiguous HTTP, network, or malformed acceptance',async()=>{
    for(const status of [408,409,429,500])expect(await createOutgoingResendTransport(config,'synthetic-test',async()=>new Response('',{status}))!.send({id,payload:'{}',signal:AbortSignal.timeout(5000)})).toEqual({status:'uncertain'});
    expect(await createOutgoingResendTransport(config,'synthetic-test',async()=>new Response('',{status:422}))!.send({id,payload:'{}',signal:AbortSignal.timeout(5000)})).toEqual({status:'rejected',code:'address'});
    for(const fetcher of [async()=>Response.json({id:'bad'}),async()=>new Response('x'.repeat(2049)),async()=>{throw new Error('private provider body');}])expect(await createOutgoingResendTransport(config,'synthetic-test',fetcher)!.send({id,payload:'{}',signal:AbortSignal.timeout(5000)})).toEqual({status:'uncertain'});
  });
  it('never constructs a real transport in local mode',()=>{expect(createOutgoingResendTransport({...config,environment:'local'},'synthetic-test')).toBeUndefined();});
});
