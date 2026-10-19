import { describe,expect,it,vi } from 'vitest';
import { dispatchAgendaMail,runAgendaMailBatch } from '../../src/server/agenda/worker';
import type { Pool } from 'pg';
describe('agenda bounded mail loop',()=>{
  it('does not acquire SQL or send when transport is absent',async()=>{
    const connect=vi.fn();expect(await dispatchAgendaMail({connect} as unknown as Pool,'synthetic-only')).toEqual({state:'transport-unavailable'});expect(connect).not.toHaveBeenCalled();
  });
  it('stops on empty, unavailable, quota or deadline, counts accepted separately from failures',async()=>{
    const dispatch=vi.fn(async()=>({state:'sent' as const}));
    expect(await runAgendaMailBatch(dispatch)).toMatchObject({sent:4,failed:0,available:true});expect(dispatch).toHaveBeenCalledTimes(4);
    for(const state of ['idle','transport-unavailable','quota-deferred'] as const){const once=vi.fn(async()=>({state}));const result=await runAgendaMailBatch(once);expect(once).toHaveBeenCalledOnce();expect(result.available).toBe(state!=='transport-unavailable');expect(result.deferred).toBe(state==='quota-deferred'?1:0);}
    const late=vi.fn(async()=>({state:'sent' as const}));await runAgendaMailBatch(late,Date.now()-1);expect(late).not.toHaveBeenCalled();
    expect(await runAgendaMailBatch(async()=>({state:'failed'}))).toMatchObject({failed:4,sent:0});
  });
});
