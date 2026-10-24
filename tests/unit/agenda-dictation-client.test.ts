import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgendaDictationClient, type AgendaVoiceContext } from '../../src/components/hestia/agenda-dictation-client';

const availability={enabled:true,available:true,maxDurationMs:120000,maxAudioBytes:4194304,mediaTypes:['audio/wav'],vocabularySupported:false};
const deferred=<T>()=>{let resolve!:(value:T)=>void;return{promise:new Promise<T>(yes=>{resolve=yes;}),resolve:(value:T)=>resolve(value)};};
const response=(value:unknown,status=200,actor='actor-a')=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','X-Hestia-Actor':encodeURIComponent(actor)}});
const cleanups:(()=>void)[]=[];
afterEach(()=>{for(const cleanup of cleanups.splice(0))cleanup();vi.useRealTimers();vi.restoreAllMocks();});
async function fixture(options:{held?:ReturnType<typeof deferred<Response>>;text?:string;denied?:boolean;compatible?:boolean;disabled?:boolean;status?:number;code?:string;card?:boolean}={}){
  let context:AgendaVoiceContext={actorId:'actor-a',formSessionId:crypto.randomUUID(),cardId:options.card?crypto.randomUUID():null,revision:options.card?3:null,values:{title:'Titre clavier',description:'Avant'},versions:{title:0,description:0},editable:true,locked:false};
  const calls:{url:string;init?:RequestInit}[]=[],lost=vi.fn();
  const complete=(text=options.text??'texte dicté',field='title',overrides:Record<string,unknown>={})=>response({status:'complete',text,agenda:{formSessionId:context.formSessionId,field,cardId:context.cardId,baseRevision:context.revision,revision:context.revision,...overrides}});
  const fetcher=vi.fn<typeof fetch>(async(input,init)=>{calls.push({url:String(input),init});if(init?.method!=='POST')return response({...availability,...(options.disabled?{available:false,reason:'disabled'}:{})});if(options.held)return options.held.promise;if(options.status)return response({error:{code:options.code}},options.status);return complete(undefined,new URL(String(input),'http://synthetic.invalid').searchParams.get('field')!);});
  const recorder={start:vi.fn(async()=>{if(options.denied)throw new DOMException('Refus synthétique','NotAllowedError');}),stop:vi.fn(async()=>new Blob(['synthetic'],{type:'audio/wav'})),cancel:vi.fn()};
  const edit=(field:'title'|'description',text:string)=>{context={...context,values:{...context.values,[field]:text},versions:{...context.versions,[field]:context.versions[field]+1}};};
  const voice=new AgendaDictationClient({read:()=>context,edit,accessLost:lost},{recorder:async()=>recorder,compatible:async()=>options.compatible!==false,fetch:fetcher});
  cleanups.push(voice.connect());await vi.waitFor(()=>expect(calls.length).toBeGreaterThan(0));
  return{voice,recorder,calls,lost,edit,complete,get:()=>context,change:(patch:Partial<AgendaVoiceContext>,sync=true)=>{context={...context,...patch};if(sync)voice.synchronize();},posts:()=>calls.filter(call=>call.init?.method==='POST')};
}
describe('Agenda ephemeral dictation lifetime',()=>{
  it.each([false,true])('binds to a %s existing card without any save or context in the audio request',async card=>{
    const f=await fixture({card});await f.voice.start('title');await f.voice.stop();
    expect(f.get().values.title).toBe('Titre clavier texte dicté');expect(f.posts()).toHaveLength(1);
    const post=f.posts()[0],params=new URL(post.url,'http://synthetic.invalid').searchParams;
    expect([...params.keys()].sort()).toEqual((card?['agendaCardId','agendaFormSessionId','baseRevision','field','idempotencyKey']:['agendaFormSessionId','field','idempotencyKey']).sort());
    expect(post.init?.body).toBeInstanceOf(Blob);expect(post.init?.headers).toMatchObject({'X-Hestia-Expected-Actor':'actor-a','Content-Type':'audio/wav'});
    expect(f.calls.every(call=>call.url.startsWith('/api/hestia/transcriptions?'))).toBe(true);
    expect(f.voice.blockingErrors()).toEqual([]);
  });
  it.each(['listening','transcribing']as const)('preserves edits during %s, explicit add and safe undo',async phase=>{
    const held=deferred<Response>(),f=await fixture({held});await f.voice.start('title');
    if(phase==='listening')f.edit('title','Correction');
    const task=f.voice.stop();await vi.waitFor(()=>expect(f.posts()).toHaveLength(1));
    if(phase==='transcribing')f.edit('title','Correction');
    held.resolve(f.complete('résultat tardif'));await task;
    expect(f.get().values.title).toBe('Correction');expect(f.voice.getSnapshot().pending.title?.text).toBe('résultat tardif');expect(f.voice.blockingErrors()).toHaveLength(1);
    f.voice.editPending('title','résultat corrigé');f.voice.addPending('title');expect(f.get().values.title).toBe('Correction résultat corrigé');expect(f.voice.blockingErrors()).toEqual([]);
    f.voice.undo('title');expect(f.get().values.title).toBe('Correction');
    await f.voice.start('description');const second=f.voice.stop();held.resolve(f.complete());await second;
  });
  it('does not treat an edit then restoration as unchanged and never undoes later edits',async()=>{
    const held=deferred<Response>(),f=await fixture({held});await f.voice.start('title');const task=f.voice.stop();await vi.waitFor(()=>expect(f.posts()).toHaveLength(1));
    f.edit('title','Temporaire');f.edit('title','Titre clavier');held.resolve(f.complete());await task;
    expect(f.voice.getSnapshot().pending.title).toBeDefined();f.voice.addPending('title');f.edit('title','Modification suivante');f.voice.undo('title');expect(f.get().values.title).toBe('Modification suivante');
  });
  it('retains over-limit and rejected controls separately without cutting',async()=>{
    const f=await fixture({text:'🪁'.repeat(201)+'\u0007'});await f.voice.start('title');await f.voice.stop();
    expect(f.get().values.title).toBe('Titre clavier');expect(f.voice.getSnapshot().pending.title?.text).toBe('🪁'.repeat(201)+'\u0007');f.voice.addPending('title');expect(f.get().values.title).toBe('Titre clavier');
    f.voice.dropPending('title');expect(f.voice.blockingErrors()).toEqual([]);
  });
  it.each(['actor','form','card','revision','revocation','background']as const)('discards an uncancellable late response after %s changes',async what=>{
    const held=deferred<Response>(),f=await fixture({held,card:true});await f.voice.start('title');const result=f.complete('doit disparaître'),task=f.voice.stop();await vi.waitFor(()=>expect(f.posts()).toHaveLength(1));
    if(what==='actor')f.change({actorId:'actor-b'});if(what==='form')f.change({formSessionId:crypto.randomUUID()});if(what==='card')f.change({cardId:crypto.randomUUID()});if(what==='revision')f.change({revision:4});if(what==='revocation')f.change({editable:false});if(what==='background')f.voice.cancel(true,true);
    held.resolve(result);await task;expect(f.get().values.title).toBe('Titre clavier');expect(f.voice.getSnapshot().pending).toEqual({});expect(f.recorder.cancel).toHaveBeenCalled();
  });
  it('rejects a result bound to another field or source even with a successful HTTP status',async()=>{
    const held=deferred<Response>(),f=await fixture({held});await f.voice.start('title');const task=f.voice.stop();await vi.waitFor(()=>expect(f.posts()).toHaveLength(1));held.resolve(f.complete('mauvais','description'));await task;
    expect(f.get().values.title).toBe('Titre clavier');expect(f.voice.getSnapshot().notices.title?.title).toBe('Résultat écarté.');
  });
  it('cancels recording without a POST and allows only one field at a time',async()=>{
    const f=await fixture();await f.voice.start('title');await f.voice.start('description');expect(f.recorder.start).toHaveBeenCalledOnce();expect(f.voice.blockingErrors()).toHaveLength(1);f.voice.cancel();expect(f.posts()).toHaveLength(0);expect(f.voice.blockingErrors()).toEqual([]);
  });
  it.each([{denied:true},{compatible:false},{disabled:true}])('preserves keyboard text when unavailable: %o',async options=>{
    const f=await fixture(options);await f.voice.start('title');expect(f.posts()).toHaveLength(0);expect(f.get().values.title).toBe('Titre clavier');expect(f.voice.getSnapshot().active).toBeNull();
  });
  it.each([['TRANSCRIPTION_BUDGET',409],['FAILURE',503]]as const)('does not retry a failed or budget-limited request %s',async(code,status)=>{
    const f=await fixture({code,status});await f.voice.start('description');await f.voice.stop();expect(f.posts()).toHaveLength(1);expect(f.get().values.description).toBe('Avant');expect(f.voice.getSnapshot().active).toBeNull();if(code.includes('BUDGET'))expect(f.voice.reason()).toContain('Plafond');
  });
  it('rejects another actor before showing its successful transcription',async()=>{
    const held=deferred<Response>(),f=await fixture({held});await f.voice.start('title');const task=f.voice.stop();await vi.waitFor(()=>expect(f.posts()).toHaveLength(1));held.resolve(response({status:'complete',text:'autre compte'},200,'actor-b'));await task;
    expect(f.lost).toHaveBeenCalledOnce();expect(f.get().values.title).toBe('Titre clavier');
  });
  it('stops at two minutes with one explicit transcription and announces the last 15 seconds',async()=>{
    const f=await fixture();vi.useFakeTimers();await f.voice.start('title');await vi.advanceTimersByTimeAsync(105000);expect(f.voice.getSnapshot().announcement).toContain('15 secondes');await vi.advanceTimersByTimeAsync(15000);expect(f.posts()).toHaveLength(1);expect(f.voice.getSnapshot().active).toBeNull();
  });
});
