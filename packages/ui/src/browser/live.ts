// Live data for a no-build page on a project's host, from the SDK built into this package so its
// hooks use this package's React: sign in and connect to the host's /api (`createIterateClient`),
// hold a context (`useContextStub`), and read it live for ContextView (`useIterateContext`).
export { createIterateClient } from "iterate/app";
export { useContextStub, useIterateContext } from "iterate/react";
