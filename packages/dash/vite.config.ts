import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { STANDALONE_WORKER_ENV, standaloneWorkerConfig } from "@iterate-com/shared/standalone-app";
import { startAppVitePlugins } from "../../scripts/lib/start-app-vite.ts";
import { routeTreeStyle } from "../../scripts/lib/start-app.ts";
import { dash } from "./scripts/app.ts";

// A Worker of its own, hosted apart from any project (@iterate-com/shared/standalone-app), when
// `ITERATE_STANDALONE_WORKER` names it; else an envs.ts environment (scripts/lib/start-app.ts).
const standalone = process.env[STANDALONE_WORKER_ENV];

export default defineConfig({
  plugins: standalone
    ? [
        cloudflare({
          viteEnvironment: { name: "ssr" },
          config: standaloneWorkerConfig(new URL(".", import.meta.url), standalone),
        }),
        tanstackStart({ router: routeTreeStyle, importProtection: { behavior: "error" } }),
        viteReact(),
        tailwindcss(),
      ]
    : startAppVitePlugins(dash, { cloudflare, tanstackStart, viteReact, tailwindcss }),
});
