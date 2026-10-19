import { randomUUID } from 'node:crypto';
import { describe,expect,it,vi } from 'vitest';
import { createAgendaTransport } from '../../src/server/agenda/transport';
import type { ServerConfig } from '../../src/server/config';
const config:ServerConfig={environment:'dev',origin:'https://hestia.example.invalid',secret:'',databaseUrl:''};
const env={HESTIA_AGENDA_MAIL_ENABLED:'true',HESTIA_MAIL_PROVIDER:'resend',HESTIA_MAIL_FROM:'reminders@example.invalid',RESEND_API_KEY:'synthetic-only-provider-key'};
const mail=()=>({id:randomUUID(),cardId:randomUUID(),email:'member@example.invalid',title:'Sortie synthétique',date:'2026-11-15 à 15:00',bindPayload:async()=>true});
describe('agenda individual minimal transport',()=>{
  it('binds one stable minimal payload before I/O and retains its idempotency key',async()=>{
    const order:string[]=[],request=vi.fn<typeof fetch>(async()=>{order.push('network');return Response.json({id:randomUUID()});});
    const send=createAgendaTransport(config,env,request)!,message=mail();message.bindPayload=async()=>{order.push('bind');return true;};
    await send(message);await send(message);
    expect(order).toEqual(['bind','network','bind','network']);
    const first=request.mock.calls[0][1]!;expect(request.mock.calls[1][1]?.body).toBe(first.body);
    expect(first.headers).toMatchObject({'Idempotency-Key':`hestia/agenda/${message.id}`});
    const body=JSON.parse(first.body as string);expect(Object.keys(body).sort()).toEqual(['from','subject','text','to']);
    expect(body.to).toEqual([message.email]);expect(body.text).toContain(`/?agenda=${message.cardId}`);expect(body.text).toContain('(Europe/Paris)');
  });
  it('never sends locally, when disabled, before successful final binding or with invalid input',async()=>{
    const request=vi.fn<typeof fetch>();
    expect(createAgendaTransport({...config,environment:'local'},env,request)).toBeUndefined();
    expect(createAgendaTransport(config,{...env,HESTIA_AGENDA_MAIL_ENABLED:'false'},request)).toBeUndefined();
    const send=createAgendaTransport(config,env,request)!;
    await expect(send({...mail(),bindPayload:async()=>false})).rejects.toMatchObject({retryable:false});
    for(const patch of [{email:'a@example.invalid\r\nbcc:x@example.invalid'},{title:'x\nsecret'},{cardId:'foreign'},{date:'arbitrary text'}])await expect(send({...mail(),...patch})).rejects.toMatchObject({retryable:false});
    expect(request).not.toHaveBeenCalled();
  });
  it('distinguishes permanent payload conflict from bounded temporary errors without exposing provider bodies',async()=>{
    for(const [status,name,retryable]of [[409,'invalid_idempotent_request',false],[409,'concurrent_idempotent_requests',true],[429,'rate_limit_exceeded',true],[403,'validation_error',false],[503,'error',true]] as const){
      const request=vi.fn<typeof fetch>(async()=>Response.json({name,private:'never exposed'},{status,headers:{'retry-after':'99999'}}));
      await expect(createAgendaTransport(config,env,request)!(mail())).rejects.toMatchObject({retryable});
    }
    const request=vi.fn<typeof fetch>(async()=>{throw Error('private network detail');});
    await expect(createAgendaTransport(config,env,request)!(mail())).rejects.toMatchObject({retryable:true});
  });
  it('requires a bounded valid provider acceptance response',async()=>{
    for(const result of [Response.json({id:'wrong'}),new Response('x'.repeat(3000)),new Response(null)]){
      await expect(createAgendaTransport(config,env,async()=>result)!(mail())).rejects.toMatchObject({retryable:true});
    }
  });
});
