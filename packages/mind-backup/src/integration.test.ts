// mindBackup, the integration: which requests its fetch answers, the export and restore round
// trip through it, and the card its install hook registers. The page's browser script is not run
// here, and which routing slug reaches it is the worker's dispatch.
import { Script } from "node:vm";
import { expect, test } from "vitest";
import { readBackup, writeBackup } from "./archive.ts";
import { exportMind } from "./export.ts";
import { mindBackup } from "./integration.ts";
import { fakeMind, sealSecret } from "./test-support.ts";

test.for([
  {
    name: "a visitor who is not a member is asked to sign in",
    path: "/",
    member: false,
    status: 401,
  },
  { name: "the page", path: "/", status: 200 },
  { name: "a path the page does not have", path: "/nope", status: 404 },
  { name: "a backup that is not kept", path: "/backups/missing.zip", status: 404 },
  { name: "a kept backup's name with a path in it", path: "/backups/a/b.zip", status: 404 },
  { name: "a part that does not exist", path: "/export.zip?part=everything", status: 400 },
  { name: "a restore that names no part", path: "/restore", method: "POST", status: 400 },
])("$name: $status", async ({ path, member, method, status }) => {
  const response = await fetchPage(
    fakeMind(),
    request(path, { member, method, body: method ? new Uint8Array(1) : undefined }),
  );
  expect(response).toMatchObject({ status });
});

test("the integration answers the backup routing slug, or the one it is given", () => {
  expect(mindBackup()).toMatchObject({ routingSlug: "backup" });
  expect(mindBackup({ slug: "safe" })).toMatchObject({ routingSlug: "safe" });
});

