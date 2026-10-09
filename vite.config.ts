import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  // Third arg "" (not the default "VITE_") so this also picks up PORT from
  // .env, not just VITE_-prefixed vars - needed for the dev proxy target
  // below. Only used here, at config-eval time; never exposed to client code.
  const env = loadEnv(mode, __dirname, "");
  const apiPort = env.PORT || "5001";

  return {
    plugins: [
      react(),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "client", "src"),
        "@shared": path.resolve(__dirname, "shared"),
        "@assets": path.resolve(__dirname, "attached_assets"),
      },
    },
    root: path.resolve(__dirname, "client"),
    build: {
      outDir: path.resolve(__dirname, "dist/public"),
      emptyOutDir: true,
      rollupOptions: {
        output: {
          // Vendor code changes far less often than app code; separate chunks cache across deploys.
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;
            if (/node_modules\/(react|react-dom|scheduler|wouter)\//.test(id)) return "vendor-react";
            if (id.includes("@radix-ui") || id.includes("cmdk") || id.includes("vaul")) return "vendor-radix";
            if (id.includes("@tanstack")) return "vendor-query";
            if (id.includes("date-fns")) return "vendor-date";
            return undefined;
          },
        },
      },
    },
    server: {
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
      // Standalone dev server (npm run dev:client / npm run dev, via
      // concurrently) - runs as its own process, independent of the
      // `tsx watch`-supervised Express/API process, so a backend file
      // change (which restarts that whole process) no longer drops the
      // frontend's HMR websocket. See server/index.ts's dev branch and
      // package.json's dev/dev:client/dev:server scripts.
      port: Number(env.VITE_DEV_PORT) || 5173,
      strictPort: true,
      proxy: {
        "/api": { target: `http://localhost:${apiPort}`, changeOrigin: true },
        "/ws": { target: `http://localhost:${apiPort}`, ws: true, changeOrigin: true },
      },
    },
  };
});
