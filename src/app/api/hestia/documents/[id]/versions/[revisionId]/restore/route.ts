import { getApplication } from '@/server/runtime';
import { scheduleInboxWork } from '@/server/summary/background';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function POST(request:Request, context:{params:Promise<{id:string;revisionId:string}>}){const began=performance.now();const params=await context.params;const result=await getApplication().handleDocumentRevisionRestore(request,params.id,params.revisionId);if(result.ok)scheduleInboxWork(began);return result;}
