import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/base-server.test.ts"],
    environment: "node",
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
