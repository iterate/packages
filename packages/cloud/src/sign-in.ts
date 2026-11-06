// cloud/sign-in.ts — WHO IS SIGNED IN TO ITERATE CLOUD. The Cloud is an ordinary OAuth client of
// the OS that asks only who the person is, modelled on core/os's admin-sign-in.ts. Its client id is
// the URL of its metadata document (CIMD), served here at `/sign-in/client.json` on the Cloud's own
// origin, so nothing is registered by hand. `/sign-in` starts a code flow with PKCE whose one
// resource is the issuer's `/oauth2/userinfo`: the consent page shows the "identify" card, and the
// grant reaches no project (`/api` and `/mcp` refuse its token by audience). The callback exchanges
// the code, reads `{ sub, email }`, revokes the token at once, and keeps a session of the Cloud's
// own in the project's kv, named by a random token in an HttpOnly `__Host-` cookie. The kv keeps the
// token's SHA-256, never the token, and nothing before a sign-in succeeds: the pending flow (its
// `state`, the PKCE verifier, where to go next) is an HttpOnly cookie of its own for ten minutes.
// The OS cannot end a Cloud session: it lasts SESSION_MS, then the person identifies again. A
// session is a kv record, not a domain fact: the person's own facts are on `/people/<sub>`
// (worker.ts appends `cloud/person-signed-in` there).
//
// The client id and the redirect URI are the request's origin and the Cloud's base path there: a
// host of the cloud project's own at its root, or `/projects/<project>` on a platform origin under
// paths ingress (worker.ts). The cookies are `__Host-`, so their path is `/`: under paths ingress
// they reach every project of that origin, whose config workers are handed a visitor's cookies.
import { cookieValueOf, sameOriginPath } from "iterate/lib";
import { z } from "zod";
import { PersonId } from "./records.ts";

type Kv = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<unknown>;
  delete(key: string): Promise<unknown>;
};
/** The person, as the issuer's userinfo names them: `sub` is their OS user id. */
export type Person = { sub: string; email: string };

const SESSION_COOKIE = "__Host-cloud-session";
/** A pending sign-in, which binds the callback to the browser that started it. */
const FLOW_COOKIE = "__Host-cloud-sign-in";
const SESSION_MS = 24 * 3600_000;
const FLOW_MS = 10 * 60_000;
/** kv: `cloud/sessions/<hash of the cookie>`. */
const SESSIONS = "cloud/sessions/";

const Session = z.object({ sub: z.string(), email: z.string(), created: z.string() });
const Flow = z.object({ state: z.string(), verifier: z.string(), next: z.string() });
const Discovery = z.object({
  issuer: z.string(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  revocation_endpoint: z.string().url(),
});

/** The person this request's session names, or null. */
export async function personOf(request: Request, kv: Kv): Promise<Person | null> {
  const token = cookieValueOf(request.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return null;
  const key = SESSIONS + (await hash(token));
  const session = Session.safeParse(JSON.parse((await kv.get(key)) ?? "null"));
  if (!session.success) return null;
  if (Date.now() - Date.parse(session.data.created) > SESSION_MS) {
    await kv.delete(key);
    return null;
  }
  return { sub: session.data.sub, email: session.data.email };
}

/** The client document, `/sign-in`, its callback and `POST /sign-out`; null for any other route.
 *  `signedIn` runs once a sign-in succeeded, before the session exists. */
export async function serveSignIn(
  request: Request,
  input: {
    kv: Kv;
    issuer: string;
    /** The path the Cloud is served under on its origin, "" at a host's root (worker.ts). */
    basePath: string;
    signedIn: (person: Person) => Promise<unknown>;
  },
): Promise<Response | null> {
  const { kv, issuer: issuerOrigin } = input;
  const userinfo = `${issuerOrigin}/oauth2/userinfo`;
  const url = new URL(request.url);
  const { basePath } = input;
  // the Cloud's own address: its origin, and the path it is served under there
  const home = `${url.origin}${basePath}`;
  const clientId = `${home}/sign-in/client.json`;
  const redirectUri = `${home}/sign-in/callback`;
  const route = `${request.method} ${url.pathname}`;

  if (route === "GET /sign-in/client.json")
    return Response.json({
      client_id: clientId,
      client_name: "iterate cloud",
      client_uri: home,
      logo_uri: `${issuerOrigin}/favicon.svg`,
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      scope: "iterate",
    });

  // GET from a link, POST from the Cloud app's button (a same-origin form: worker.ts checks it)
  if (route === "GET /sign-in" || route === "POST /sign-in") {
    const issuer = await discover(issuerOrigin);
    const state = random(16);
    const verifier = random(32);
    // a page of the Cloud's, under its base path: on a shared origin, never another project's
    const asked = sameOriginPath(url.searchParams.get("next") || `${basePath}/`, url.origin);
    const next = basePath && !asked.startsWith(`${basePath}/`) ? `${basePath}/` : asked;
    const flow = { state, verifier, next } satisfies z.infer<typeof Flow>;
    const target = new URL(issuer.authorization_endpoint);
    target.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "iterate",
      state,
      code_challenge: base64url(await sha256(verifier)),
      code_challenge_method: "S256",
      resource: userinfo,
    }).toString();
    return answer(target.href, [
      cookie(FLOW_COOKIE, base64url(new TextEncoder().encode(JSON.stringify(flow))), FLOW_MS),
    ]);
  }

  if (route === "GET /sign-in/callback") {
    // a code, which the page words itself: a link cannot put its own sentence on the Cloud's page
    const failed = (error: "expired" | "issuer" | "cancelled" | "unconfirmed") =>
      answer(`${basePath}/?${new URLSearchParams({ error })}`, [cookie(FLOW_COOKIE, "", 0)]);
    const query = url.searchParams;
    const flow = Flow.safeParse(unpack(cookieValueOf(request.headers.get("cookie"), FLOW_COOKIE)));
    if (!flow.success || query.get("state") !== flow.data.state) return failed("expired");
    const issuer = await discover(issuerOrigin);
    // RFC 9207: the issuer names itself on every answer, so a code from another issuer is refused
    if (query.get("iss") !== issuer.issuer) return failed("issuer");
    const code = query.get("code");
    if (!code) return failed("cancelled");
    const person = await identify(issuer, userinfo, {
      code,
      clientId,
      redirectUri,
      verifier: flow.data.verifier,
    }).catch((error: unknown) => {
      console.warn({ event: "cloud.sign-in-failed", message: String(error) });
      return null;
    });
    if (!person) return failed("unconfirmed");
    // the person's facts, before the session: a failure there is the same "try again"
    const recorded = await input.signedIn(person).then(
      () => true,
      (error: unknown) => {
        console.warn({ event: "cloud.sign-in-not-recorded", message: String(error) });
        return false;
      },
    );
    if (!recorded) return failed("unconfirmed");
    const token = random(32);
    const session = { ...person, created: new Date().toISOString() } satisfies z.infer<
      typeof Session
    >;
    await kv.put(SESSIONS + (await hash(token)), JSON.stringify(session));
    return answer(flow.data.next, [
      cookie(FLOW_COOKIE, "", 0),
      cookie(SESSION_COOKIE, token, SESSION_MS),
    ]);
  }

  if (route === "POST /sign-out") {
    const token = cookieValueOf(request.headers.get("cookie"), SESSION_COOKIE);
    if (token) await kv.delete(SESSIONS + (await hash(token)));
    return answer(`${basePath}/`, [cookie(SESSION_COOKIE, "", 0)]);
  }
  return null;
}

