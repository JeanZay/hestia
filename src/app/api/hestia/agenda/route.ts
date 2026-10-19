import {getApplication} from '@/server/runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export function GET(request:Request){return getApplication().handleAgenda(request);}
export function POST(request:Request){return getApplication().handleAgenda(request);}
