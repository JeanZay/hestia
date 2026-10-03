export async function register() {
  // The build contains no account or database data. Validate at runtime only.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { readServerConfig } = await import("./server/config");
    readServerConfig();
  }
}
