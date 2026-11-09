// examples/bun-box/server.ts — A BOX: a Bun server on a laptop with no public origin, behind the
// Cloud's router. At start it dials the Cloud's platform with plain capnweb and provides the stub
// that ../../src/registry.ts (`Provided`) describes; README.md shows the whole flow.
// `ITERATE_BEARER_TOKEN` is a personal access token of the project, `ITERATE_PROJECT` its slug.
import { existsSync } from "node:fs";
import { newWebSocketRpcSession, RpcTarget } from "capnweb";
import { z } from "zod";
import { BOX_FILE, readBoxFile, writeBoxFile } from "./box-file.ts";

const PLATFORM = process.env.ITERATE_BASE_URL || "https://os.iterate.com";
const PROJECT = process.env.ITERATE_PROJECT;
const TOKEN = process.env.ITERATE_BEARER_TOKEN;
if (!PROJECT || !TOKEN) throw new Error("ITERATE_PROJECT and ITERATE_BEARER_TOKEN are required");
/** The header the router names the deployment with (cloud-router src/registry.ts). */
const DEPLOYMENT_HEADER = "x-iterate-cloud-deployment";

type Event = { type: string; idempotencyKey?: string; payload: Record<string, unknown> };
type Stored = Event & { projectId: string; path: string; offset: number; at: string };

const hex = (bytes: number) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
if (!existsSync(BOX_FILE))
  writeBoxFile({ deployment: `box${hex(4)}`, hookSecret: hex(32), projects: {} });

// ── the deployment API, as far as the router asks it ─────────────────────────────────────────────

const events: Stored[] = [];

class Context extends RpcTarget {
  constructor(
    readonly projectId: string,
    readonly path: string,
  ) {
    super();
  }
  append(event: Event) {
    // idempotent, as the platform's append is: a redelivery lands nothing new
    const again = events.find(
      (e) =>
        e.projectId === this.projectId &&
        e.idempotencyKey &&
        e.idempotencyKey === event.idempotencyKey,
    );
    if (again) return { offset: again.offset };
    const stored = {
      ...event,
      projectId: this.projectId,
      path: this.path,
      offset: events.length + 1,
      at: new Date().toISOString(),
    };
    events.push(stored);
    console.log(
      `append ${this.projectId}${this.path} ${event.type}`,
      JSON.stringify(summary(stored)),
    );
    return { offset: stored.offset };
  }
}

class Project extends RpcTarget {
  constructor(readonly projectId: string) {
    super();
  }
  whoami() {
    return { projectId: this.projectId };
  }
  cd(path: string) {
    return new Context(this.projectId, path);
  }
}

class Projects extends RpcTarget {
  /** By slug or by id, as the platform's `projects.get` takes either. */
  get(ref: string) {
    const projects = readBoxFile().projects;
    const id = projects[ref] || Object.values(projects).find((known) => known === ref);
    if (!id) throw new Error(`No project ${ref} on this box.`);
    return new Project(id);
  }
}

/** The one stub the box provides. Whoever can call it is a member of the project that holds it on
 *  the Cloud's platform (or the platform's operator: the router), so it asks no credential. */
class BoxStub extends RpcTarget {
  get projects() {
    return new Projects();
  }
  fetch(request: Request) {
    return serve(request);
  }
}

// ── the pages ────────────────────────────────────────────────────────────────────────────────────

function serve(request: Request) {
  const url = new URL(request.url);
  const page = /^\/projects\/([^/]+)(\/.*)?$/.exec(url.pathname);
  const slug = page?.[1] || "";
  const projectId = readBoxFile().projects[slug];
  console.log(`${request.method} ${url.pathname}`);
  if (!projectId)
    return new Response(`This box serves no project ${JSON.stringify(slug)}.\n`, { status: 404 });
  return new Response(inbox(slug, projectId, page?.[2] || "/"), {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/** What the inbox shows of a payload: a mail's (iterate-cloud/email-received), or nothing. */
const MailPayload = z
  .object({ from: z.string(), subject: z.string(), text: z.string().nullable() })
  .partial()
  .catch({});

function summary(event: Stored) {
  const p = MailPayload.parse(event.payload);
  return {
    offset: event.offset,
    type: event.type,
    from: p.from,
    subject: p.subject,
    text: p.text?.slice(0, 200),
  };
}

function inbox(slug: string, projectId: string, path: string) {
  const escape = (text: unknown) =>
    String(text ?? "").replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
    );
  const mine = events.filter((event) => event.projectId === projectId);
  const rows = [...mine]
    .reverse()
    .map(
      (event) =>
        `<li><code>${escape(event.type)}</code> ${escape(event.at)}<pre>${escape(JSON.stringify(summary(event), null, 2))}</pre></li>`,
    )
    .join("");
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escape(slug)} on a Bun box</title>
<body style="font:16px system-ui;max-width:42rem;margin:2rem auto;padding:0 1rem">
<h1>${escape(slug)} 🥟</h1>
<p>Served by Bun ${escape(Bun.version)} on a laptop, through a stub it provided to the Cloud's platform. Path: <code>${escape(path)}</code></p>
<p>Mail to <code>${escape(slug)}@iterate2.app</code> lands here.</p>
<h2>Inbox (${mine.length})</h2><ul>${rows || "<li>Nothing yet.</li>"}</ul>`;
}

// ── the dial: one capnweb session, one provide, again whenever it drops ──────────────────────────

/** Serve over one session until it breaks or the lend ends; resolves with why. */
async function dial(): Promise<string> {
  const url = new URL("/api", PLATFORM);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  using root = newWebSocketRpcSession<any>(url.href);
  const broken = new Promise<string>((resolve) =>
    root.onRpcBroken((error: unknown) => resolve(`session broke: ${String(error)}`)),
  );
  using session = await root.authenticate({ type: "bearer", token: TOKEN });
  using project = session.projects.get(PROJECT);
  const listed: { id: string; slug: string }[] = await session.projects.list();
  const projectId = listed.find((row) => row.slug === PROJECT || row.id === PROJECT)?.id;
  if (!projectId) throw new Error(`The token reaches no project ${PROJECT}`);
  const host = new URL(await project.url()).origin;
  const box = readBoxFile();
  const at = `itx.boxes.${box.deployment}`;
  using lend = await project.provide(at, new BoxStub(), {
    description: "A Bun box behind the Cloud's router: its pages, and its projects' mail",
    fetchRoute: {
      fetchRouteName: `cloud-${box.deployment}`,
      requestMatcher: { headers: { [DEPLOYMENT_HEADER]: box.deployment } },
      authRequirement: null,
    },
  });
  writeBoxFile({ ...readBoxFile(), provided: { project: projectId, host, at } });
  console.log(`provided ${at} on ${PROJECT} (${projectId}) at ${host}`);
  // the heartbeat: Cloudflare sheds a stateless Worker's socket it counts idle, and a vanished
  // network never closes one (core/lib client/heartbeat.ts)
  const beats = setInterval(() => {
    const dead = setTimeout(() => root[Symbol.dispose](), 15_000);
    void Promise.resolve(session.whoami()).finally(() => clearTimeout(dead));
  }, 30_000);
  try {
    return await Promise.race([
      broken,
      lend.lendEnded().then((why: string) => `lend ended: ${why}`),
    ]);
  } finally {
    clearInterval(beats);
  }
}

for (let attempt = 0; ; attempt++) {
  try {
    const why = await dial();
    console.log(`${why}; dialling again`);
    attempt = 0;
  } catch (error) {
    console.error(`dial failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, 1_000 * 2 ** attempt)));
}
