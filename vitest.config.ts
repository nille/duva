import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    globalSetup: ["packages/api/test/dynamodb-local.ts"],
    // Every test shares one DynamoDB Local, and the browser tests' Chromium runs beside them, so
    // under the full suite's load a test that takes 2 s alone can take more than vitest's default 5 s.
    testTimeout: 15_000,
  },
});
