import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "../../e2e", testMatch: "comment-voice.spec.ts", workers: 1, retries: 0, timeout: 90_000,
  reporter: "list", use: { baseURL: "http://127.0.0.1:3210", trace: "off" },
  projects: [{ name: "comment-voice-mobile", use: { ...devices["Pixel 7"], defaultBrowserType: "chromium" } }],
});
