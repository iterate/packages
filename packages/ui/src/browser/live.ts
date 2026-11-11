// Live data for a no-build page, from the SDK built into this package so its hooks use this
// package's React. On a mind's own host, sign in and connect to the host's /api
// (`createIterateClient`). Anywhere else the page signs in for itself and opens /api with its token
// (`newWebSocketRpcSession`: capnweb's own, the copy the hooks use; examples/any-website.html).
// Then hold a context (`useContextStub`) and read it live for ContextView (`useIterateContext`), or
// one facet's live state alone (`useFacetLiveState`, `facetSnapshotOf`), or, with no React,
// subscribe to its log with `connectEventLog`.
// packages/ui/AGENTS.md "Signing in" says which.
export { newWebSocketRpcSession } from "capnweb";
export { createIterateClient } from "iterate/app";
export { connectEventLog } from "iterate/event-log";
export {
  facetSnapshotOf,
  useContextStub,
  useFacetLiveState,
  useIterateContext,
} from "iterate/react";
