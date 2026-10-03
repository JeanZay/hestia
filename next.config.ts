import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  devIndicators: false,
  outputFileTracingIncludes: {
    "/pdf.worker.min.mjs": ["./node_modules/pdfjs-dist/build/pdf.worker.min.mjs"],
    "/api/hestia/uploads/*/complete": ["./src/server/formats/validate-worker.mjs", "./node_modules/libheif-js/**/*", "./node_modules/pdfjs-dist/package.json", "./node_modules/pdfjs-dist/legacy/build/**/*", "./node_modules/@napi-rs/**/*", "./node_modules/sharp/**/*", "./node_modules/@img/**/*"],
  },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
      { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "") + "; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self'; font-src 'self' blob:; connect-src 'self' blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'" }
    ] }];
  }
};

export default config;
