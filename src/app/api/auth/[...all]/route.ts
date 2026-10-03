import { getApplication } from "@/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return getApplication().handleAuth(request); }
export async function POST(request: Request) { return getApplication().handleAuth(request); }
