import { after } from 'next/server';
import { getApplication } from '../runtime';
/** Vercel extends the request lifetime; no unawaited promises or browser polling mutations. */
export function scheduleInboxWork(requestStartedAt=performance.now()){
 after(async()=>{
  const app=getApplication(),remaining=()=>50000-(performance.now()-requestStartedAt);
  if(remaining()<6000)return;
  await app.cleanupSummary(20);
  if(remaining()<6000)return;
  await app.runAcknowledgements();
  if(remaining()>15000)await app.runSummaryBatch(4,Math.min(35000,remaining()));
 });
}
