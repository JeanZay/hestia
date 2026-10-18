import { getApplication } from "@/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return getApplication().handleOutgoingSend(request,(await context.params).id);}