/** The code exchanged for a userinfo token, the person read with it, and the token revoked: it
 *  has no further use here, and the issuer ends its grant in ten minutes besides. */
async function identify(
  issuer: z.infer<typeof Discovery>,
  userinfo: string,
  input: { code: string; clientId: string; redirectUri: string; verifier: string },
): Promise<Person> {
  const exchanged = await fetch(issuer.token_endpoint, {
    method: "POST",
    headers: { accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      code_verifier: input.verifier,
      resource: userinfo,
    }),
    // a first sign-in's exchange reads a brand-new account Durable Object
    signal: AbortSignal.timeout(45_000),
  });
  const tokens = z
    .object({ access_token: z.string() })
    .safeParse(await exchanged.json().catch(() => null));
  if (!exchanged.ok || !tokens.success)
    throw new Error(`the token endpoint answered HTTP ${exchanged.status}`);
  const accessToken = tokens.data.access_token;
  try {
    const response = await fetch(userinfo, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`${userinfo} answered ${response.status}`);
    return z.object({ sub: PersonId, email: z.email() }).parse(await response.json());
  } finally {
    await fetch(issuer.revocation_endpoint, {
      method: "POST",
      body: new URLSearchParams({
        token: accessToken,
        token_type_hint: "access_token",
        client_id: input.clientId,
      }),
      signal: AbortSignal.timeout(10_000),
    })
      .then((response) => response.body?.cancel())
      .catch((error: unknown) =>
        console.warn({ event: "cloud.token-not-revoked", message: String(error) }),
      );
  }
}

/** The issuer's endpoints, from its discovery document, once per isolate. A document that names
 *  another issuer is refused (RFC 8414 §3.3). */
let discovered: Promise<z.infer<typeof Discovery>> | undefined;
function discover(issuer: string) {
  discovered ||= fetch(`${issuer}/.well-known/oauth-authorization-server`, {
    signal: AbortSignal.timeout(10_000),
  })
    .then((response) => response.json())
    .then((body) => {
      const document = Discovery.parse(body);
      if (document.issuer !== issuer)
        throw new Error(`${issuer}'s discovery document names ${document.issuer}`);
      return document;
    })
    .catch((error: unknown) => {
      discovered = undefined;
      throw error;
    });
  return discovered;
}

const answer = (location: string, cookies: string[]) => {
  const headers = new Headers({
    location,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
  });
  for (const value of cookies) headers.append("set-cookie", value);
  return new Response(null, { status: 303, headers });
};
const cookie = (name: string, value: string, ms: number) =>
  `${name}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${Math.floor(ms / 1000)}`;
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
const random = (bytes: number) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));
const unpack = (value: string | null) => {
  try {
    const text = atob((value || "").replaceAll("-", "+").replaceAll("_", "/"));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(text, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
};
const sha256 = async (text: string) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
const hash = async (text: string) => base64url(await sha256(text));
