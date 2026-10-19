import {getApplication} from '@/server/runtime';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return getApplication().handleAgendaReopen(request,(await context.params).id);}