test("the page names the mind and lets its scripts reach only its own origin, and its script is one that a browser reads", async () => {
  const response = await fetchPage(fakeMind(), request("/"));
  const page = await response.text();
  const script = /<script type="module"[^>]*>([\s\S]*?)<\/script>/.exec(page)?.[1] || "";
  expect(page).toContain("<h1>Backup of source</h1>");
  expect(response.headers.get("content-security-policy")).toContain("connect-src 'self'");
  // The import is the browser's to load: the rest must parse, or no button on the page works.
  expect(
    () => new Script(`(async () => {${script.replace(/^\s*import .*$/m, "")}})`),
  ).not.toThrow();
  expect(script).toContain('"x-secrets-key"');
  // each key field is emptied after its one use
  expect(script).toContain('byId("export-key").value = ""');
  // page.ts says why the keyed download's link is in the document and why its address lives
  // on. A request that fails is said on the page.
  expect(script).toContain("document.body.append(link)");
  expect(script).not.toMatch(/link\.click\(\);\s*URL\.revokeObjectURL/);
  expect(script).toMatch(/catch \(error\) \{\s*show\(/);
});

test("export.zip downloads the parts asked for, and restore puts them onto another mind", async () => {
  const source = fakeMind({ kv: { a: "1" }, files: { "/a.txt": "hello" } });
  const download = await fetchPage(source, request("/export.zip?part=kv&part=files"));
  expect(download.headers.get("content-disposition")).toMatch(
    /^attachment; filename="source-\d{4}-\d{2}-\d{2}\.zip"$/,
  );
  const zip = new Uint8Array(await download.arrayBuffer());
  expect(readBackup(zip)).toMatchObject({ manifest: { parts: ["kv", "files"] } });

  const target = fakeMind();
  const restored = await fetchPage(
    target,
    request("/restore?part=kv", { method: "POST", body: zip }),
  );
  expect(await restored.json()).toEqual([{ part: "kv", restored: 1, notes: [] }]);
  expect(Object.fromEntries(target.kv)).toEqual({ a: "1" });
  expect([...target.files.keys()]).toEqual([]);
});

test("Back up now keeps a backup in the mind's files; the page lists it, and it downloads", async () => {
  const mind = fakeMind({ kv: { a: "1" } });
  const kept = await fetchPage(mind, request("/backup", { method: "POST" }));
  expect(kept).toMatchObject({ status: 303 });
  const [path] = [...mind.files.keys()];
  expect(path).toMatch(/^\/backups\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z\.zip$/);
  const page = await fetchPage(mind, request("/"));
  expect(await page.text()).toContain(`<a href="${path!.slice(1)}">`);
  const download = await fetchPage(mind, request(path!));
  expect(readBackup(new Uint8Array(await download.arrayBuffer()))).toMatchObject({
    kv: [{ key: "a", value: "1" }],
  });
});

test("a restore with the secrets key of the backup's deployment sets each sealed secret as it was; with a wrong key it sets nothing and says so", async () => {
  const cell = await sealSecret(
    "sk-test",
    {
      context: "mind_source.iterate/secrets/openai",
      urls: ["https://api.openai.com"],
      nonce: "nonce-3",
    },
    "source-deployment-key",
  );
  const source = fakeMind({
    secrets: [
      { path: "/secrets/openai", urls: ["https://api.openai.com"], createdAt: "2026-10-01" },
    ],
    cells: { "/secrets/openai": cell },
  });
  const download = await fetchPage(source, request("/export.zip?part=secrets"));
  const zip = new Uint8Array(await download.arrayBuffer());
  expect(readBackup(zip)).toMatchObject({ secrets: [{ path: "/secrets/openai", sealed: cell }] });

  const wrong = fakeMind();
  const refused = await fetchPage(
    wrong,
    request("/restore?part=secrets", { method: "POST", body: zip, key: "another-key" }),
  );
  expect({ status: refused.status, text: await refused.text() }).toMatchObject({
    status: 400,
    text: expect.stringContaining("does not open with the key given"),
  });
  expect(wrong.calls).toMatchObject({ secretsSet: [], collectLinks: [] });

  const target = fakeMind();
  const restored = await fetchPage(
    target,
    request("/restore?part=secrets", { method: "POST", body: zip, key: "source-deployment-key" }),
  );
  expect(await restored.json()).toEqual([{ part: "secrets", restored: 1, notes: [], links: [] }]);
  expect(target.calls).toMatchObject({
    secretsSet: [
      {
        path: "/secrets/openai",
        material: "sk-test",
        options: { urls: ["https://api.openai.com"], refresh: undefined },
      },
    ],
    collectLinks: [],
  });
});

test("export.zip with the stack's at-rest key in its header holds each stored cell, and a restore with that key hands it back to the vault", async () => {
  const stored = JSON.stringify({ cell: { context: "/secrets/openai", version: 3 } });
  const stack = () =>
    fakeMind({
      secrets: [
        { path: "/secrets/openai", urls: ["https://api.openai.com"], createdAt: "2026-10-01" },
      ],
      vault: { key: "the-stack-key", stored: { "/secrets/openai": stored } },
    });
  const download = await fetchPage(
    stack(),
    request("/export.zip?part=secrets", { key: "the-stack-key" }),
  );
  const zip = new Uint8Array(await download.arrayBuffer());
  const target = stack();

  const restored = await fetchPage(
    target,
    request("/restore?part=secrets", { method: "POST", body: zip, key: "the-stack-key" }),
  );

  expect({
    inTheZip: readBackup(zip).secrets,
    restored: await restored.json(),
    taken: target.calls.cellsTaken,
  }).toMatchObject({
    inTheZip: [{ path: "/secrets/openai", stored }],
    restored: [{ part: "secrets", restored: 1 }],
    taken: [{ path: "/secrets/openai", cell: stored }],
  });
});

test.for([
  { name: "a body that is not a zip", body: new Uint8Array([1, 2, 3]), status: 400 },
  { name: "a backup over the budget", body: new Uint8Array(0), length: "999999999", status: 413 },
])("restore refuses $name", async ({ body, length, status }) => {
  const backup = writeBackup(await exportMind(fakeMind().itx, { parts: ["kv"] }));
  const response = await fetchPage(
    fakeMind(),
    request("/restore?part=kv", { method: "POST", body: body.length > 0 ? body : backup, length }),
  );
  expect(response).toMatchObject({ status });
});

test("the install hook registers the card on /integrations, keyed by the publication, and only then", async () => {
  const mind = fakeMind();
  const integration = mindBackup();
  const hook = (type: string) =>
    integration.processEvent!({
      // the hook reads the event's type, path and offset; the fake has what it calls, `cd`
      event: { type, path: "/", offset: 7 } as never,
      itx: mind.itx as never,
    });
  await hook("events.iterate.com/itx/woken");
  expect(mind.calls).toMatchObject({ appends: [] });
  await hook("events.iterate.com/mind/worker-updated");
  expect(mind.calls).toMatchObject({
    appends: [
      {
        path: "/integrations",
        event: {
          type: "events.iterate.com/integration/configured",
          idempotencyKey: "backup:registry:/@7",
          payload: {
            integration: "backup",
            card: {
              title: "Backup",
              description: expect.stringContaining("One zip of the mind"),
              status: { kind: "ok" },
              actions: [{ label: "Open", routingSlug: "backup", path: "/" }],
            },
          },
        },
      },
    ],
  });
});

/** A request to the page's host from a member unless told otherwise. */
function request(
  path: string,
  input: {
    member?: boolean;
    method?: string;
    body?: Uint8Array | false;
    length?: string;
    /** The secrets key a restore carries, as the page sends it. */
    key?: string;
  } = {},
) {
  const headers = new Headers({ "x-iterate-routing-slug": "backup" });
  if (input.member !== false) headers.set("x-itx-principal", '{"actor":"user_test"}');
  if (input.key) headers.set("x-secrets-key", input.key);
  // the length an upload arrives with at the edge, which a Request built here does not carry
  if (input.body) headers.set("content-length", input.length || String(input.body.length));
  return new Request(`https://backup--source.iterate.app${path}`, {
    method: input.method || "GET",
    headers,
    body: input.body || undefined,
  });
}

/** `request` handed to the integration's fetch by a worker whose root is the fake mind, with a
 *  member check that wants the platform's principal header, as `this.auth.require` does. */
function fetchPage(mind: ReturnType<typeof fakeMind>, incoming: Request) {
  return mindBackup().fetch!(incoming, {
    // the fake has no scope to release; the worker's getItx answers the real one
    getItx: () => Object.assign(mind.itx, { [Symbol.dispose]: () => {} }) as never,
    // the backup's pages ask for a member alone (`require`), never for a person
    auth: {
      require: (request: Request) =>
        request.headers.get("x-itx-principal") ? null : new Response("Sign in\n", { status: 401 }),
    } as never,
  });
}
