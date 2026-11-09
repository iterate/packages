// cloud/prove.ts — AFTER THE INSTALL, THE CLOUD SETS UP THE FIRST PROJECT AND PROVES THE DEPLOYMENT
// WORKS, as the person would find it: each step on the deployment's own API, as its owner (the
// operator's bearer acting `as` the owner's address, found or created: core/os session.ts), over
// one bounded HTTP batch each, the way the router calls a deployment (packages/cloud-router).
//
//   project  the owner's first project, from the platform's default template (agents installed)
//   agent    an agent in it answers a first message: the model works, through the account's AI
//            Gateway or the project's own key
//   mcp      `/mcp` asks a client to sign in, naming the deployment's authorization server
//   domain   the project's site answers at the domain itself, signed out (a deployment with one)
//
// Every step is idempotent: a project that exists is the owner's already, an agent that exists
// answers again, the checks read only. Pure but for `fetch`, so a test drives it with a fake one.
import { newHttpBatchRpcSession } from "capnweb";
import type { IterateApi } from "iterate/api";
import type { ProofStepName } from "./records.ts";

export type ProveInput = {
  /** The deployment's platform origin: its domain, or its workers.dev address. */
  origin: string;
  adminBearer: string;
  owner: string;
  project: string;
  domain: string | null;
};

export type StepReport = (
  name: ProofStepName,
  status: "running" | "succeeded" | "failed",
  detail: string | null,
) => Promise<unknown>;

/** The agent the proof talks to, in the first project. */
const WELCOME_AGENT = "/agents/welcome";
const AGENT_ANSWER_MS = 3 * 60_000;
const PROJECT_READY_MS = 3 * 60_000;
/** How many times, 5 s apart, the proof asks for the agents app before it says it is missing. */
const AGENTS_READY_TRIES = 24;

/** Run the proof's steps in order; the first that fails ends it, with its reason. */
export async function prove(
  input: ProveInput,
  report: StepReport,
  fetchFn: typeof fetch = fetch,
): Promise<{ status: "succeeded" } | { status: "failed"; error: string }> {
  const steps: [ProofStepName, () => Promise<string>][] = [
    ["project", () => setUpProject(input)],
    ["agent", () => askAgent(input)],
    ["mcp", () => checkMcp(input, fetchFn)],
    ...(input.domain
      ? ([["domain", () => checkDomain(input, fetchFn)]] as [
          ProofStepName,
          () => Promise<string>,
        ][])
      : []),
  ];
  for (const [name, run] of steps) {
    await report(name, "running", null);
    try {
      await report(name, "succeeded", await run());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await report(name, "failed", message);
      return { status: "failed", error: `${name}: ${message}` };
    }
  }
  return { status: "succeeded" };
}

/** The deployment's API, as the owner: one HTTP batch, closed by the caller (`using`). */
function asOwner({ origin, adminBearer, owner }: ProveInput) {
  // the bearer rides the request too: an HTTP batch without one meets the API's 401 before it runs
  // oxlint-disable-next-line iterate/no-capnweb-http-batch -- one bounded call each, no live capability
  const api = newHttpBatchRpcSession<IterateApi>(
    new Request(`${origin}/api`, { headers: { authorization: `Bearer ${adminBearer}` } }),
  );
  const session = api.authenticate({
    type: "admin-secret",
    secret: adminBearer,
    as: { email: owner },
  });
  return { session, [Symbol.dispose]: () => api[Symbol.dispose]() };
}

/** The first project, the owner's, from the platform's default template; then its config worker
 *  published, which installs the agents app (iterate/agents `installAgents`). */
async function setUpProject(input: ProveInput) {
  {
    using api = asOwner(input);
    const listed = await api.session.projects.list();
    if (!listed.some((known: { slug: string }) => known.slug === input.project)) {
      using templates = asOwner(input);
      const [template] = await templates.session.projects.templates();
      using created = asOwner(input);
      await created.session.projects.create({
        project: input.project,
        configRepoTemplate: template.reference,
      });
    }
  }
  using api = asOwner(input);
  await api.session.projects.get(input.project).waitForEvent({
    type: ["events.iterate.com/project/worker-updated"],
    afterOffset: 0,
    timeoutMs: PROJECT_READY_MS,
  });
  return `${input.project} is the owner's, its worker published`;
}

/** An agent in the first project answers a first message: the model call, end to end. */
async function askAgent(input: ProveInput) {
  // `itx.agents` is the agents app's rewrite rule on the project's root: reached by an expression
  // that names it whole, `itx` first (a rule matches `itx.agents`, not `agents`)
  // the project's first publish installs the agents app just after `worker-updated` lands
  // (iterate/agents `installAgents` in the template's init): until then `itx.agents` has no rule
  for (let tries = 0; ; tries++) {
    try {
      using api = asOwner(input);
      await api.session.projects
        .get(input.project)
        .invoke(["itx", "agents", ["create", WELCOME_AGENT]]);
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/no rewrite rule matches/.test(message) || tries >= AGENTS_READY_TRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
  let sent: { offset: number };
  {
    using api = asOwner(input);
    sent = (await api.session.projects
      .get(input.project)
      .invoke([
        "itx",
        "agents",
        ["get", WELCOME_AGENT],
        ["message", "Say hello to your new owner in one short sentence."],
      ])) as { offset: number };
  }
  using api = asOwner(input);
  const settled = (await api.session.projects
    .get(input.project)
    .cd(WELCOME_AGENT)
    .waitForEvent({
      type: ["events.iterate.com/agent/llm-request-settled"],
      afterOffset: sent.offset,
      timeoutMs: AGENT_ANSWER_MS,
    })) as { payload?: { result?: { status: string; text?: string; errorMessage?: string } } };
  const result = settled.payload?.result;
  if (result?.status !== "succeeded")
    throw new Error(`the model did not answer: ${result?.errorMessage || result?.status}`);
  return (result.text || "").trim().slice(0, 200);
}

/** `/mcp` asks a client to sign in, and its metadata names the authorization server. */
async function checkMcp({ origin }: ProveInput, fetchFn: typeof fetch) {
  const mcp = `${origin}/mcp`;
  const answer = await fetchFn(mcp, { method: "POST" });
  await answer.body?.cancel();
  const challenge = answer.headers.get("www-authenticate") || "";
  const metadata = /resource_metadata="([^"]+)"/.exec(challenge)?.[1];
  if (answer.status !== 401 || !metadata)
    throw new Error(`${mcp} answered HTTP ${answer.status} with no sign-in challenge`);
  const resource = (await (await fetchFn(metadata)).json()) as {
    authorization_servers?: string[];
  };
  const server = resource.authorization_servers?.[0];
  if (!server) throw new Error(`${metadata} names no authorization server`);
  return `${mcp} asks clients to sign in at ${server}`;
}

/** The first project's site at the domain itself (core/os `urls.projectWildcard`), signed out. */
async function checkDomain({ domain }: ProveInput, fetchFn: typeof fetch) {
  const site = `https://${domain}/`;
  let last = "";
  // a new name's first answers can be Cloudflare's own, until the route and record are everywhere
  for (let tries = 0; tries < 24; tries++) {
    const answer = await fetchFn(site, { headers: { accept: "text/html" }, redirect: "manual" });
    await answer.body?.cancel();
    if (answer.status < 400) return `${site} answered HTTP ${answer.status}`;
    last = `HTTP ${answer.status}`;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`${site} answered ${last} for two minutes`);
}
