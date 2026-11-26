// TANSTACK DB FOR A NO-BUILD PAGE, from this package:
//
//   import { eq, useLiveQuery } from "@iterate-com/ui/db";
//   import { catalogOf } from "@iterate-com/ui/components/context-catalog/context-catalog";
//
//   const { data } = useLiveQuery({ query: (q) =>
//     q.from({ c: catalogOf(itx).contexts }).where(({ c }) => eq(c.metadata.status, "open")) });
//
// A page does not name `@tanstack/react-db` in its import map, for the reason that
// ./query.ts says. It is also one copy: the build keeps TanStack DB in one file
// (browser-entries.ts `vendor-db`), so a page's live query reads the collections that this
// package's components made (the mind's catalog, components/context-catalog).
export * from "@tanstack/react-db";
