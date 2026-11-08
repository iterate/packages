import { expect, test, vi } from "vitest";
import { Registry } from "./registry.ts";
import router, { receivedOf, slugOfAddress, type Env } from "./worker.ts";

const ORIGIN = "https://one.example";

test("a project's hosts go to the deployment's paths ingress: the apex, a routing slug, a page's own link, a redirect back to the host", async () => {
  const { env } = await setup();
  const seen: Request[] = [];
  let location: string | null = null;
  vi.stubGlobal("fetch", async (request: Request) => {
    seen.push(request);
    return new Response("hi", {
      status: location ? 302 : 200,
      headers: location ? { location } : {},
    });
  });
  await router.fetch(new Request("https://first.iterate2.app/"), env);
  await router.fetch(
    new Request("https://blog--first.iterate2.app/post?x=1", {
      method: "POST",
      headers: { "x-itx-principal": "forged", cookie: "c=1" },
      body: "payload",
    }),
    env,
  );
  await router.fetch(new Request("https://first.iterate2.app/projects/first/assets/a.js"), env);
  expect(seen.map((request) => request.url)).toEqual([
    `${ORIGIN}/projects/first/`,
    `${ORIGIN}/projects/first/blog/post?x=1`,
    `${ORIGIN}/projects/first/assets/a.js`,
  ]);
  expect(seen[1]!.headers.has("x-itx-principal")).toBe(false);
  expect(seen[1]!.headers.get("cookie")).toBe("c=1");
  expect(await seen[1]!.text()).toBe("payload");

  location = `${ORIGIN}/projects/first/blog/signed-in?y=2`;
  const moved = await router.fetch(new Request("https://blog--first.iterate2.app/go"), env);
  expect(moved.headers.get("location")).toBe("https://blog--first.iterate2.app/signed-in?y=2");
  location = "https://elsewhere.example/";
  const away = await router.fetch(new Request("https://first.iterate2.app/go"), env);
  expect(away.headers.get("location")).toBe("https://elsewhere.example/");

  const unknown = await router.fetch(new Request("https://nobody.iterate2.app/"), env);
  expect([unknown.status, await unknown.text()]).toEqual([
    421,
    "No iterate deployment holds nobody.iterate2.app.\n",
  ]);
  expect(await router.fetch(new Request("https://iterate2.app/"), env)).toMatchObject({
    status: 404,
  });
});

test("a message becomes the Cloud's email-received payload in core's shape, with nothing vouched for and no attachment; an unrouted address is refused", async () => {
  const raw = [
    "From: Ada <ada@example.com>",
    "To: first@iterate2.app",
    "Cc: bob@example.com",
    "Subject: Hello",
    "Message-ID: <m1@example.com>",
    "In-Reply-To: <m0@example.com>",
    "References: <a@example.com> <m0@example.com>",
    "Precedence: bulk",
    "",
    "Hi there",
  ].join("\r\n");
  const payload = await receivedOf({
    from: "bounce@example.com",
    to: "first+news@iterate2.app",
    raw: new Response(raw).body!,
    headers: new Headers({ precedence: "bulk" }),
  });
  expect(payload).toMatchObject({
    messageId: "m1@example.com",
    from: "ada@example.com",
    to: ["first@iterate2.app"],
    cc: ["bob@example.com"],
    subject: "Hello",
    html: null,
    inReplyTo: "m0@example.com",
    references: ["a@example.com", "m0@example.com"],
    attachments: [],
    envelope: { from: "bounce@example.com", to: "first+news@iterate2.app" },
    sender: { verified: false, member: false, direct: false },
    automated: true,
    authentication: { spf: null, dkim: null, dmarc: null },
  });
  expect(payload.text?.trim()).toBe("Hi there");

  const { env } = await setup();
  const setReject = vi.fn();
  await router.email(
    {
      from: "a@example.com",
      to: "nobody@iterate2.app",
      setReject,
    } as unknown as ForwardableEmailMessage,
    env,
  );
  expect(setReject).toHaveBeenCalledWith("No such address.");
});

