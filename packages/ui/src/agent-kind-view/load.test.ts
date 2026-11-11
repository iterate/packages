// A kind file's server-only imports in the frame: harmless while unused, a clear failure when used.
import { expect, test } from "vitest";
import { importAgentKind } from "./load.ts";

test("a kind file whose server import is used only in processEvent loads, view and all", async () => {
  const kind = await importAgentKind(
    `
      import type { AgentKind } from "@iterate-com/ui/agent-kind-view";
      import { createXai } from "@ai-sdk/xai";
      import installRows, * as install from "iterate/agents/install";
      import { generateText as generate } from "ai";

      const label = (path: string): string => path.split("/").at(-1)!;

      export default {
        kind: "grok",
        ephemeralEvents: ["x.ai/grok/token"],
        processEvent: async ({ event, itx }) => {
          if (event.type === "events.iterate.com/agent/message-received" && event.path.startsWith("/agents/grok/")) {
            await installRows(itx, event.path);
            install.other();
            await generate({ model: createXai()("grok-4"), prompt: event.payload.message });
          }
        },
        view: () => (props: { path: string }) => label(props.path),
      } satisfies AgentKind;
    `,
    "agent-kinds/grok.ts",
  );
  expect(kind).toMatchObject({
    kind: "grok",
    ephemeralEvents: ["x.ai/grok/token"],
  });
  expect((kind.view as any)()({ path: "/agents/grok/1" })).toBe("1");
});

test("a server import used at the top of the file fails, naming the import and where to use it", async () => {
  await expect(
    importAgentKind(
      `
        import { createXai } from "@ai-sdk/xai";
        const xai = createXai({ apiKey: "…" });
        export default { kind: "grok", view: () => () => null };
      `,
      "agent-kinds/grok.ts",
    ),
  ).rejects.toThrow(
    "createXai from @ai-sdk/xai only works on the server: this file's view runs in the browser, so use it inside processEvent, not at the top of the file",
  );
});

test("a default or namespace import fails the same way once it is used", async () => {
  await expect(
    importAgentKind(
      `
        import xai from "@ai-sdk/xai";
        xai.languageModel("grok-4");
        export default { kind: "grok", view: () => () => null };
      `,
      "agent-kinds/grok.ts",
    ),
  ).rejects.toThrow("The default export of @ai-sdk/xai only works on the server");
  await expect(
    importAgentKind(
      `
        import * as ai from "ai";
        new ai.Agent();
        export default { kind: "grok", view: () => () => null };
      `,
      "agent-kinds/grok.ts",
    ),
  ).rejects.toThrow("Agent from ai only works on the server");
});

test("a file without a view is refused, saying what to export", async () => {
  await expect(
    importAgentKind(`export default { kind: "grok" };`, "agent-kinds/grok.ts"),
  ).rejects.toThrow("agent-kinds/grok.ts has no default export with a view");
});
