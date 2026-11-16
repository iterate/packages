import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

void test("OAuth waits for durable refresh intent after its asynchronous expiry check", async () => {
  let now = 69_999;
  let read;
  let mark;
  const reading = new Promise((resolve) => {
    read = resolve;
  });
  const marking = new Promise((resolve) => {
    mark = resolve;
  });
  const requests = [];
  const context = vm.createContext({
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    URLSearchParams,
    fetch: async (url) => {
      requests.push(url);
      return {
        ok: true,
        json: async () =>
          url.endsWith("/token")
            ? { access_token: "fixture-access", refresh_token: "fixture-next", expires_in: 3600 }
            : { token_endpoint: "https://issuer.test/token" },
      };
    },
  });
  const module = new vm.SourceTextModule(
    readFileSync(new URL("../../spa/public/oauth.js", import.meta.url), "utf8"),
    { context },
  );
  await module.link(() => {
    throw Error("Unexpected import");
  });
  await module.evaluate();
  let session = {
    issuer: "https://issuer.test",
    clientId: "fixture",
    expiresAt: 100_000,
    accessToken: "fixture-cached",
    refreshToken: "fixture-refresh",
  };
  let intents = 0;
  const oauth = module.namespace.oauthClient({
    sessions: {
      get: async () => {
        await reading;
        return session;
      },
      set: async (_key, value) => {
        session = value;
      },
    },
    beforeRefresh: async () => {
      intents += 1;
      await marking;
    },
  });
  const pending = oauth.freshAccessToken();
  now = 70_001;
  read();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(intents, 1);
  assert.equal(requests.length, 0);
  mark();
  assert.equal(await pending, "fixture-access");
  assert.equal(requests.length, 2);
  assert.equal(await oauth.freshAccessToken(), "fixture-access");
  assert.equal(intents, 1);
});
void test("a rejected refresh-intent write prevents the rotating request", async () => {
  let requests = 0;
  const context = vm.createContext({
    Date,
    URLSearchParams,
    fetch: async () => {
      requests += 1;
      throw Error("Must not fetch");
    },
  });
  const module = new vm.SourceTextModule(
    readFileSync(new URL("../../spa/public/oauth.js", import.meta.url), "utf8"),
    { context },
  );
  await module.link(() => {
    throw Error("Unexpected import");
  });
  await module.evaluate();
  const oauth = module.namespace.oauthClient({
    sessions: {
      get: async () => ({ issuer: "https://issuer.test", expiresAt: 0, refreshToken: "fixture" }),
    },
    beforeRefresh: async () => {
      throw Error("Intent not durable");
    },
  });
  await assert.rejects(oauth.freshAccessToken(), /Intent not durable/);
  assert.equal(requests, 0);
});
