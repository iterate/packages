import { expect, test } from "vitest";
import { reindentSource } from "./source-code-block.client.tsx";

test("a script that arrives flush left reads indented", () => {
  const script = [
    "async (itx) => {",
    "const files = await itx.files.list();",
    "for (const file of files) {",
    "if (file.size > 0) console.log(file.path);",
    "}",
    "return files.length;",
    "}",
  ].join("\n");
  expect(reindentSource(script, "typescript")).toBe(
    [
      "async (itx) => {",
      "  const files = await itx.files.list();",
      "  for (const file of files) {",
      "    if (file.size > 0) console.log(file.path);",
      "  }",
      "  return files.length;",
      "}",
    ].join("\n"),
  );
});

test("a template literal's lines keep their text", () => {
  const script = "const text = `one\n    two\nthree`;\nreturn text;";
  expect(reindentSource(script, "typescript")).toBe(script);
});

test("a long script is indented to its last line, past the parse a new editor state starts with", () => {
  const blocks = Array.from(
    { length: 200 },
    (_, index) => `if (count > ${String(index)}) {\ncount += 1;\n}`,
  );
  const script = ["async (itx) => {", "let count = 0;", ...blocks, "return count;", "}"].join("\n");
  const lines = reindentSource(script, "typescript").split("\n");
  expect(lines.at(-4)).toBe("    count += 1;");
  expect(lines.at(-3)).toBe("  }");
  expect(lines.at(-2)).toBe("  return count;");
});
