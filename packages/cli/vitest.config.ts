import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // bundle.test.ts builds the bundle and runs it as a child process. On a busy CI
    // runner, where turbo runs the other packages' tasks at the same time, one run can take more
    // than Vitest's default of 5 seconds.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
