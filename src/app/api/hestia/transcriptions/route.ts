import { getApplication } from "@/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;
export async function GET(request: Request) { return getApplication().handleTranscriptions(request); }
export async function POST(request: Request) { return getApplication().handleTranscriptions(request); }
