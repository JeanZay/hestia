import type { NextConfig } from "next";

if ((process.env.HESTIA_MODE ?? "demo") !== "demo" || (process.env.HESTIA_ENV ?? "dev") !== "dev") {
  throw new Error("Cette fondation accepte uniquement HESTIA_MODE=demo et HESTIA_ENV=dev.");
}

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
      { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "") + "; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'" }
    ] }];
  }
};

export default config;
