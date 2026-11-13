import { expect, test } from "vitest";
import { formatScript } from "./format-script.ts";

test("a script body that arrives on few lines reads prettified, its await and return as they are", async () => {
  const script =
    "const files = await itx.files.list(); let n=0\nfor (const file of files) { if (file.size > 0) {n++; console.log(file.path)} }\nreturn {count: n, names: files.map(f=>f.path)}";
  expect(await formatScript(script)).toBe(
    [
      "const files = await itx.files.list();",
      "let n = 0;",
      "for (const file of files) {",
      "  if (file.size > 0) {",
      "    n++;",
      "    console.log(file.path);",
      "  }",
      "}",
      "return { count: n, names: files.map((f) => f.path) };",
    ].join("\n"),
  );
});

test("TypeScript is read as TypeScript, and a template literal's lines keep their text", async () => {
  const script = "const text = `one\n    two\nthree` as string;\nreturn text";
  expect(await formatScript(script)).toBe(
    "const text = `one\n    two\nthree` as string;\nreturn text;",
  );
});

test("a script that does not parse comes back as it was", async () => {
  const script = "const x = {\nreturn x";
  expect(await formatScript(script)).toBe(script);
});
