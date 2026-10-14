import { getApplication } from "@/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return getApplication().handleTranscriptionSettings(request); }
export async function PUT(request: Request) { return getApplication().handleTranscriptionSettings(request); }
export async function DELETE(request: Request) { return getApplication().handleTranscriptionSettings(request); }
