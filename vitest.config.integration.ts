import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["__tests__/integration/**/*.test.ts"],
    // Generous timeout for Neon cold starts + serializable retries.
    testTimeout: 15000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
});
