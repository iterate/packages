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
// The origin serves three things, and the platform answers `/api` and `/.auth/*` itself, sign-in
// and sign-out among them:
//
//   /rpc                   the person's capnweb API (api.ts)
//   /connected             where the platform's OAuth callback sends a Cloudflare connect back
//   anything else          the Cloud app's pages, fetched through to its Worker (packages/cloud-app),
//                          which holds no session, no secret and no state
//
// THE CLOUD HAS NO SIGN-IN OF ITS OWN: `/rpc` and `/connected` ask for a person with
// `auth.requirePerson`, and `auth.person` says who the caller is (iterate/sdk, core/lib/src/sdk/auth.ts).
// A visitor is no member of the project and gets no platform grant on it: every answer is limited
// to that person's things.
import type { IterateContextApi } from "iterate/api";
import { newWorkersRpcResponse, type IterateConfigEntrypoint } from "iterate/sdk";
import {
  CloudApi,
  accountsOf,
  facetSpecOf,
  personPathOf,
  type CloudflareClient,
  type Person,
} from "./api.ts";
import { PersonContract, ToolchainContract } from "./contract.ts";
import type { PersonState } from "./records.ts";
import { connectionSecretOf } from "./runs.ts";

/** What the installing project's config says about its Cloud. */
export type CloudOptions = {
  /** The Cloud app's Worker (envs.ts `cloudAppEnvs`), which serves the pages. */
  frontend: string;
  cloudflare: CloudflareClient;
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

/** The config worker the Cloud runs in: its itx, its `waitUntil`, and the platform's guards. */
type Host = {
  getItx(): IterateContextApi & Disposable;
  ctx: { waitUntil(work: Promise<unknown>): void };
  auth: Pick<IterateConfigEntrypoint["auth"], "requirePerson" | "person">;
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

  if (url.pathname === "/rpc" || (url.pathname === "/connected" && request.method === "GET")) {
    const denied = host.auth.requirePerson(request);
    if (denied) return denied;
    const person = await personOf(host, request);
    if (url.pathname === "/connected") {
      const connection = url.searchParams.get("connection") ?? "";
      await withItx(host, (itx) => finishConnect(itx, person, connection));
      return redirect(url, `${basePath}/new?${new URLSearchParams({ connection })}`);
    }
    return newWorkersRpcResponse(
      request,
      new CloudApi({
        person,
        getItx: () => host.getItx(),
        waitUntil: (work) => host.ctx.waitUntil(work),
        cloudflare: options.cloudflare,
        basePath,
      }),
    );
  }

  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Not found\n", { status: 404 });
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
 *  starts from. Idempotent. An operator then prepares it with one event (toolchain.ts). */
export async function installCloud(itx: IterateContextApi) {
  await itx
    .cd("/toolchain")
    .processors.enable(
      "cloud-toolchain",
      facetSpecOf("CloudToolchainFacet", ToolchainContract.consumes),
    );
}

/** The person the platform's stamp names, as the Cloud knows them (`sub` is the stamp's `userId`,
 *  the platform's user id, as the OS's userinfo named it before), after their context exists.
 *
 *  THE PERSON'S CONTEXT is made the first time the Cloud serves them: its processor enabled, and
 *  `cloud/person-signed-in` on it, keyed by everything it says (the person's id and email, and the
 *  admin's, when one is signed in as them), so later calls add nothing. The platform refuses an
 *  append whose key it holds with another payload (core/os/src/stream/stream.ts, IDEMPOTENCY_CONFLICT),
 *  so a key of the id alone would refuse a person whose email changed; this way the change is one
 *  more record, and the reduce takes the newer email. Both calls are idempotent, so this isolate
 *  remembers whom it has done it for and skips them next time; a new isolate repeats them once,
 *  harmlessly. */
async function personOf(host: Host, request: Request): Promise<Person> {
  const stamped = host.auth.person(request)!;
  const person = { sub: stamped.userId, email: stamped.email };
  const admin = stamped.impersonatedBy;
  const key = [person.sub, person.email, admin?.actor || "", admin?.email || ""].join(":");
  if (recorded.has(key)) return person;
  await withItx(host, async (itx) => {
    const context = itx.cd(personPathOf(person.sub));
    await context.processors.enable(
      "cloud-person",
      facetSpecOf("CloudPersonFacet", PersonContract.consumes),
    );
    await context.append({
      type: "cloud/person-signed-in",
      idempotencyKey: `person-signed-in:${key}`,
      // oxlint-disable-next-line iterate/simple-truthiness-check -- an `impersonatedBy: undefined` key differs from none in the platform's idempotent retry (core/lib/src/lib.ts `jsonEqual` counts keys; the stored event has none), which would refuse every append after the first as IDEMPOTENCY_CONFLICT: only an impersonation carries the key
      payload: { ...person, ...(admin && { impersonatedBy: admin }) },
    });
  });
  recorded.add(key);
  return person;
}

/** The people (with the admin signed in as them, if any) whose context this isolate has made. */
const recorded = new Set<string>();

/** The platform's callback stored a connect's tokens (or did not) and sent the browser here: what
 *  became of the attempt, settled on the person's context. A connection that is not this person's,
 *  or not pending, is left as it is: the page shows its state. */
async function finishConnect(itx: IterateContextApi, person: Person, connection: string) {
  const context = itx.cd(personPathOf(person.sub));
  const { state } = await context.facets
    .get<{ snapshot(): Promise<{ state: PersonState }> }>("cloud-person")
    .snapshot();
  const pending = state.connections.find(
    (known) => known.id === connection && known.status === "pending",
  );
  if (!pending) return;
  const result = await itx.secrets.oauthResult(connectionSecretOf(connection), {
    nonce: pending.nonce,
  });
  // still in flight: the browser came back before the platform finished, and the page says so
  if (result.status === "pending") return;
  const settled = { requestOffset: pending.requestOffset, connection };
  await context.append({
    type: "cloud/connection-settled",
    idempotencyKey: `connection-settled:${connection}`,
    payload:
      result.status === "complete"
        ? {
            ...settled,
            status: "connected",
            cloudflareUser: result.account?.name || result.account?.id || "",
            accounts: await accountsOf(connection),
            scopes: result.scopes,
          }
        : {
            ...settled,
            status: "failed",
            error:
              "This connect ended before Cloudflare's tokens were stored, or a newer one replaced it. Connect again.",
          },
  });
}

async function withItx<T>(host: Host, call: (itx: IterateContextApi) => Promise<T>): Promise<T> {
  using itx = host.getItx();
  return await call(itx);
}

const redirect = (url: URL, to: string) =>
  new Response(null, {
    status: 303,
    headers: { location: new URL(to, url).href, "cache-control": "no-store" },
  });
