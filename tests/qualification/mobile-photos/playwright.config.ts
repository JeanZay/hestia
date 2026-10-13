import {defineConfig,devices} from "@playwright/test";
// Explicit, exclusive local qualification. Never runs in the regular E2E suite.
export default defineConfig({
  testDir:"../../e2e",testMatch:"capture-performance.spec.ts",workers:1,retries:0,
  timeout:1_200_000,reporter:"list",use:{baseURL:"http://127.0.0.1:3210",trace:"off"},
  projects:[{name:"performance-photos-mobile",use:{...devices["Pixel 7"],defaultBrowserType:"chromium"}}],
});
