import { expect, test } from "vitest";
import { authoredScript } from "./agent-feed.tsx";

test("the Script tab reads the model's code out of the loop's envelope", () => {
  const envelope = [
    "async (itx) => {",
    "  const results = __results(itx);",
    "  return __json(await (",
    "//#region your script",
    "async (itx) => {",
    'await setSummary({ title: "Greeting", waitingFor: null });',
    "}",
    "//#endregion your script",
    "  )(itx));",
    "  function __results(itx) {",
    "    const open = '//#region' + ' your script';",
    "  }",
    "}",
  ].join("\n");
  expect(authoredScript(envelope)).toBe(
    'async (itx) => {\nawait setSummary({ title: "Greeting", waitingFor: null });\n}',
  );
  expect(authoredScript("async (itx) => itx.whoami()")).toBeNull();
});
