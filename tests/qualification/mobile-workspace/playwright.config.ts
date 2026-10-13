import { defineConfig, devices } from "@playwright/test";

// Explicit technical benchmark against the owned local runner. This is neither
// a Browser Use campaign nor a physical Pixel 10/Dev performance qualification.
export default defineConfig({
  testDir: "../../e2e", testMatch: "workspace-performance.spec.ts", workers: 1,
  retries: 0, timeout: 180000, reporter: "list",
  use: { baseURL: "http://127.0.0.1:3210", trace: "off" },
  projects: [{ name: "performance-mobile", use: { ...devices["Pixel 7"], defaultBrowserType: "chromium" } }],
});
