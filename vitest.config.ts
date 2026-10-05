import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    globalSetup: ["packages/api/test/dynamodb-local.ts"],
    // Test files run in parallel, each in a worker of its own, beside one DynamoDB Local and the
    // browser tests' Chromium, which want cores too. On 16 cores, half of them for workers runs the
    // suite fastest, 52 s against 63 s with the default of one fewer than the cores, and leaves
    // room for a second suite on the same machine.
    maxWorkers: "50%",
    // The slowest test outside the browser takes 3 s alone and 6 s while two suites share the
    // machine, so this leaves more than twice that. Browser tests set budgets of their own.
    testTimeout: 15_000,
  },
});
