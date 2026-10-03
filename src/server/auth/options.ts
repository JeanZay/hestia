import { betterAuth } from "better-auth";
import type { Pool } from "pg";
import type { ServerConfig } from "../config";

export function authOptions(pool: Pool, config: ServerConfig) {
  return {
    database: pool,
    baseURL: config.origin,
    secret: config.secret,
    trustedOrigins: [config.origin],
    telemetry: { enabled: false },
    logger: { disabled: true },
    emailAndPassword: {
      enabled: true, disableSignUp: true, requireEmailVerification: true,
      autoSignIn: false, minPasswordLength: 15, maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    session: { expiresIn: 43_200, disableSessionRefresh: true, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, storage: "database" as const, window: 60, max: 30 },
    advanced: {
      useSecureCookies: config.origin.startsWith("https:"),
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" as const },
    },
  };
}

export function createAuth(pool: Pool, config: ServerConfig) {
  return betterAuth(authOptions(pool, config));
}
