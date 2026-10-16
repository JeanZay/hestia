import { getApplication } from '@/server/runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function POST(request:Request, context:{params:Promise<{id:string;key:string}>}){const params=await context.params;const result=await getApplication().handleInboxOperation(request,params.key);return result;}
