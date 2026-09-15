import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Separate from vite.config.ts on purpose: that config roots at `client/` for the
 * browser build, which would hide the server and shared trees from the runner.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
    },
  },
  test: {
    environment: "node",
    // client/**/*.test.ts added for framework-free logic (e.g. table-selection.ts)
    // extracted specifically to be unit-testable without a DOM/component-testing
    // dependency. Actual component rendering/interaction tests would still need
    // jsdom + React Testing Library, which this repo doesn't have yet.
    include: ["server/**/*.test.ts", "shared/**/*.test.ts", "client/**/*.test.ts"],
  },
});
