// The shell's platform line: which platform the sign-in gate's answer names, and whether it is the
// app's own default. The fetch and the rendering are out of scope.
import { expect, test } from "vitest";
import { connectedPlatformOf } from "./app-shell-platform.ts";

test.for([
  {
    name: "a session bound to the app's own issuer is on the default platform",
    answer: { issuer: "https://os.iterate.com", defaultIssuer: "https://os.iterate.com" },
    expected: { host: "os.iterate.com", defaultHost: "os.iterate.com", isDefault: true },
  },
  {
    name: "a session connected to a self-hosted issuer is not on the default platform",
    answer: { issuer: "https://iterate.templestein.com", defaultIssuer: "https://os.iterate.com" },
    expected: { host: "iterate.templestein.com", defaultHost: "os.iterate.com", isDefault: false },
  },
  {
    name: "a session bound to no issuer talks to the default",
    answer: { issuer: null, defaultIssuer: "http://localhost:8788" },
    expected: { host: "localhost:8788", defaultHost: "localhost:8788", isDefault: true },
  },
  {
    name: "the same origin written with a trailing slash is still the default",
    answer: { issuer: "https://os.iterate.com/", defaultIssuer: "https://os.iterate.com" },
    expected: { host: "os.iterate.com", defaultHost: "os.iterate.com", isDefault: true },
  },
  {
    name: "an answer that is not the gate's names no platform",
    answer: { issuer: "not a url", defaultIssuer: "https://os.iterate.com" },
    expected: null,
  },
  {
    name: "an empty answer names no platform",
    answer: null,
    expected: null,
  },
])("$name", ({ answer, expected }) => {
  // exact: the line shows exactly these three, and nothing else
  expect(connectedPlatformOf(answer)).toEqual(expected);
});
