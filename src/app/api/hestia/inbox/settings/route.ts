import { getApplication } from '@/server/runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request:Request){const result=await getApplication().handleInboxSettings(request);return result;}
export async function PATCH(request:Request){const result=await getApplication().handleInboxSettings(request);return result;}
