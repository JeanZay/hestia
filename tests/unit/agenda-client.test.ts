import {describe,it,expect,vi} from 'vitest';
import {AgendaError,AgendaTransport,agendaWhen,cardFields,comparisonRows,emptyAgendaFields,reminderPreview,uploadAgendaDocument} from '../../src/components/hestia/agenda-client';
import type {AgendaCard} from '../../src/shared/agenda-contract';

const card=(revision=1):AgendaCard=>({...emptyAgendaFields('2027-10-31'),startTime:'02:30',startFold:'first',id:'card-a',title:'Sortie synthétique',revision,creator:{id:'author',name:'Camille',departed:false},canManage:true,archived:false,audience:{mode:'all',summary:'household'},documents:[],reminders:[],reminderSummary:{count:0,receives:false},createdAt:'2026-10-19T00:00:00Z',updatedAt:'2026-10-19T00:00:00Z'});
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
describe('Agenda transport, retained input and time previews',()=>{
  it('binds browser fetch to globalThis, never to the transport instance',async()=>{
    const fetcher=function(this:unknown){expect(this).toBe(globalThis);return Promise.resolve(response({cards:[]}));} as typeof fetch;
    const client=new AgendaTransport(vi.fn(),fetcher);await expect(client.request('/agenda')).resolves.toEqual({cards:[]});client.dispose();
  });
  it('rechecks the actual revision at the FINAL take-server click and refuses a third change',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(response({card:card(3)}));const client=new AgendaTransport(vi.fn(),fetcher);
    await expect(client.takeCurrent('card-a',2)).rejects.toMatchObject({status:409,code:'AGENDA_CONFLICT'});
    expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0][1]?.method).toBe('GET');client.dispose();
  });
  it('does not replace input when current authorization has become read-only',async()=>{
    const client=new AgendaTransport(vi.fn(),vi.fn<typeof fetch>().mockResolvedValue(response({card:{...card(),canManage:false}})));
    await expect(client.takeCurrent('card-a',1)).rejects.toMatchObject({status:403});client.dispose();
  });
  it('ignores a late response even when its fake network ignores aborted signals',async()=>{
    let resolve!:(value:Response)=>void;const deferred=new Promise<Response>(yes=>{resolve=yes;});const client=new AgendaTransport(vi.fn(),vi.fn<typeof fetch>().mockReturnValue(deferred));
    const read=client.request('/agenda');const check=expect(read).rejects.toMatchObject({name:'AbortError'});client.dispose();resolve(response({cards:[card()]}));await check;
  });
  it('clears the authenticated UI on 401 and uses private, uncached same-origin reads',async()=>{
    const lost=vi.fn(),fetcher=vi.fn<typeof fetch>().mockResolvedValue(response({error:{code:'AUTH_REQUIRED',message:'Reconnectez-vous.'}},401));const client=new AgendaTransport(lost,fetcher);
    await expect(client.request('/agenda')).rejects.toBeInstanceOf(AgendaError);expect(lost).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0][1]).toMatchObject({credentials:'same-origin',cache:'no-store',headers:{'X-Hestia-Activity':'interactive'}});client.dispose();
  });
  it('rejects another authenticated actor before exposing a successful or conflicting projection',async()=>{
    const lost=vi.fn(),value=response({card:card()});value.headers.set('X-Hestia-Actor',encodeURIComponent('other-actor'));
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(value),client=new AgendaTransport(lost,fetcher,'camille');
    await expect(client.request('/agenda/card-a')).rejects.toMatchObject({code:'ACTOR_CHANGED'});expect(lost).toHaveBeenCalledOnce();expect(client.signal.aborted).toBe(true);
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({'X-Hestia-Expected-Actor':'camille'});
  });
  it('fails closed on an actor-less success but allows a non-private pre-auth validation error',async()=>{
    const client=new AgendaTransport(vi.fn(),vi.fn<typeof fetch>().mockResolvedValue(response({card:card()})),'camille');await expect(client.request('/agenda/card-a')).rejects.toMatchObject({code:'ACTOR_CHANGED'});
    const invalid=new AgendaTransport(vi.fn(),vi.fn<typeof fetch>().mockResolvedValue(response({error:{code:'INVALID_INPUT',message:'Filtres invalides.'}},400)),'camille');await expect(invalid.request('/agenda?invalid=1')).rejects.toMatchObject({status:400,code:'INVALID_INPUT'});invalid.dispose();
  });
  it('replays a lost mutation with the same immutable request and reads a receipt without resubmitting',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('lost')).mockResolvedValueOnce(response({requestId:'stable',status:'not-recorded'})).mockResolvedValueOnce(response({card:card(2),operation:{requestId:'stable',status:'committed',cardId:'card-a',revision:2}}));
    const client=new AgendaTransport(vi.fn(),fetcher),payload={...emptyAgendaFields(),title:'Idée',requestId:'stable',revision:0};
    await expect(client.save(null,payload)).rejects.toThrow('lost');expect(await client.verify('stable')).toMatchObject({status:'not-recorded'});await client.save(null,payload);
    expect(fetcher.mock.calls.map(([,init])=>init?.method)).toEqual(['POST','GET','POST']);expect(fetcher.mock.calls[0][1]?.body).toBe(fetcher.mock.calls[2][1]?.body);client.dispose();
  });
  it('keeps unavailable associations only as opaque link IDs without inventing a document identifier or label',()=>{
    const fields=cardFields({...card(),documents:[{linkId:'opaque-only',state:'unavailable'}]});expect(fields.documentIds).toEqual([]);expect(fields.retainedDocumentLinkIds).toEqual(['opaque-only']);expect(JSON.stringify(fields)).not.toContain('fileName');
  });
  it('compares and exposes first/second passage in the existing Quand text',()=>{
    const server=card(),local={...cardFields(server),startFold:'second' as const};const when=comparisonRows(server,local,id=>id,()=> 'Document indisponible').find(row=>row.key==='Quand');expect(when).toMatchObject({same:false});expect(when?.server).toContain('Premier passage');expect(when?.local).toContain('Second passage');expect(agendaWhen(local)).toContain('Second passage');
  });
  it('distinguishes civil-day preview from 48 elapsed hours across the Paris spring transition',()=>{
    const fields={...emptyAgendaFields('2027-03-29'),startTime:'10:00'};expect(reminderPreview(fields,{id:'days',unit:'days',value:2,sendTime:null},0).label).toContain('10:00');expect(reminderPreview(fields,{id:'hours',unit:'hours',value:48,sendTime:null},0).label).toContain('09:00');
  });
  it('does not guess a nonexistent or repeated reminder time and never treats a past preview as an immediate send',()=>{
    const fields={...emptyAgendaFields('2027-11-01'),startTime:null};expect(reminderPreview(fields,{id:'fold',unit:'days',value:1,sendTime:'02:30'},0).state).toBe('clarify');expect(reminderPreview(emptyAgendaFields('2020-01-01'),{id:'past',unit:'days',value:1,sendTime:'09:00'}).label).toContain('aucun envoi immédiat');
  });
  it('uses only a finalized upload token when the document is no longer consultable',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response({operation:{id:'upload-a',status:'completed',chunkSize:1024}})).mockResolvedValueOnce(response({document:null}));const client=new AgendaTransport(vi.fn(),fetcher);
    await expect(uploadAgendaDocument(client,{file:new File(['%PDF-fixture'],'synthetic.pdf',{type:'application/pdf'}),folderId:'folder-a',requestId:'stable'},vi.fn())).resolves.toEqual({documentId:null,completedUploadId:'upload-a'});client.dispose();
  });
  it('sends the expected actor through legacy upload creation, raw chunks and completion',async()=>{
    const raw=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('',{status:200}));
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(response({operation:{id:'upload-a',status:'uploading',chunkSize:1024}})).mockResolvedValueOnce(response({document:{id:'document-a'}}));const client=new AgendaTransport(vi.fn(),fetcher,'camille');
    try{await expect(uploadAgendaDocument(client,{file:new File(['%PDF'],'synthetic.pdf',{type:'application/pdf'}),folderId:'folder-a',requestId:'stable'},vi.fn())).resolves.toMatchObject({documentId:'document-a'});for(const [,init]of fetcher.mock.calls)expect(init?.headers).toMatchObject({'X-Hestia-Expected-Actor':'camille'});expect(raw.mock.calls[0][1]?.headers).toMatchObject({'X-Hestia-Expected-Actor':'camille','Content-Type':'application/octet-stream'});}finally{client.dispose();raw.mockRestore();}
  });
});
