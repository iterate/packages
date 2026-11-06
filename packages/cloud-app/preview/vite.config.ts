// The preview's own Vite: preview/index.html and what it imports, nothing of the app's routes, and
// no build (it is never deployed). `pnpm page-preview` serves it.
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  plugins: [viteReact(), tailwindcss()],
  server: { port: 5199, strictPort: true },
});
