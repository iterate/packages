// cloud/worker.ts — ITERATE CLOUD IN A PROJECT'S CONFIG WORKER. The project that installs the Cloud
// (prd's `cloud`) is its origin: its config worker's `fetch` hands every request to `serveCloud`, and
// its `processEvent` calls `installCloud` on `project/worker-updated`, as Docs' install does:
//
//   import { installCloud, serveCloud } from "@iterate-com/cloud/worker";
//   export default class extends IterateConfigEntrypoint {
//     fetch(request) { return serveCloud(request, this, CLOUD); }
//     async processEvent({ event, itx }) {
//       if (event.type === "events.iterate.com/project/worker-updated") await installCloud(itx);
//     }
//   }
//
// The origin serves the Cloud app's pages, fetched through to its Worker (packages/cloud-app), which
// holds no session, no secret and no state. The platform answers `/api` and `/.auth/*` itself,
// sign-in and sign-out among them.
//
// THE CLOUD HAS NO API AND NO SIGN-IN OF ITS OWN. Who is signed in is who the platform's stamp says
// (`auth.person`, iterate/sdk core/lib/src/sdk/auth.ts). A visitor is no member of the project: the
// project lends them their own facets (durable-object.ts), which their page reaches through the
// platform's `/api`. A signed-in document load sets the person up for that (`setUpPerson`).
import type { IterateContextApi } from "iterate/api";
import type { IterateConfigEntrypoint } from "iterate/sdk";
import type { Platform } from "./records.ts";
import {
  PERSON_PROCESSOR,
  TOOLCHAIN_PATH,
  TOOLCHAIN_PROCESSOR,
  X_PATH,
  X_PROCESSOR,
} from "./specs.ts";

/** What the installing project's config says about its Cloud. */
export type CloudOptions = {
  /** The Cloud app's Worker (envs.ts `cloudAppEnvs`), which serves the pages. */
  frontend: string;
  /** The platform the Cloud runs on, the issuer every deployment signs its owner in through:
   *  `https://os.iterate.com` on prd. Under paths ingress the request says it (the Cloud is served
   *  at `<platform>/projects/<project>`); under subdomains only this does, and without it the Cloud
   *  makes no deployment. */
  issuer?: string;
  /** The platform's own Dash, when it is not iterate's: a deployment's `/` sends its owner there
   *  (the playground's, `cloud-dev-dash`). Unset on prd, whose Dash is core/os's default. */
  dash?: string;
  /** The Cloud's own Cloudflare OAuth client, through which people connect their accounts. */
  cloudflare: Platform["cloudflare"];
  /** The Cloud's own X OAuth client, through which people connect their X accounts; unset, no
   *  one connects X here. */
  x?: Platform["x"];
};

const BASE_PATH_HEADER = "x-iterate-base-path";

/** What the Cloud forwards of a visitor's request to the pages Worker: what picks the page's or the
 *  asset's representation, and what makes a conditional or a ranged read. */
const PAGE_REQUEST_HEADERS = [
  "accept",
  "accept-encoding",
  "accept-language",
  "if-modified-since",
  "if-none-match",
  "range",
  "user-agent",
];

/** The config worker the Cloud runs in: its itx, and who the platform says is calling. */
type Host = {
  getItx(): IterateContextApi & Disposable;
  auth: Pick<IterateConfigEntrypoint["auth"], "person">;
};

