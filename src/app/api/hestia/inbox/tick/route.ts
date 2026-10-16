import { getApplication } from '@/server/runtime';
import { scheduleInboxWork } from '@/server/summary/background';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function POST(request:Request){const began=performance.now();const result=await getApplication().handleInboxTick(request);if(result.ok)scheduleInboxWork(began);return result;}
