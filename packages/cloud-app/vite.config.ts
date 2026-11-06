import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { startAppVitePlugins } from "../../scripts/lib/start-app-vite.ts";
import { cloudApp } from "./scripts/app.ts";

export default defineConfig({
  plugins: startAppVitePlugins(
    cloudApp,
    { cloudflare, tanstackStart, viteReact, tailwindcss },
    { basepath: "" },
  ),
  experimental: {
    // A chunk's preloaded dependencies resolve beside it, not at the origin's root: under a base
    // path the Cloud serves its chunks there (packages/ui/src/apps/base-path.ts), as packages/notes
    // does. Only the browser's scripts; a stylesheet's own `url()`s (the fonts) resolve beside it.
    renderBuiltUrl: (filename, { hostType, ssr }) =>
      hostType === "css" || (!ssr && hostType === "js" && filename.endsWith(".js"))
        ? { relative: true }
        : undefined,
  },
});
