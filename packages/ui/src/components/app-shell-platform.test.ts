// The shell's platform line and the Change deployment dialog's data: which platform the sign-in
// gate's answer names, whether it is the app's own default, what a person can change to, and what
// their typing names. The fetch and the rendering are out of scope.
import { expect, test, vi } from "vitest";
import {
  connectedPlatformOf,
  deploymentChoices,
  deploymentOriginOf,
  rememberDeployment,
  rememberedDeployments,
} from "./app-shell-platform.ts";

const DEFAULT = "https://os.iterate.com";
const SELF_HOST = "https://iterate.example.com";
const ANOTHER = "https://another.example.com";

test.for([
  {
    name: "a session bound to the app's own issuer is on the default platform",
    answer: { issuer: DEFAULT, defaultIssuer: DEFAULT },
    expected: {
      origin: DEFAULT,
      host: "os.iterate.com",
      defaultOrigin: DEFAULT,
      defaultHost: "os.iterate.com",
      isDefault: true,
    },
  },
  {
    name: "a session connected to a self-hosted issuer is not on the default platform",
    answer: { issuer: SELF_HOST, defaultIssuer: DEFAULT },
    expected: {
      origin: SELF_HOST,
      host: "iterate.example.com",
      defaultOrigin: DEFAULT,
      defaultHost: "os.iterate.com",
      isDefault: false,
    },
  },
  {
    name: "a session bound to no issuer talks to the default",
    answer: { issuer: null, defaultIssuer: "http://localhost:8788" },
    expected: {
      origin: "http://localhost:8788",
      host: "localhost:8788",
      defaultOrigin: "http://localhost:8788",
      defaultHost: "localhost:8788",
      isDefault: true,
    },
  },
  {
    name: "the same origin written with a trailing slash is still the default",
    answer: { issuer: `${DEFAULT}/`, defaultIssuer: DEFAULT },
    expected: {
      origin: DEFAULT,
      host: "os.iterate.com",
      defaultOrigin: DEFAULT,
      defaultHost: "os.iterate.com",
      isDefault: true,
    },
  },
  {
    name: "an answer that is not the gate's names no platform",
    answer: { issuer: "not a url", defaultIssuer: DEFAULT },
    expected: null,
  },
  {
    name: "an empty answer names no platform",
    answer: null,
    expected: null,
  },
])("$name", ({ answer, expected }) => {
  // exact: the line shows exactly these, and nothing else
  expect(connectedPlatformOf(answer)).toEqual(expected);
});

const onSelfHost = connectedPlatformOf({ issuer: SELF_HOST, defaultIssuer: DEFAULT });
const onDefault = connectedPlatformOf({ issuer: DEFAULT, defaultIssuer: DEFAULT });

test("the default comes first, and a change of deployment moves no row", () => {
  const remembered = [ANOTHER, SELF_HOST];
  const hostsOn = (platform: typeof onDefault) =>
    deploymentChoices(platform, remembered).map((choice) => choice.host);
  expect(hostsOn(onSelfHost)).toEqual([
    "os.iterate.com",
    "another.example.com",
    "iterate.example.com",
  ]);
  expect(hostsOn(onDefault)).toEqual(hostsOn(onSelfHost));
});

test("only the deployment in use is current, and only the app's own is the default", () => {
  expect(deploymentChoices(onSelfHost, [ANOTHER])).toEqual([
    { origin: DEFAULT, host: "os.iterate.com", current: false, isDefault: true },
    { origin: ANOTHER, host: "another.example.com", current: false, isDefault: false },
    { origin: SELF_HOST, host: "iterate.example.com", current: true, isDefault: false },
  ]);
});

test("a deployment is offered once, however this browser knows it", () => {
  expect(deploymentChoices(onSelfHost, [SELF_HOST, DEFAULT])).toHaveLength(2);
});

test("before the gate answers there is nothing to offer", () => {
  expect(deploymentChoices(null, [SELF_HOST])).toEqual([]);
});

test.for([
  { typed: "iterate.example.com", expected: SELF_HOST },
  { typed: "  iterate.example.com  ", expected: SELF_HOST },
  { typed: "https://iterate.example.com/projects/x?agent=y", expected: SELF_HOST },
  { typed: "HTTPS://Iterate.Example.COM", expected: SELF_HOST },
  { typed: "iterate.example.com:8443", expected: "https://iterate.example.com:8443" },
  // the gate refuses these, and says why on its own page
  { typed: "http://iterate.example.com", expected: "http://iterate.example.com" },
  { typed: "localhost", expected: "https://localhost" },
  // nothing a form should post
  { typed: "", expected: null },
  { typed: "   ", expected: null },
  { typed: "not an address", expected: null },
  { typed: "javascript:alert(1)", expected: null },
  { typed: "custom://iterate.example.com", expected: null },
])("'$typed' names $expected", ({ typed, expected }) => {
  expect(deploymentOriginOf(typed)).toBe(expected);
});

test("a browser remembers each deployment once, in the order it met them", () => {
  fakeStorage();
  rememberDeployment(SELF_HOST);
  rememberDeployment(ANOTHER);
  rememberDeployment(SELF_HOST);
  expect(rememberedDeployments()).toEqual([SELF_HOST, ANOTHER]);
});

test("a browser remembers eight deployments, and lets the oldest go", () => {
  fakeStorage();
  for (let at = 1; at <= 9; at += 1) rememberDeployment(`https://d${String(at)}.example.com`);
  const remembered = rememberedDeployments();
  expect(remembered).toHaveLength(8);
  expect(remembered[0]).toBe("https://d2.example.com");
  expect(remembered.at(-1)).toBe("https://d9.example.com");
});

test.for([
  { name: "something else's value", stored: '{"not":"a list"}' },
  { name: "broken JSON", stored: "[" },
])("$name in storage reads as none", ({ stored }) => {
  fakeStorage(stored);
  expect(rememberedDeployments()).toEqual([]);
});

test("a browser with no storage still works: nothing is remembered, and nothing throws", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw new Error("the storage is refused");
    },
    setItem: () => {
      throw new Error("the storage is refused");
    },
  });
  expect(rememberedDeployments()).toEqual([]);
  expect(() => rememberDeployment(SELF_HOST)).not.toThrow();
});

function fakeStorage(initial: string | null = null) {
  let stored = initial;
  vi.stubGlobal("localStorage", {
    getItem: () => stored,
    setItem: (_key: string, value: string) => {
      stored = value;
    },
  });
}
