import { getApplication } from '@/server/runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function POST(request:Request, context:{params:Promise<{id:string}>}){const params=await context.params;const result=await getApplication().handleInboxPlace(request,params.id);return result;}
