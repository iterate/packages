// LOADING A KIND FILE IN THE BROWSER: the frame (frame.tsx) runs `agent-kinds/<kind>.ts` from a
// config repo for its `view`. The file is the worker's too, so it may import server-only packages
// (an AI SDK, `iterate/agents/install`) for its `processEvent`. Here:
//
// 1. its types are stripped by the same sucrase call the platform's worker loader makes (core/os
//    `stripTypes` in context/module-resolution.ts), so a file that loads there loads here;
// 2. every static import becomes a `const` destructured from a SERVER-ONLY MODULE: one poisoned
//    value per export. Reading an export is fine (an unused import, or one used only inside
//    `processEvent`, costs nothing); using one (a property, a call, `new`) throws, naming it:
//
//      import { createXai } from "@ai-sdk/xai";   →   const { createXai } = serverOnly("@ai-sdk/xai");
//      const xai = createXai();                    →   Error: createXai from @ai-sdk/xai only works
//                                                      on the server: this file's view runs in the …
//
// 3. the result is imported from a data: URL.
import { init, parse } from "es-module-lexer";
import { transform } from "sucrase";
import type { AgentKind } from "./types.ts";

/** The global a rewritten import reads its server-only module from: a module loaded from a URL
 *  has no other way to reach the frame's code. */
const SERVER_ONLY = "__iterateAgentKindServerOnly";

/** The kind file at `name`, its `source` loaded as the frame loads it. */
export async function importAgentKind(source: string, name: string): Promise<AgentKind> {
  const code = await browserModuleOf(source, name);
  (globalThis as Record<string, unknown>)[SERVER_ONLY] = serverOnlyModule;
  const url = `data:text/javascript;base64,${base64(code)}`;
  const loaded = (await import(/* @vite-ignore */ url)) as { default?: AgentKind };
  const kind = loaded.default;
  if (!kind || typeof kind.view !== "function")
    throw new Error(`${name} has no default export with a view: export default { kind, view, … }`);
  return kind;
}

/** A kind file's source as a module the browser can load: types stripped, every import a stub. */
export async function browserModuleOf(source: string, name: string): Promise<string> {
  let code: string;
  try {
    // the platform's worker loader's own call: core/os src/context/module-resolution.ts `stripTypes`
    code = transform(source, {
      transforms: ["typescript"],
      disableESTransforms: true,
      filePath: name,
    }).code;
  } catch (error) {
    throw new Error(`${name} does not parse as TypeScript: ${String(error)}`);
  }
  await init;
  const [imports] = parse(code, name);
  let out = "";
  let at = 0;
  for (const imp of imports) {
    // a static import statement (`t` 1): dynamic imports, `import.meta` and re-exports stay as
    // they are. A dynamic one only runs if the view calls it.
    if (imp.t !== 1 || !imp.n) continue;
    const statement = code.slice(imp.ss, imp.se);
    if (!statement.startsWith("import")) continue;
    out += code.slice(at, imp.ss) + stubbed(statement, imp.n);
    at = imp.se;
  }
  return out + code.slice(at);
}

/** One import statement as `const`s read from the module's stub. */
function stubbed(statement: string, specifier: string): string {
  const module = `globalThis.${SERVER_ONLY}(${JSON.stringify(specifier)})`;
  const clause = statement.match(/^import\s*([\s\S]*?)\s*from\s*["'][^"']*["']/)?.[1];
  // `import "x"`: for its effects, which are the server's
  if (!clause) return "";
  const namespace = clause.match(/\*\s*as\s+([\w$]+)/)?.[1];
  const named = clause.match(/\{([\s\S]*)\}/)?.[1];
  const defaultName = clause.match(/^([\w$]+)\s*(,|$)/)?.[1];
  const parts: string[] = [];
  if (named) {
    const bindings = named
      .split(",")
      .map((binding) => binding.trim())
      .filter(Boolean)
      .map((binding) => {
        const [imported, local] = binding.split(/\s+as\s+/);
        return local ? `${imported}: ${local}` : imported;
      });
    if (bindings.length) parts.push(`{ ${bindings.join(", ")} }`);
  }
  const lines: string[] = [];
  if (defaultName) lines.push(`const ${defaultName} = ${module}.default;`);
  if (namespace) lines.push(`const ${namespace} = ${module};`);
  for (const part of parts) lines.push(`const ${part} = ${module};`);
  return lines.join(" ");
}

/** A module the frame cannot load: each export, read, is a poisoned value. `then` and
 *  `__esModule` are absent, so awaiting the module or interop checks see a plain object. */
export function serverOnlyModule(specifier: string): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get(_, name) {
        if (name === "then" || name === "__esModule" || typeof name === "symbol") return undefined;
        return poisoned(
          name === "default" ? `The default export of ${specifier}` : `${name} from ${specifier}`,
        );
      },
    },
  );
}

/** A stand-in for a server-only export that throws on any use: a property read, a call, `new`. */
function poisoned(label: string): unknown {
  const fail = (): never => {
    throw new Error(
      `${label} only works on the server: this file's view runs in the browser, so use it inside processEvent, not at the top of the file`,
    );
  };
  return new Proxy(function serverOnly() {}, {
    get: (_, property) => (property === "then" ? undefined : fail()),
    set: fail,
    has: fail,
    apply: fail,
    construct: fail,
  });
}

/** UTF-8 text as base64. */
function base64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}
