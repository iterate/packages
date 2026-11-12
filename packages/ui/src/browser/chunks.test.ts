// The build's named chunks (browser-entries.ts `vendorChunks`): which file goes into which, and
// that each is an export, which is what keeps it one file on a module server.
import { expect, test } from "vitest";
import { browserEntries, publishExports, vendorChunks } from "../../browser-entries.ts";

test("each named chunk has a name of its own and is an export of the published package", () => {
  const names = vendorChunks.map(({ name }) => name);
  expect([...new Set(names)]).toEqual(names);
  expect(publishExports({}, [])).toMatchObject(
    Object.fromEntries(names.map((name) => [`./chunks/${name}`, `./dist/chunks/${name}.mjs`])),
  );
});

test.for([
  { file: "node_modules/lucide-react/dist/esm/icons/bot.js", chunk: "vendor-icons" },
  {
    file: "node_modules/.pnpm/lucide-react@1.48.0/node_modules/lucide-react/dist/esm/createLucideIcon.js",
    chunk: "vendor-icons",
  },
  {
    file: "node_modules/.pnpm/@tanstack+react-query@5.107.1_react@19.3.0/node_modules/@tanstack/react-query/build/modern/useQuery.js",
    chunk: "vendor-query",
  },
  {
    file: "node_modules/.pnpm/@tanstack+query-core@5.107.1/node_modules/@tanstack/query-core/build/modern/queryClient.js",
    chunk: "vendor-query",
  },
  // another library of the same house is not react-query
  { file: "node_modules/@tanstack/react-virtual/dist/esm/index.js", chunk: undefined },
  { file: "packages/ui/src/components/ui/button.tsx", chunk: "ui-base" },
  { file: "packages/ui/src/components/ui/textarea.tsx", chunk: "ui-base" },
  { file: "packages/ui/src/components/ui/dialog.tsx", chunk: "ui-shell" },
  { file: "packages/ui/src/components/ui/dropdown-menu.tsx", chunk: "ui-shell" },
  // a component that brings a library of its own, or that only some pages use, keeps its own file
  { file: "packages/ui/src/components/ui/command.tsx", chunk: undefined },
  { file: "packages/ui/src/components/ui/sidebar.tsx", chunk: undefined },
  { file: "packages/ui/src/components/ui/sonner.tsx", chunk: undefined },
  { file: "packages/ui/src/components/ui/card.tsx", chunk: undefined },
  { file: "packages/ui/src/components/ui/input-group.tsx", chunk: "ui-shell" },
  // a component of the kit that is no shadcn file, and a file that only looks like one
  { file: "packages/ui/src/components/app-shell.tsx", chunk: undefined },
  { file: "packages/ui/src/components/ui/button.test.tsx", chunk: undefined },
  { file: "packages/ui/src/components/context-view/dialog.tsx", chunk: undefined },
])("$file goes into the chunk $chunk", ({ file, chunk }) => {
  // as the build does it: the first group whose test matches
  expect(vendorChunks.find(({ test }) => test.test(file))?.name).toBe(chunk);
});

test("the icons and react-query that a page takes from the kit are entries of their own", () => {
  expect(browserEntries()).toMatchObject({
    icons: "src/browser/icons.ts",
    query: "src/browser/query.ts",
  });
  expect(publishExports(browserEntries(), [])).toMatchObject({
    "./icons": "./dist/icons.mjs",
    "./query": "./dist/query.mjs",
  });
});
