import { describe, expect, it, vi } from 'vitest';
const mock=vi.hoisted(()=>({handle:vi.fn(async()=>Response.json({private:true}))}));
vi.mock('@/server/runtime',()=>({getApplication:()=>({handleOutgoing:mock.handle,handleOutgoingDraft:mock.handle,handleOutgoingAvailable:mock.handle,handleOutgoingAttachments:mock.handle,handleOutgoingCheck:mock.handle,handleOutgoingSend:mock.handle,handleOutgoingOperation:mock.handle})}));
import * as root from '../../src/app/api/hestia/outgoing/route';
import * as draft from '../../src/app/api/hestia/outgoing/[id]/route';
import * as check from '../../src/app/api/hestia/outgoing/[id]/check/route';
import * as send from '../../src/app/api/hestia/outgoing/[id]/send/route';
import * as attachments from '../../src/app/api/hestia/outgoing/[id]/attachments/route';
import * as accept from '../../src/app/api/hestia/outgoing/[id]/attachments/[rowId]/accept/route';
import * as operation from '../../src/app/api/hestia/outgoing/operations/[id]/route';
describe('outgoing thin Node routes',()=>{it('forwards exact parameters without a background resend or reconciliation route',async()=>{
  const request=new Request('https://hestia.example.invalid/api/hestia/outgoing');await root.GET(request);expect(mock.handle).toHaveBeenLastCalledWith(request);
  const context={params:Promise.resolve({id:'draft',rowId:'row'})};for(const route of [draft.PATCH,check.POST,send.POST,attachments.POST,operation.GET]){await route(request,context);expect(mock.handle).toHaveBeenLastCalledWith(request,'draft');}
  await accept.POST(request,context);expect(mock.handle).toHaveBeenLastCalledWith(request,'draft','row');expect(send.maxDuration).toBe(60);expect(send.runtime).toBe('nodejs');
});});
