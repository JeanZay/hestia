export function GET() {
  return Response.json(
    { status: "ok", mode: "demo", synthetic: true, syntheticDataOnly: true, persistence: false },
    { headers: { "Cache-Control": "no-store" } },
  );
}
