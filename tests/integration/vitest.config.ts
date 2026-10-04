import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts", "tests/identity/**/*.integration.test.ts", "tests/membership/**/*.integration.test.ts"],
    environment: "node",
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
