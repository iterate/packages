// The wire's own helpers: a doc's context path and back, the frames' payloads, and base64.
import { expect, test } from "vitest";
import { DocLeft, docContextPath, docOf, EditFrame, fromBase64, toBase64 } from "./frames.ts";

test.for([
  { name: "a file at the repo's root", doc: { repo: "/repos/config", path: "plan.md" } },
  { name: "a file in a folder", doc: { repo: "/repos/notes", path: "offsites/lisbon.md" } },
])("$name: its context is /docs/<repo name>/<path>, and the context names the doc", ({ doc }) => {
  const contextPath = docContextPath(doc);
  expect(contextPath).toBe(`/docs/${doc.repo.slice("/repos/".length)}/${doc.path}`);
  expect(docOf(contextPath)).toEqual(doc);
});

test("a path that is no doc's context throws", () => {
  expect(() => docOf("/agents/assistant")).toThrow("not a doc's context: /agents/assistant");
});

test("an edit frame is a tab's or the processor's, and a goodbye names the tab", () => {
  expect(EditFrame.safeParse({ update: "AA==", client: "processor" })).toMatchObject({
    success: true,
  });
  expect(EditFrame.safeParse({ update: "AA==", client: "a tab" })).toMatchObject({
    success: false,
  });
  expect(DocLeft.safeParse({ client: 42 })).toMatchObject({ success: true });
});

test("bytes survive base64 both ways, past the size one spread can take", () => {
  const bytes = Uint8Array.from({ length: 0x8000 * 2 + 5 }, (_, i) => i % 256);
  expect(fromBase64(toBase64(bytes))).toEqual(bytes);
});