export async function serveCloud(
  request: Request,
  host: Host,
  options: CloudOptions,
): Promise<Response> {
  // Under paths ingress the edge serves the Cloud at `<platform>/projects/<project>`, strips that
  // from the URL and says it in this header (iterate/project-ingress `ITERATE_BASE_PATH_HEADER`,
  // spelled out: that module is not one a loaded worker is given): every address the Cloud names
  // carries it. Plain path segments only, as @iterate-com/ui/apps/base-path reads it.
  const said = request.headers.get(BASE_PATH_HEADER) || "";
  let basePath = /^(?:\/[a-z0-9-]+)+$/.test(said) ? said : "";
  // There a project's apex is `/projects/<project>/` alone: the edge reads any segment after it as a
  // routing slug (iterate/project-ingress `projectAddressOf`), so `/projects/cloud/sign-in/x`
  // arrives as slug `sign-in` with base path `/projects/cloud/sign-in`. The Cloud owns every slug of
  // its project, so the slug goes back into the path. Under subdomains a slug is in the host and
  // the base path is "", so nothing moves.
  const slug = request.headers.get("x-iterate-routing-slug");
  if (slug && basePath.endsWith(`/${slug}`)) {
    basePath = basePath.slice(0, -slug.length - 1);
    const moved = new URL(request.url);
    moved.pathname = `/${slug}${moved.pathname === "/" ? "" : moved.pathname}`;
    request = new Request(moved, request);
  }
  const url = new URL(request.url);

  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Not found\n", { status: 404 });
  const person = host.auth.person(request);
  if (person && isDocumentLoad(request))
    await setUpPerson(host, person, {
      issuer: options.issuer || (basePath ? url.origin : null),
      dash: options.dash || null,
      cloudflare: options.cloudflare,
      x: options.x || null,
    });
  // the pages: nothing of the visitor's goes with them. Only the headers a page or an asset is
  // chosen by are forwarded, so no cookie, no bearer and none of the edge's stamps of who the
  // caller is (`x-itx-person`, `x-itx-principal`) reach the pages Worker
  const page = new URL(`${url.pathname}${url.search}`, options.frontend);
  const headers = new Headers();
  for (const name of PAGE_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  // the pages render their links under it (@iterate-com/ui/apps/base-path)
  headers.set(BASE_PATH_HEADER, basePath);
  const answer = await fetch(
    new Request(page, { method: request.method, headers, redirect: "manual" }),
  );
  if (answer.ok || answer.status === 304) return answer;
  // a page or a chunk missing now (a deploy's version skew) is never kept: the pages Worker's
  // `_headers` give everything under /assets a year, its 404 included
  const refused = new Response(answer.body, answer);
  refused.headers.set("cache-control", "no-store");
  return refused;
}

/** On `project/worker-updated`: the toolchain's processor, which every deployment's sandbox
 *  starts from, and the Cloud's X context with the X client the config names. Idempotent. An
 *  operator then prepares the toolchain with one event (toolchain.ts). */
export async function installCloud(itx: IterateContextApi, options?: Pick<CloudOptions, "x">) {
  await itx
    .cd(TOOLCHAIN_PATH)
    .processors.enable(TOOLCHAIN_PROCESSOR.name, TOOLCHAIN_PROCESSOR.spec);
  // the Cloud on X: its context, and the X client it speaks through when the config names one
  const x = itx.cd(X_PATH);
  await x.processors.enable(X_PROCESSOR.name, X_PROCESSOR.spec);
  if (options?.x)
    await x.append({
      type: "cloud/x-client-configured",
      idempotencyKey: `x-client-configured:${options.x.clientId}:${options.x.secret}`,
      payload: { clientId: options.x.clientId, secret: options.x.secret },
    });
}

/** A page, not one of its assets: what a browser loads into a tab. */
const isDocumentLoad = (request: Request) =>
  request.method === "GET" &&
  (request.headers.get("sec-fetch-dest") === "document" ||
    (request.headers.get("accept") || "").includes("text/html"));

/** THE PERSON'S CONTEXT, `/people/<sub>`, made ready before their page loads, in this order:
 *
 *   1. the person's processor, `cloud-person`;
 *   2. a rule that sends the context's `itx.fetch` to the root's, the project's egress, which
 *      fills a connection's token in the facet's requests to Cloudflare (cloudflare.ts);
 *   3. `cloud/platform-configured`, the platform the person's connects and deployments go
 *      through (the issuer, its own Dash, and the Cloudflare client), keyed by what it says, so a config that
 *      names another records it once more;
 *   4. `cloud/person-signed-in`, keyed by everything it says (the person's id and email, and the
 *      admin's, when one is signed in as them). The platform refuses an append whose key it holds
 *      with another payload (core/os/src/stream/stream.ts, IDEMPOTENCY_CONFLICT), so a key of the
 *      id alone would refuse a person whose email changed; this way the change is one more record,
 *      and the reduce takes the newer email;
 *   5. the facet lent to the person, which is what lets their page reach it through `/api`.
 *
 *  Each step is idempotent, so this isolate remembers whom it has set up and skips them next time;
 *  a new isolate repeats the steps once, harmlessly. */
async function setUpPerson(
  host: Host,
  stamped: NonNullable<ReturnType<Host["auth"]["person"]>>,
  platform: Platform,
) {
  const person = { sub: stamped.userId, email: stamped.email };
  const admin = stamped.impersonatedBy;
  const key = [person.sub, person.email, admin?.actor || "", admin?.email || ""].join(":");
  const said = [
    platform.issuer || "",
    platform.dash || "",
    platform.cloudflare.clientId,
    platform.cloudflare.secret,
    platform.x?.clientId || "",
    platform.x?.secret || "",
  ].join(" ");
  if (setUp.has(`${key}|${said}`)) return;
  using itx = host.getItx();
  const context = itx.cd(`/people/${person.sub}`);
  await context.processors.enable(PERSON_PROCESSOR.name, PERSON_PROCESSOR.spec);
  await context.append({
    type: "events.iterate.com/itx/rewrite-rule-configured",
    idempotencyKey: "cloud/person-egress",
    payload: {
      match: "itx.fetch",
      target: "itx.cd('/').fetch",
      description: "the project's egress, for the person's requests to Cloudflare",
    },
  });
  await context.append({
    type: "cloud/platform-configured",
    idempotencyKey: `platform-configured:${said}`,
    payload: {
      issuer: platform.issuer,
      dash: platform.dash,
      cloudflare: { clientId: platform.cloudflare.clientId, secret: platform.cloudflare.secret },
      x: platform.x && { clientId: platform.x.clientId, secret: platform.x.secret },
    },
  });
  await context.append({
    type: "cloud/person-signed-in",
    idempotencyKey: `person-signed-in:${key}`,
    // oxlint-disable-next-line iterate/simple-truthiness-check -- an `impersonatedBy: undefined` key differs from none in the platform's idempotent retry (core/lib/src/lib.ts `jsonEqual` counts keys; the stored event has none), which would refuse every append after the first as IDEMPOTENCY_CONFLICT: only an impersonation carries the key
    payload: { ...person, ...(admin && { impersonatedBy: admin }) },
  });
  await context.facets.lend(PERSON_PROCESSOR.name, { to: person.sub });
  setUp.add(`${key}|${said}`);
}

/** The people (with the admin signed in as them, if any, and the platform) this isolate has set up. */
const setUp = new Set<string>();