test("mail out is a signed delivery from the project's own address, acked with what happened recorded on the project; a bad secret halts the row", async () => {
  const { env } = await setup();
  // the deployment's admin API, where the router records the outcome
  const appended: { url: string; body: string }[] = [];
  // capnweb posts the batch as the init of the authorized Request; the pull is of import 4, the
  // append at the end of the pipeline
  vi.stubGlobal("fetch", async (request: Request, init?: RequestInit) => {
    appended.push({ url: request.url, body: String(init?.body || (await request.text())) });
    return new Response('["resolve",4,[[{"offset":10}]]]', { status: 200 });
  });
  const event = {
    offset: 9,
    path: "/iterate-cloud",
    type: "iterate-cloud/email-requested",
    payload: { from: "first@iterate2.app", to: "ada@example.com", subject: "Hello", text: "Hi" },
  };
  const deliver = async (
    id: string,
    body: unknown,
    options: { secret?: string; age?: number; project?: string } = {},
  ) => {
    const { secret = "hook-secret", age = 0, project = "prj_first" } = options;
    const json = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000) - age);
    return await router.fetch(
      new Request(`https://iterate2.app/.cloud/hooks/${id}`, {
        method: "POST",
        headers: {
          "iterate-event-id": `${project}/iterate-cloud@9`,
          "iterate-timestamp": timestamp,
          "iterate-signature": `v1=${await hmac(secret, `${timestamp}.${json}`)}`,
        },
        body: json,
      }),
      env,
    );
  };
  expect(await (await deliver("dep_1", event)).json()).toEqual({ id: "m-1" });
  expect(env.EMAIL.send).toHaveBeenCalledWith(event.payload);
  expect(appended).toHaveLength(1);
  expect(appended[0]!).toMatchObject({ url: `${ORIGIN}/api` });
  expect(appended[0]!.body).toContain('"iterate-cloud/email-sent"');
  expect(appended[0]!.body).toContain('"requestOffset":9');

  // a wrong secret or a stale delivery: the row halts until an operator resumes it
  expect(await deliver("dep_1", event, { secret: "wrong" })).toMatchObject({ status: 410 });
  expect(await deliver("dep_1", event, { age: 3600 })).toMatchObject({ status: 410 });

  // a message that can never go is acked, and its failure recorded on the project
  const other = await deliver("dep_2", event, { secret: "other-secret", project: "prj_other" });
  expect([other.status, await other.json()]).toEqual([
    200,
    { error: "first@iterate2.app is not this project's address." },
  ]);
  const stranger = await deliver("dep_1", event, { project: "prj_other" });
  expect(await stranger.json()).toEqual({
    error: "first@iterate2.app is not this project's address.",
  });
  const bodiless = await deliver("dep_1", {
    ...event,
    payload: { ...event.payload, text: undefined },
  });
  expect(await bodiless.json()).toMatchObject({
    error: expect.stringMatching(/text or an html body/),
  });
  expect(
    appended.filter((call) => call.body.includes('"iterate-cloud/email-failed"')),
  ).toHaveLength(3);
  expect(env.EMAIL.send).toHaveBeenCalledTimes(1);

  // a sent message whose record cannot be written is still acked: never sent twice
  vi.stubGlobal("fetch", async () => new Response("down", { status: 503 }));
  const unrecorded = await deliver("dep_1", { ...event, offset: 12 });
  expect([unrecorded.status, await unrecorded.json()]).toEqual([200, { id: "m-1" }]);
  // a refusal whose record cannot be written is not acked: nothing was sent, the platform retries
  const unrecordedRefusal = await deliver(
    "dep_1",
    { ...event, offset: 13 },
    { project: "prj_other" },
  );
  expect(unrecordedRefusal.status).toBeGreaterThanOrEqual(500);
  expect(env.EMAIL.send).toHaveBeenCalledTimes(2);
});

test("an address's slug: lowercase, its +tag dropped, only under the zone", () => {
  expect(slugOfAddress(" First+x@ITERATE2.app ", "iterate2.app")).toBe("first");
  expect(slugOfAddress("first@example.com", "iterate2.app")).toBeNull();
});

/** A router with deployment dep_1 at ORIGIN holding `first`, and dep_2 holding nothing. */
test("egress through the Cloud: a lent secret is filled, the hook secret is the pass, a name not lent sends nothing", async () => {
  const { env, registry } = await setup();
  await registry.setLends("dep_1", { openai: "sk-lent" });
  const seen: Request[] = [];
  vi.stubGlobal("fetch", async (request: Request) => {
    seen.push(request);
    return new Response("answer", { status: 200 });
  });
  const egress = (headers: Record<string, string>, path = "api.openai.com/v1/chat?x=1") =>
    router.fetch(
      new Request(`https://iterate2.app/.cloud/egress/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: "{}",
      }),
      env,
    );
  const filled = await egress({
    "x-itx-cloud": "hook-secret",
    authorization: 'Bearer cloudSecret("openai")',
  });
  expect([filled.status, await filled.text()]).toEqual([200, "answer"]);
  expect(seen[0]!).toMatchObject({ url: "https://api.openai.com/v1/chat?x=1" });
  expect(seen[0]!.headers.get("authorization")).toBe("Bearer sk-lent");
  expect(seen[0]!.headers.has("x-itx-cloud")).toBe(false);
  expect(await seen[0]!.text()).toBe("{}");

  const unknown = await egress({
    "x-itx-cloud": "nope",
    authorization: 'Bearer cloudSecret("openai")',
  });
  expect([unknown.status, seen.length]).toEqual([401, 1]);
  const notLent = await egress({
    "x-itx-cloud": "hook-secret",
    authorization: 'Bearer cloudSecret("stripe")',
  });
  expect([notLent.status, await notLent.text(), seen.length]).toEqual([
    403,
    "The Cloud lends this deployment no secret named stripe.\n",
    1,
  ]);
  const noHost = await egress({ "x-itx-cloud": "hook-secret" }, "nohost");
  expect([noHost.status, seen.length]).toEqual([400, 1]);
});

async function setup() {
  const kv = new Map<string, string>();
  const store = {
    get: async (key: string) => kv.get(key) ?? null,
    put: async (key: string, value: string) => void kv.set(key, value),
    delete: async (key: string) => void kv.delete(key),
  };
  const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
  const registry = new Registry(store, key);
  await registry.setDeployment("dep_1", {
    origin: ORIGIN,
    bearer: "bearer-one",
    hookSecret: "hook-secret",
  });
  await registry.setDeployment("dep_2", {
    origin: "https://two.example",
    bearer: "bearer-two",
    hookSecret: "other-secret",
  });
  await registry.setRoute("first", { deployment: "dep_1", projectId: "prj_first" });
  // nothing in the namespace is readable without the key
  expect(JSON.stringify([...kv.values()])).not.toMatch(/one\.example|hook-secret|bearer-one/);
  const env: Env = {
    // safe: the registry calls get and put alone (registry.ts `Store`)
    REGISTRY: store as unknown as KVNamespace,
    // safe: the router calls `send` alone
    EMAIL: { send: vi.fn(async () => ({ messageId: "m-1" })) } as unknown as SendEmail,
    ZONE: "iterate2.app",
    CLOUD_ROUTER_KV_KEY: key,
  };
  return { env, registry };
}

async function hmac(secret: string, message: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
