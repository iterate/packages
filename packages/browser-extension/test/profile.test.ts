// What the extension takes from a mind's profile (public/profile.js): a name and a logo to show
// beside the address, and nothing that the owner's own words could use against the person.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mindAddressOf, mindProfileOf, readMindProfile } from "../public/profile.js";

const issuer = "https://iterate.example.com";
/** What `readMindProfile` answers while the website answers `answer`, and what it asked. */
async function readWith(answer: () => Response) {
  const asked: { url: string; init: RequestInit }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    asked.push({ url: String(url), init });
    return answer();
  };
  try {
    return { profile: await readMindProfile(issuer), asked };
  } finally {
    globalThis.fetch = realFetch;
  }
}

void test("the address is the issuer's hostname without its iterate label", () => {
  assert.equal(mindAddressOf(issuer), "example.com");
  assert.equal(mindAddressOf("https://control.example.com:8443"), "control.example.com");
});

void test("a named mind with a logo on its own website keeps both", () => {
  assert.deepEqual(
    mindProfileOf({ name: "Ada's mind", icon: "https://example.com/favicon.svg" }, issuer),
    { name: "Ada's mind", icon: "https://example.com/favicon.svg" },
  );
  assert.equal(
    mindProfileOf({ icon: "https://dash.example.com/icon.svg" }, issuer).icon,
    "https://dash.example.com/icon.svg",
  );
});

void test("a mind that gave itself no name has none: the profile's default is its hostname", () => {
  for (const name of ["example.com", "Example.COM", "iterate.example.com", "", "   ", 7, null])
    assert.equal(mindProfileOf({ name }, issuer).name, "", String(name));
  assert.deepEqual(mindProfileOf(null, issuer), { name: "", icon: null });
});

void test("a name is one bounded line with no character that reorders the text after it", () => {
  assert.equal(
    mindProfileOf({ name: "  Ada\n\u202emoc.elgoog\u2066\t mind  " }, issuer).name,
    "Ada moc.elgoog mind",
  );
  assert.equal(mindProfileOf({ name: "x".repeat(500) }, issuer).name.length, 80);
  // markup stays text: the panel escapes it and the label writes it as textContent
  assert.equal(mindProfileOf({ name: "<img src=x>" }, issuer).name, "<img src=x>");
});

void test("a logo that is not an https address on the mind's own hosts is not shown", () => {
  for (const icon of [
    "http://example.com/favicon.svg",
    "https://evil.test/favicon.svg",
    "https://notexample.com/favicon.svg",
    "https://example.com.evil.test/favicon.svg",
    "https://user:secret@example.com/favicon.svg",
    "https://example.com:8443/favicon.svg",
    "javascript:alert(1)",
    "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>",
    "/favicon.svg",
    `https://example.com/${"x".repeat(3000)}`,
    { href: "https://example.com/favicon.svg" },
    null,
  ])
    assert.equal(mindProfileOf({ name: "Ada", icon }, issuer).icon, null, String(icon));
});

void test("the profile is read from the mind's website, with no credential and no referrer", async () => {
  const { profile, asked } = await readWith(() =>
    Response.json({ name: "Ada", description: "x", icon: "https://example.com/favicon.svg" }),
  );
  assert.deepEqual(profile, { name: "Ada", icon: "https://example.com/favicon.svg" });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].url, "https://example.com/.well-known/iterate-profile");
  assert.equal(asked[0].init.credentials, "omit");
  assert.equal(asked[0].init.redirect, "error");
  assert.equal(asked[0].init.referrerPolicy, "no-referrer");
});

void test("a website that answers no profile gives none", async () => {
  for (const answer of [
    () => new Response("Not found\n", { status: 404 }),
    () => new Response("<!doctype html>"),
    () => Response.json(["Ada"]),
    () => Response.json({ name: "Ada", description: "x".repeat(20_000) }),
    () => {
      throw new TypeError("Failed to fetch");
    },
  ])
    assert.equal((await readWith(answer)).profile, null);
});
