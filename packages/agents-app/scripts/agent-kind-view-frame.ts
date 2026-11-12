/**
 * THE KIND VIEW FRAME'S SCRIPT (`@iterate-com/ui/agent-kind-view/frame`, started by
 * src/agent-kind-view-frame.entry.ts) as one classic script, which `import frameScript from
 * "virtual:agent-kind-view-frame"` names by URL. The frame is sandboxed with an opaque origin, so a module
 * script from this app's origin would need CORS; a classic `<script src>` needs none. One bundle, so
 * nothing in it resolves against the page.
 *
 * `vite dev` builds it on each request of `/@agent-kind-view-frame.js`; `vite build` emits it once, as a
 * client asset named by its content.
 */
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "vite";

const ENTRY = fileURLToPath(new URL("../src/agent-kind-view-frame.entry.ts", import.meta.url));
const VIRTUAL = "virtual:agent-kind-view-frame";
const DEV_PATH = "/@agent-kind-view-frame.js";

export function agentKindViewFrame(): Plugin {
  let command: "build" | "serve" = "serve";
  let built: Promise<string> | undefined;
  return {
    name: "agent-kind-view-frame",
    configResolved(config) {
      command = config.command;
    },
    resolveId(id) {
      return id === VIRTUAL ? `\0${VIRTUAL}` : undefined;
    },
    async load(id) {
      if (id !== `\0${VIRTUAL}`) return;
      if (command === "serve") return `export default ${JSON.stringify(DEV_PATH)};`;
      const source = await (built ||= bundle());
      const fileName = `assets/agent-kind-view-frame-${createHash("sha256").update(source).digest("hex").slice(0, 10)}.js`;
      // the server's copy names the same file the client build emits
      if (this.environment.name === "client") this.emitFile({ type: "asset", fileName, source });
      return `export default ${JSON.stringify(`/${fileName}`)};`;
    },
    configureServer(server) {
      server.middlewares.use(DEV_PATH, (_request, response, next) => {
        bundle().then((source) => {
          response.setHeader("content-type", "text/javascript; charset=utf-8");
          response.end(source);
        }, next);
      });
    },
  };
}

async function bundle(): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: "warn",
    publicDir: false,
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    // THE BUNDLE IS PRODUCTION'S, UNDER `vite dev` TOO. The line above gives it React's production
    // build, whose `react/jsx-dev-runtime` has no `jsxDEV`. Vite picks the JSX transform by the
    // process's own NODE_ENV, which under `vite dev` is "development": left to itself it writes
    // `jsxDEV(…)` calls, every render throws "jsxDEV is not a function", and each kind's chat is
    // a blank frame.
    oxc: { jsx: { development: false } },
    build: {
      write: false,
      minify: true,
      lib: { entry: ENTRY, formats: ["iife"], name: "iterateAgentKindViewFrame" },
      rolldownOptions: {
        // React libraries mark their modules "use client", which means nothing to a browser bundle
        onLog: (level, log, handler) =>
          log.code === "MODULE_LEVEL_DIRECTIVE" || handler(level, log),
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((each) =>
    "output" in each ? each.output : [],
  );
  const chunk = outputs.find((output) => output.type === "chunk");
  if (!chunk || chunk.type !== "chunk") throw new Error("the kind view frame built no script");
  return chunk.code;
}
