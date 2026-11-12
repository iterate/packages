// The tree's pure parts: which folders it opens for the open file, and what "New doc" names.
// Pierre's own tree is not drawn here.
import { expect, test } from "vitest";
import { docPathOf, folderOf, folders, untitledPath } from "./doc-tree.ts";

test.for([
  { name: "a file at the root opens no folder", path: "plan.md", open: [], folder: "" },
  {
    name: "a file in a folder opens it",
    path: "tasks/plan.md",
    open: ["tasks/"],
    folder: "tasks/",
  },
  {
    name: "a file deep down opens each folder on the way, outermost first",
    path: "tasks/done/2026/plan.md",
    open: ["tasks/", "tasks/done/", "tasks/done/2026/"],
    folder: "tasks/done/2026/",
  },
])("$name", ({ path, open, folder }) => {
  expect({ open: folders(path), folder: folderOf(path) }).toEqual({ open, folder });
});

test.for([
  { name: "the first new doc of a folder", folder: "tasks/", taken: [], path: "tasks/untitled.md" },
  {
    name: "the next free number past those taken",
    folder: "",
    taken: ["untitled.md", "untitled-2.md"],
    path: "untitled-3.md",
  },
])("a new doc's first name: $name", ({ folder, taken, path }) => {
  expect(untitledPath(folder, new Set(taken))).toBe(path);
});

test.for([
  { name: "a name with no extension gets .md", typed: "tasks/lisbon", path: "tasks/lisbon.md" },
  { name: "a name with one keeps it", typed: "notes.txt", path: "notes.txt" },
  { name: "a dot in a folder's name is no extension", typed: "v1.2/plan", path: "v1.2/plan.md" },
])("a typed name's file: $name", ({ typed, path }) => {
  expect(docPathOf(typed)).toBe(path);
});
