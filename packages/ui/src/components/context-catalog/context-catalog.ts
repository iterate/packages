// A MIND'S CATALOG OF ITS CONTEXTS, for a page: everything of this folder under one name, because a
// no-build page imports one module per kit item (browser-entries.ts).
//
//   const { rows, error } = useContextCatalog(() => itx.contexts.list({ limit: 500 }), {
//     of: mind,
//   });
//   <AppShell palette={({ open, onClose }) => (
//     <ContextPalette rows={rows} error={error} open={open}
//       onOpenChange={(next) => next || onClose()} onOpenPath={openContext}
//       search={(query) => itx.contexts.list({ search: query, limit: 200 })} />
//   )} … />
//   <ContextCatalog rows={rows} current={path} links={links} />
//   <ContextAbout row={rows?.find((row) => row.path === path)} onDescribe={…} />
//
// The kit's `Dash` (components/dash) reads the catalog and gives AppShell the palette for every
// mind's Dash.
export * from "./context-catalog-rows.ts";
export * from "./context-palette-rows.ts";
export { ContextCatalog, ContextCatalogList, useContextCatalog } from "./context-catalog-list.tsx";
export { ContextAbout, ContextFacts } from "./context-about.tsx";
export { ContextPalette } from "./context-palette.tsx";
