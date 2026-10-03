export type ServerConfig = {
  databaseUrl: string;
  secret: string;
  origin: string;
  environment: "local" | "dev" | "production";
};

export function readServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const environment = env.HESTIA_ENVIRONMENT;
  if (environment !== "local" && environment !== "dev" && environment !== "production") {
    throw new Error("HESTIA_ENVIRONMENT must be local, dev or production");
  }
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters");
  if (!env.DATABASE_URL || !env.AUTH_BASE_URL) throw new Error("DATABASE_URL and AUTH_BASE_URL are required");
  const origin = new URL(env.AUTH_BASE_URL);
  const database = new URL(env.DATABASE_URL);
  // Upload/cleanup exclusion holds a PostgreSQL session advisory lock across I/O.
  // Neon transaction pooling cannot preserve it: require its direct endpoint.
  if (database.hostname.includes("-pooler")) throw new Error("Document storage requires a direct PostgreSQL endpoint, without -pooler");
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error("PostgreSQL connection required");
  if (origin.origin !== env.AUTH_BASE_URL || origin.username || origin.password) throw new Error("AUTH_BASE_URL must be an exact origin");
  const localHost = (host: string) => ["localhost", "127.0.0.1", "[::1]"].includes(host);
  if (environment === "local") {
    if (!localHost(origin.hostname) || !localHost(database.hostname)) throw new Error("Local mode requires loopback hosts");
    if (!["http:", "https:"].includes(origin.protocol)) throw new Error("HTTP origin required");
  } else if (origin.protocol !== "https:") throw new Error("Hosted mode requires HTTPS");
  return { environment, origin: origin.origin, secret: env.AUTH_SECRET, databaseUrl: env.DATABASE_URL };
}

