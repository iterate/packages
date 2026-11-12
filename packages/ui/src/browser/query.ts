// REACT-QUERY FOR A NO-BUILD PAGE, from this package:
//
//   import { QueryClient, QueryClientProvider, useQuery } from "@iterate-com/ui/query";
//
// A page does not name `@tanstack/react-query` in its import map. A script that needs a line of
// its own in index.html stops working in every mind whose owner changed that page: an update
// moves the script and leaves the page. The import map names this package, React and nothing
// else. It is also one copy: the build keeps react-query in one file (browser-entries.ts
// `vendor-query`), so a component of this package that asks for a query finds the client that
// the page provided.
export * from "@tanstack/react-query";
