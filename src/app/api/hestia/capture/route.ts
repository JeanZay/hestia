import { getApplication } from "@/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return getApplication().handleCaptures(request); }
export async function POST(request: Request) { return getApplication().handleCaptures(request); }
