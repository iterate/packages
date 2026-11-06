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
// The origin serves four things, and the platform answers `/api` and `/.auth/*` itself:
//
//   /sign-in…, /sign-out   the Cloud's own sign-in through the OS (sign-in.ts)
//   /rpc                   the person's capnweb API (api.ts), for a Cloud session from this origin
//   /connected             where the platform's OAuth callback sends a Cloudflare connect back
//   anything else          the Cloud app's pages, fetched through to its Worker (packages/cloud-app),
//                          which holds no session, no secret and no state
//
// A visitor is no member of the project and gets no platform grant on it: the Cloud's session is
// the Cloud's own, and every answer is limited to that person's things.
import type { IterateContextApi } from "iterate/api";
import { isSameOriginBrowserRequest } from "iterate/lib";
import { newWorkersRpcResponse } from "iterate/sdk";
import { CloudApi, accountsOf, facetSpecOf, personPathOf, type CloudflareClient } from "./api.ts";
import { PersonContract, ToolchainContract } from "./contract.ts";
import type { PersonState } from "./records.ts";
import { connectionSecretOf } from "./runs.ts";
import { personOf, serveSignIn, type Person } from "./sign-in.ts";

/** What the installing project's config says about its Cloud. */
export type CloudOptions = {
  /** The OS the Cloud signs people in through, and whose OAuth stores the Cloudflare grants. */
  issuer: string;
  /** The Cloud app's Worker (envs.ts `cloudAppEnvs`), which serves the pages. */
  frontend: string;
  cloudflare: CloudflareClient;
};

const BASE_PATH_HEADER = "x-iterate-base-path";

type Host = {
  getItx(): IterateContextApi & Disposable;
  ctx: { waitUntil(work: Promise<unknown>): void };
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
  const kv = {
    get: (key: string) => withItx(host, (itx) => itx.kv.get(key)),
    put: (key: string, value: string) => withItx(host, (itx) => itx.kv.put(key, value)),
    delete: (key: string) => withItx(host, (itx) => itx.kv.delete(key)),
  };
  // A write or a socket from another origin is refused: every *.iterate.app host is one site, so a
  // SameSite=Lax session cookie rides a request a sibling project's page makes (core/lib/src/sdk/auth.ts).
  const isUpgrade = request.headers.get("upgrade")?.toLowerCase() === "websocket";
  if (
    (isUpgrade || !["GET", "HEAD"].includes(request.method)) &&
    !isSameOriginBrowserRequest(request)
  )
    return new Response("Cross-origin request refused\n", { status: 403 });

  const signIn = await serveSignIn(request, {
    kv,
    issuer: options.issuer,
    basePath,
    signedIn: (person) => withItx(host, (itx) => recordSignIn(itx, person)),
  });
  if (signIn) return signIn;

  if (url.pathname === "/rpc") {
    const person = await personOf(request, kv);
    // a plain 401, never `Bearer realm="iterate"`, which the platform's edge would turn into its own sign-in
    if (!person)
      return new Response("Sign in to Iterate Cloud\n", {
        status: 401,
        headers: { "cache-control": "no-store" },
      });
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

  if (url.pathname === "/connected" && request.method === "GET") {
    const person = await personOf(request, kv);
    if (!person)
      return redirect(
        url,
        `${basePath}/?${new URLSearchParams({ next: `${basePath}${url.pathname}${url.search}` })}`,
      );
    const connection = url.searchParams.get("connection") ?? "";
    await withItx(host, (itx) => finishConnect(itx, person, connection));
    return redirect(url, `${basePath}/new?${new URLSearchParams({ connection })}`);
  }

  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Not found\n", { status: 404 });
  // the pages: nothing of the visitor's goes with them, not a cookie
  const page = new URL(`${url.pathname}${url.search}`, options.frontend);
  const headers = new Headers(request.headers);
  headers.delete("cookie");
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

/** The person's context, with its processor, and the sign-in on it. */
async function recordSignIn(itx: IterateContextApi, person: Person) {
  const context = itx.cd(personPathOf(person.sub));
  await context.processors.enable(
    "cloud-person",
    facetSpecOf("CloudPersonFacet", PersonContract.consumes),
  );
  await context.append({ type: "cloud/person-signed-in", payload: person });
}

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
