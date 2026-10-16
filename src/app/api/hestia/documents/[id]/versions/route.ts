import { getApplication } from '@/server/runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request:Request, context:{params:Promise<{id:string}>}){const params=await context.params;const result=await getApplication().handleDocumentVersions(request,params.id);return result;}
