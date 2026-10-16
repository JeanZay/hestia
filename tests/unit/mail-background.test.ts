import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({scheduled:undefined as undefined|(()=>Promise<void>),app:{cleanupSummary:vi.fn(),runAcknowledgements:vi.fn(),runSummaryBatch:vi.fn()}}));
vi.mock('next/server',()=>({after:(action:()=>Promise<void>)=>{state.scheduled=action;}}));
vi.mock('../../src/server/runtime',()=>({getApplication:()=>state.app}));
import {scheduleInboxWork} from '../../src/server/summary/background';
describe('request lifetime admission for durable mailbox work',()=>{
 let time=0;
 beforeEach(()=>{time=0;state.scheduled=undefined;vi.spyOn(performance,'now').mockImplementation(()=>time);for(const method of Object.values(state.app))method.mockReset().mockResolvedValue({});});
 afterEach(()=>vi.restoreAllMocks());
 it('defers all work until after the response and sends acknowledgements before independent analysis',async()=>{
  const order:string[]=[];state.app.cleanupSummary.mockImplementation(async()=>{order.push('cleanup');});state.app.runAcknowledgements.mockImplementation(async()=>{order.push('ack');});state.app.runSummaryBatch.mockImplementation(async()=>{order.push('analysis');});
  scheduleInboxWork(0);expect(state.app.runSummaryBatch).not.toHaveBeenCalled();expect(state.scheduled).toBeTypeOf('function');
  time=6000;await state.scheduled!();expect(order).toEqual(['cleanup','ack','analysis']);expect(state.app.runSummaryBatch).toHaveBeenCalledWith(4,35000);
 });
 it('accounts for time already used by the intake request',async()=>{
  scheduleInboxWork(0);time=48000;await state.scheduled!();expect(state.app.cleanupSummary).not.toHaveBeenCalled();expect(state.app.runAcknowledgements).not.toHaveBeenCalled();expect(state.app.runSummaryBatch).not.toHaveBeenCalled();
 });
 it('keeps a paid batch pending when cleanup and acknowledgement consumed the remaining window',async()=>{
  scheduleInboxWork(0);time=34000;state.app.cleanupSummary.mockImplementation(async()=>{time+=8000;});state.app.runAcknowledgements.mockImplementation(async()=>{time+=5000;});
  await state.scheduled!();expect(state.app.runAcknowledgements).toHaveBeenCalledOnce();expect(state.app.runSummaryBatch).not.toHaveBeenCalled();
 });
 it.each([25000,25001,28000])('does not launch analysis with only %ims already spent',async elapsed=>{scheduleInboxWork(0);time=elapsed;await state.scheduled!();expect(state.app.runSummaryBatch).not.toHaveBeenCalled();});
 it('passes only the actual remaining budget to the worker',async()=>{
  scheduleInboxWork(0);time=20000;state.app.cleanupSummary.mockImplementation(async()=>{time+=1000;});state.app.runAcknowledgements.mockImplementation(async()=>{time+=2000;});
  await state.scheduled!();expect(state.app.runSummaryBatch).toHaveBeenCalledWith(4,27000);
 });
});
