// A MIND'S CATALOG OF ITS CONTEXTS, for a page: everything of this folder under one name, because a
// no-build page imports one module per kit item (browser-entries.ts).
//
//   const { rows } = useContextCatalog(() => read((itx) => itx.contexts.list({ limit: 500 })), { of: mind });
//   <AppShell paletteEntries={contextPaletteEntries(rows || [], { nowMs: Date.now(), onOpen })} … />
//   <ContextCatalog rows={rows} current={path} links={links} />
//   <ContextAbout row={rows?.find((row) => row.path === path)} onDescribe={…} />
export * from "./context-catalog-rows.ts";
export { ContextCatalog, ContextCatalogList, useContextCatalog } from "./context-catalog-list.tsx";
export { ContextAbout, ContextFacts } from "./context-about.tsx";
