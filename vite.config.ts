import { fileURLToPath } from "node:url";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ command, isPreview }) => ({
  define: {
    // Baked into the Worker bundle and reported by /api/health, so a deploy is identifiable.
    __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
    // The commit being built (CI sets GITHUB_SHA); the deploy smoke check waits for it on /api/health.
    __COMMIT__: JSON.stringify((process.env.GITHUB_SHA ?? "").slice(0, 12) || "local"),
  },
  plugins: [
    cloudflare({
      configPath: "./wrangler.jsonc",
      viteEnvironment: { name: "ssr" },
      // Dev only: the plugin applies `assets.run_worker_first` as a middleware placed in front of Vite's own, so
      // the "/*" rule would send /@vite/client, /src/*, /@id/* and friends to the Worker, which answers 404
      // (cloudflare/workers-sdk discussion 14674). With it off, Vite serves its module graph and every other
      // request still reaches the Worker. `vite build` keeps the wrangler.jsonc rules for production.
      config:
        command === "serve" && !isPreview
          ? (worker) => {
              if (worker.assets) worker.assets.run_worker_first = false;
            }
          : undefined,
    }),
    tanstackStart({
      srcDirectory: "src/client",
      router: {
        entry: "router.tsx",
        routesDirectory: "routes",
        generatedRouteTree: "routeTree.gen.ts",
      },
      client: { entry: "client.tsx" },
      server: { entry: "../server.ts" },
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    sourcemap: true,
  },
}));
