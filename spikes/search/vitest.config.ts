import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // On S3 every test builds a mailbox's table and indexes from nothing.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
