import { defineConfig } from "vitest/config";
export default defineConfig({ test: {
  include: ["tests/helpers/bootstrap.test.ts"],
  environment: "node", maxWorkers: 1, hookTimeout: 60_000, testTimeout: 60_000,
} });
