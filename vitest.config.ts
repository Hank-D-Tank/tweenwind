import { defineConfig } from "vitest/config";

// Unit tests only. The real-browser tests in test/browser run with `pnpm test:browser`.
export default defineConfig({
  test: {
    include: ["test/*.test.ts"],
  },
});
