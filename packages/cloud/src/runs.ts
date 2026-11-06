// cloud/runs.ts — THE SANDBOX WORK behind the three processors: the toolchain's preparation, a
// deployment's own sandbox, and one attempt of a run. A run is the command core/os/SELF-HOSTING.md
// gives a laptop (`pnpm run deploy`), with the deployment's variables, in the deployment's own
// sandbox. Every request the sandbox makes leaves through the project's egress, which fills
// `getSecret("…")` placeholders on the way out (iterate/api `SandboxHandle`), so the Cloudflare token
// never enters the sandbox.
//
// THE DEPLOYMENT'S CONFIG, its three secrets among them, comes from the deployment's state
// (config.ts): each run writes it into the sandbox as a file before its script starts. The toolchain's snapshot carries no
// deployment's files: its preparation empties `/work/deployments` before it saves.
//
// A RUN'S SCRIPT RUNS ONCE. It is `/work/runs/<requestOffset>.sh`, started in its own process group,
// and it writes `<requestOffset>.log` and `.pid`. An attempt that finds the log already there adopts
// the script, alive or finished, and reads the log from the start, skipping the lines the run has
// already reported: an incarnation that died mid-run never makes a second deploy.
import type { IterateContextApi } from "iterate/api";
import { readAlchemyLine } from "./alchemy.ts";
import type { Outcome, Printed } from "./deployment.ts";
import {
  CRANE_INSTALL,
  PIN_LINE,
  imageStepFor,
  imageStepOf,
  shellQuote,
  type ImageStep,
} from "./image.ts";
import { configFileOf, type DeploymentConfig } from "./config.ts";
import {
  errorCodeOf,
  stepOfLine,
  type DeploymentRecord,
  type ImageSource,
  type RunKind,
  type RunStep,
} from "./records.ts";

/** The sandboxes, each beneath the context whose facet makes it: a context creates only beneath
 *  itself (iterate/api `EntityCollectionApi`), through the root's collection (`itx.cd("/")`), since
 *  only the root's table has one. Any context of the project gets either by path. */
const TOOLCHAIN = "/toolchain/sandbox";
const sandboxPathOf = (deployment: string) => `/deployments/${deployment}/sandbox`;
/** A connection's tokens: the secret the platform's OAuth fills (api.ts) and refreshes. */
export const connectionSecretOf = (connection: string) => `/secrets/cloud-cloudflare-${connection}`;
/** A connection's token as a request carries it: the placeholder egress fills. */
export const placeholderOf = (connection: string) =>
  `getSecret("${connectionSecretOf(connection)}", { field: "accessToken" })`;

/** The clone of iterate/core the sandbox image carries; the preparation pulls main and installs it. */
const CORE = "/work/core";
const OS = `${CORE}/core/os`;
const READY = "/work/READY";
const RUNS = "/work/runs";
const deploymentDir = (id: string) => `/work/deployments/${id}`;

/** How often an attempt reads the run's log, and how long one attempt may take: a first deploy
 *  into an account copies 1.26 GB of image and waits for Cloudflare to prepare it (image.ts). */
const POLL_MS = 3_000;
const RUN_TIMEOUT_MS = 30 * 60_000;
/** Vite's build lines, which say nothing about the deployment and would be most of the build's
 *  output; and blank lines, in any step. */
const NOISE = /^\.cloudflare\/output\/|kB │ gzip/;
const BLANK = /^\s*$/;
/** The Worker's address, which the check step prints once it knows it (`CHECK_STEP`). */
const URL_LINE = /^== url (https:\/\/\S+)$/;
/** A deployment's sandbox stays up this long unused; a run keeps it up while it reads. */
const DEPLOYMENT_IDLE_MS = 10 * 60_000;

type Root = IterateContextApi;
type Sandbox = ReturnType<Root["sandboxes"]["get"]>;

// ── the toolchain ───────────────────────────────────────────────────────────────────────────────

/** Prepare the toolchain for the request at `requestOffset` and save its snapshot, from the
 *  toolchain's facet (`own`, its context's scope). The script runs
 *  in the background and writes `/work/prepare.status` (`<requestOffset> running|ok <commit>|failed`),
 *  so a second call for the same request adopts it. */
export async function prepareToolchain(own: Root, requestOffset: number) {
  await withProjectRoots(own);
  const itx = own.cd("/");
  if (!(await itx.sandboxes.list()).some((known) => known.path === TOOLCHAIN))
    await itx.sandboxes.create(TOOLCHAIN);
  const sandbox = itx.sandboxes.get(TOOLCHAIN);
  await sandbox.configure({ idleAfterMs: 60 * 60_000 });
  const status = async () =>
    text(await sandbox.exec(["bash", "-c", "cat /work/prepare.status 2>/dev/null || true"]));
  if (!(await status()).startsWith(`${requestOffset} `)) {
    await sandbox.files.write("/work/prepare.sh", prepareScriptOf(requestOffset));
    await sandbox.exec(
      ["bash", "-c", "setsid nohup bash /work/prepare.sh > /work/prepare.log 2>&1 &"],
      {
        timeoutMs: 30_000,
      },
    );
  }
  const deadline = Date.now() + 45 * 60_000;
  for (;;) {
    await sleep(10_000);
    const [, state, core] = (await status()).trim().split(" ");
    if (state === "ok" && core) {
      const snapshot = await sandbox.container.snapshotContainer({ name: "toolchain" });
      return { status: "succeeded" as const, snapshot: snapshot.id, core };
    }
    if (state === "failed")
      return {
        status: "failed" as const,
        error: `The toolchain's preparation failed: ${await tailOf(sandbox, "/work/prepare.log", 1500)}`,
      };
    if (Date.now() > deadline)
      return {
        status: "failed" as const,
        error: "The toolchain's preparation took longer than 45 minutes.",
      };
  }
}

/** iterate/core at main, installed and built, with two edits to core/os/alchemy.run.ts that core
 *  does not have yet: `ITERATE_ALCHEMY_STATE_STORE_WORKER` names the state store Worker and
 *  `ITERATE_STACK_NAME` the stack. The edit stops the preparation once core's lines change.
 *  And crane, which copies the sandbox image (image.ts). It ends with no deployment's files on the
 *  disk, so the snapshot carries none. */
const prepareScriptOf = (requestOffset: number) => `set -o pipefail
export CI=1
fail() { echo "$*"; echo "${requestOffset} failed" > /work/prepare.status; exit 1; }
echo "${requestOffset} running" > /work/prepare.status
rm -f ${READY}
cd ${CORE} || fail "no ${CORE}"
echo "== git"; git fetch -q --depth 1 origin main && git reset -q --hard origin/main || fail "git"
git log -1 --format='%h %ad %s' --date=short
echo "== pnpm install"; pnpm install --frozen-lockfile 2>&1 | tail -3 || fail "pnpm install"
echo "== patch alchemy.run.ts"
node -e '
const fs = require("node:fs");
const file = "${OS}/alchemy.run.ts";
let s = fs.readFileSync(file, "utf8");
const edits = [
  ["state: store === \\"cloudflare\\" ? Cloudflare.state() : Alchemy.localState(),", "state: store === \\"cloudflare\\" ? Cloudflare.state(process.env.ITERATE_ALCHEMY_STATE_STORE_WORKER ? { workerName: process.env.ITERATE_ALCHEMY_STATE_STORE_WORKER } : {}) : Alchemy.localState(),"],
  ["Alchemy.Stack(\\n  \\"iterate\\",", "Alchemy.Stack(\\n  process.env.ITERATE_STACK_NAME || \\"iterate\\","],
];
for (const [from, to] of edits) {
  if (s.includes(to)) continue;
  if (!s.includes(from)) { console.error("pattern not found: " + from); process.exit(1); }
  s = s.replace(from, to);
}
fs.writeFileSync(file, s);
console.log("patched");
' || fail "patch"
echo "== crane"; ${CRANE_INSTALL} || fail "crane"
echo "== build"; (cd ${OS} && pnpm build 2>&1 | tail -2) || fail "build"
rm -rf /work/deployments /work/runs /work/run.lock
mkdir -p /work/deployments ${RUNS}
touch ${READY}
echo "${requestOffset} ok $(git -C ${CORE} log -1 --format=%h)" > /work/prepare.status
echo "== ready"`;

// ── a deployment's sandbox ──────────────────────────────────────────────────────────────────────

/** The deployment's own sandbox, from the toolchain's snapshot, made by the
 *  deployment's facet (`own`, its context's scope). Idempotent: a sandbox an earlier attempt made is finished, never made twice. Its disk is a cache of the toolchain: a run writes
 *  the deployment's files itself (`runAttempt`). */
export async function prepareDeployment(own: Root, record: DeploymentRecord): Promise<Outcome> {
  await withProjectRoots(own);
  const itx = own.cd("/");
  const path = sandboxPathOf(record.id);
  if (!(await itx.sandboxes.list()).some((known) => known.path === path))
    await itx.sandboxes.create(path);
  const sandbox = itx.sandboxes.get(path);
  if (!(await exists(sandbox, READY))) {
    // a sandbox an attempt created but never started from the toolchain runs the plain image: its
    // disk goes, and it starts again from the snapshot (`start({ from })` does nothing to a running one)
    if (await sandbox.container.running)
      await sandbox.container.destroy("start from the toolchain");
    await sandbox.start({ from: TOOLCHAIN });
  }
  if (!(await exists(sandbox, READY)))
    return {
      status: "failed",
      error: `The toolchain's snapshot has no ${READY}: prepare the toolchain again.`,
    };
  await sandbox.configure({ idleAfterMs: DEPLOYMENT_IDLE_MS });
  return { status: "succeeded" };
}

// ── a run ───────────────────────────────────────────────────────────────────────────────────────

/** One attempt of a run (deployment.ts `DeploymentDeps.attempt`). */
export async function runAttempt(
  root: Root,
  image: ImageSource | null,
  run: {
    record: DeploymentRecord;
    config: DeploymentConfig;
    requestOffset: number;
    kind: RunKind;
    reported: number;
  },
  report: (printed: Printed[]) => Promise<unknown>,
): Promise<Outcome> {
  const { record, config, requestOffset, kind } = run;
  const sandbox = root.sandboxes.get(sandboxPathOf(record.id));
  if (!(await exists(sandbox, READY)))
    return {
      status: "failed",
      error: `The deployment's sandbox has no toolchain (${READY}): prepare it again.`,
    };
  const base = `${RUNS}/${requestOffset}`;
  if (!(await exists(sandbox, `${base}.log`))) {
    await sandbox.exec(["mkdir", "-p", deploymentDir(record.id), RUNS], { timeoutMs: 30_000 });
    await sandbox.files.write(
      `${deploymentDir(record.id)}/iterate.config.ts`,
      configFileOf(config, OS),
    );
    let step: ImageStep | undefined;
    if (kind !== "destroy") {
      if (!image)
        return {
          status: "failed",
          error: "The toolchain names no image source: prepare it again.",
        };
      const found = await imageStepFor(root, record, image, placeholderOf(record.connection));
      if ("error" in found) return { status: "failed", error: `image: ${found.error}` };
      step = found;
    }
    await sandbox.files.write(`${base}.sh`, runScriptOf(record, kind, requestOffset, image, step));
    await sandbox.exec(
      ["bash", "-c", `setsid nohup bash ${base}.sh > ${base}.log 2>&1 & echo $! > ${base}.pid`],
      {
        timeoutMs: 30_000,
      },
    );
  }
  // a sandbox in use is not parked, but this attempt's reads are its only use for minutes at a time
  await sandbox.configure({ idleAfterMs: 60 * 60_000 });
  try {
    return await follow(sandbox, base, kind, run.reported, report);
  } finally {
    await sandbox.configure({ idleAfterMs: DEPLOYMENT_IDLE_MS });
  }
}

/** Read the run's log until its `__EXIT__` line. Each line belongs to the step the last
 *  `== step <name>` line named (the first step of `kind` before any). In the alchemy step a line is
 *  one JSON record of Alchemy's CLI: an event goes to `report` as one, any other record as a text
 *  line (alchemy.ts). Every record from the run's `reported`-th on goes to `report`, in order, text
 *  lines at most 200 to an item. */
async function follow(
  sandbox: Sandbox,
  base: string,
  kind: RunKind,
  reported: number,
  report: (printed: Printed[]) => Promise<unknown>,
): Promise<Outcome> {
  const started = Date.now();
  let read = 0;
  let carry = "";
  let seen = 0;
  let step: RunStep = kind === "destroy" ? "alchemy" : "namespace";
  let url: string | undefined;
  let pinned: string | undefined;
  let last = "no output";
  for (;;) {
    await sleep(POLL_MS);
    // the log's new bytes on stdout, whether the script still runs on stderr
    const polled = await sandbox.exec(
      [
        "bash",
        "-c",
        `kill -0 "$(cat ${base}.pid 2>/dev/null)" 2>/dev/null && echo alive >&2; tail -c +${read + 1} ${base}.log`,
      ],
      { timeoutMs: 30_000 },
    );
    read += polled.stdout.length;
    const parts = (carry + new TextDecoder().decode(polled.stdout)).split("\n");
    carry = parts.pop() ?? "";
    let exit: number | undefined;
    const fresh: Printed[] = [];
    const keep = (
      item: { step: RunStep; line: string } | { event: Printed & { kind: "event" } },
    ) => {
      if (seen++ < reported) return;
      if ("event" in item) return void fresh.push(item.event);
      const tail = fresh.at(-1);
      if (tail?.kind === "lines" && tail.step === item.step && tail.lines.length < 200)
        tail.lines.push(item.line);
      else fresh.push({ kind: "lines", from: seen - 1, step: item.step, lines: [item.line] });
    };
    for (const raw of parts) {
      // oxlint-disable-next-line no-control-regex -- the CLI's colour codes start with ESC
      const line = raw.replace(/\x1b\[[0-9;]*m/g, "");
      const ended = /^__EXIT__:(\d+)$/.exec(line);
      if (ended) {
        exit = Number(ended[1]);
        continue;
      }
      const named = URL_LINE.exec(line)?.[1];
      if (named) {
        url = named;
        continue;
      }
      pinned = PIN_LINE.exec(line)?.[1] ?? pinned;
      step = stepOfLine(line) ?? step;
      if (BLANK.test(line) || (step === "build" && NOISE.test(line))) continue;
      const kept = step === "alchemy" ? readAlchemyLine(line) : { text: line };
      if (!kept) continue;
      if ("event" in kept) {
        keep({ event: { kind: "event", at: seen, event: kept.event } });
        continue;
      }
      const text = kept.text.length > 500 ? `${kept.text.slice(0, 500)}…` : kept.text;
      last = text;
      keep({ step, line: text });
    }
    if (fresh.length) await report(fresh);
    if (exit !== undefined)
      return exit === 0
        ? { status: "succeeded", url, image: pinned }
        : { status: "failed", error: `The script exited with ${exit}: ${last}` };
    if (!text(polled.stderr).includes("alive") && polled.stdout.length === 0)
      return {
        status: "failed",
        error:
          "The script stopped without an exit line: its sandbox restarted. Request the run again.",
      };
    if (Date.now() - started > RUN_TIMEOUT_MS) {
      await sandbox.exec(
        ["bash", "-c", `kill -TERM -- -"$(cat ${base}.pid)" 2>/dev/null || true`],
        { timeoutMs: 30_000 },
      );
      return {
        status: "failed",
        error: `The run took longer than ${RUN_TIMEOUT_MS / 60_000} minutes and was stopped.`,
      };
    }
  }
}

/** The run's script: the deployment's variables, the Artifacts namespace and the image (a plan or
 *  deploy), then Alchemy's CLI. ONLY VALUES OF A STRICT PATTERN ARE WRITTEN INTO IT (records.ts: the
 *  ids, the name, the account id, the store, the stack), never free text such as the account's name
 *  or the owner's address, not even in a comment: every sandbox of the project reaches every
 *  project secret through egress, so a command a customer could write would reach the others'. Runs of one sandbox take turns on its checkout, under a lock. Each
 *  named step prints `== step <name>` (records.ts `stepOfLine`). */
export function runScriptOf(
  record: DeploymentRecord,
  kind: RunKind,
  requestOffset: number,
  image: ImageSource | null,
  step: ImageStep | undefined,
): string {
  // core/os's build, then Alchemy's CLI with its events as JSON on stderr (alchemy.ts): what
  // `pnpm run deploy` is on a laptop, as two steps
  const alchemy = {
    plan: "pnpm alchemy plan --log-format json",
    deploy: "pnpm alchemy deploy --yes --log-format json",
    destroy: "pnpm alchemy destroy --yes --log-format json",
  }[kind];
  return `#!/bin/bash
# run ${requestOffset}: ${kind} of ${record.name} (${record.id}) into ${record.accountId}
exec 9>/work/run.lock
flock 9 || exit 1
set -o pipefail
export CI=1 DO_NOT_TRACK=1 FORCE_COLOR=0 NO_COLOR=1
export CLOUDFLARE_ACCOUNT_ID=${shellQuote(record.accountId)}
export ITERATE__CLOUDFLARE__API_TOKEN=${shellQuote(placeholderOf(record.connection))}
export ALCHEMY_STAGE=${shellQuote(record.name)}
export ITERATE_STATE_STORE=cloudflare
export ITERATE_ALCHEMY_STATE_STORE_WORKER=${shellQuote(record.store)}
export ITERATE_STACK_NAME=${shellQuote(record.stack)}
export ITERATE_IMAGE_PINS='{}'
export ITERATE_CONFIG_FILE=${shellQuote(`../../../deployments/${record.id}/iterate.config.ts`)}
cd ${OS} || { echo "__EXIT__:1"; exit 1; }
echo "== ${kind} ${record.name} ($(date -u +%FT%TZ))"
${
  kind === "destroy"
    ? ""
    : `echo "== step namespace"
# The Artifacts namespace, which no deploy makes (core/os/SELF-HOSTING.md): every project's code lives in it.
answer=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/${record.accountId}/artifacts/namespaces" -H "Authorization: Bearer $ITERATE__CLOUDFLARE__API_TOKEN" -H "content-type: application/json" --data '{"namespace":"${record.name}-repos"}')
case "$answer" in *'"success":true'*) echo "created ${record.name}-repos";; *'"code":10201'*) echo "${record.name}-repos exists";; *) echo "refused: $answer"; echo "__EXIT__:1"; exit 1;; esac
${image && step ? imageStepOf(record, image, step, `${RUNS}/${requestOffset}-image`) : ""}echo "== step build"
pnpm build || { echo "__EXIT__:1"; exit 1; }
`
}echo "== step alchemy"
${alchemy}
code=$?
${kind === "deploy" ? CHECK_STEP(record) : ""}${kind === "destroy" ? REPOS_STEP(record) : ""}echo "__EXIT__:$code"
`;
}

/** After a deploy that succeeded: the new Worker answers at its workers.dev address, where a first
 *  deploy's address can answer Cloudflare's own not-found for a while. It asks the platform's
 *  `/version` (core/os/src/worker.ts) every 5 s for at most 5 minutes, says each new answer, and
 *  fails the run with the last one. The address is the account's workers.dev subdomain's
 *  (https://developers.cloudflare.com/api/resources/workers/subresources/subdomains/methods/get/). */
const CHECK_STEP = (record: DeploymentRecord) => `if [ "$code" = 0 ]; then
  echo "== step check"
  sub=$(curl -s "https://api.cloudflare.com/client/v4/accounts/${record.accountId}/workers/subdomain" -H "Authorization: Bearer $ITERATE__CLOUDFLARE__API_TOKEN" | jq -r '.result.subdomain // empty')
  if [ -z "$sub" ]; then echo "check: the account names no workers.dev subdomain"; code=1; else
    address="https://${record.name}.$sub.workers.dev"
    echo "== url $address"
    said=""; code=1
    for i in $(seq 1 60); do
      answer=$(curl -s -o /tmp/version -w '%{http_code}' "$address/version")
      [ "$answer" = "$said" ] || echo "check: $address/version answered HTTP $answer, +$(( (i - 1) * 5 ))s"
      said=$answer
      if [ "$answer" = 200 ]; then echo "check: $(head -c 200 /tmp/version)"; code=0; break; fi
      sleep 5
    done
    [ "$code" = 0 ] || echo "check: $address did not answer 200 within 5 minutes; it last answered HTTP $said"
  fi
fi
`;

/** After a destroy that succeeded: the Artifacts namespace the install made outside Alchemy goes,
 *  as core's own wrapper deletes it (scripts/os/deploy.ts `destroy`, scripts/os/preview-artifacts.ts
 *  `deleteArtifactsNamespace`). Cloudflare refuses a namespace that holds repos (409/10202), so
 *  each round lists the first page of repos and deletes them; once none is listed, it deletes the
 *  namespace, and three reads 2 s apart that answer 404 confirm it (one 404 can be a delete in
 *  flight). A delete answered "not empty" or "in progress" (409/10202, 409/10305) is asked again;
 *  five in a row with no repo listed is Cloudflare's, and fails the run with what it answered. At
 *  most 60 rounds. A repo name is used only when it is a plain name: it goes into a URL. */
const REPOS_STEP = (record: DeploymentRecord) => `if [ "$code" = 0 ]; then
  echo "== step repos"
  ns="https://api.cloudflare.com/client/v4/accounts/${record.accountId}/artifacts/namespaces/${record.name}-repos"
  auth="Authorization: Bearer $ITERATE__CLOUDFLARE__API_TOKEN"
  gone() { for i in 1 2 3; do [ "$i" = 1 ] || sleep 2; [ "$(curl -s -o /dev/null -w '%{http_code}' -H "$auth" "$ns")" = 404 ] || return 1; done; }
  if gone; then echo "${record.name}-repos does not exist"; else
    code=1; deleted=0; refused=0
    for round in $(seq 1 60); do
      names=$(curl -s -H "$auth" "$ns/repos?limit=200&page=1" | jq -r '.result[]?.name')
      if [ -n "$names" ]; then
        for repo in $names; do
          case "$repo" in .|..|*[!A-Za-z0-9._-]*) echo "repos: a repo named $(printf %q "$repo") is not a plain name: delete it by hand"; break 2;; esac
          answer=$(curl -s -o /tmp/repo -w '%{http_code}' -X DELETE -H "$auth" "$ns/repos/$repo")
          case "$answer" in 2??|404) deleted=$((deleted + 1));; *) echo "repos: deleting $repo answered HTTP $answer: $(head -c 300 /tmp/repo)"; break 2;; esac
        done
        echo "deleted $deleted repos"; refused=0; continue
      fi
      answer=$(curl -s -o /tmp/ns -w '%{http_code}' -X DELETE -H "$auth" "$ns")
      case "$answer" in
        2??|404) if gone; then echo "deleted ${record.name}-repos ($deleted repos)"; code=0; break; fi; refused=$((refused + 1));;
        409) grep -qE '"code":(10202|10305)' /tmp/ns || { echo "repos: deleting ${record.name}-repos answered HTTP 409: $(head -c 300 /tmp/ns)"; break; }
          refused=$((refused + 1)); echo "repos: ${record.name}-repos is not empty yet";;
        *) echo "repos: deleting ${record.name}-repos answered HTTP $answer: $(head -c 300 /tmp/ns)"; break;;
      esac
      if [ "$refused" -ge 5 ]; then echo "repos: Cloudflare will not delete ${record.name}-repos: it lists no repo, and its delete answers $(head -c 300 /tmp/ns)"; break; fi
      sleep 2
    done
    [ "$code" = 0 ] || [ "$round" != 60 ] || echo "repos: ${record.name}-repos still lists repos after 60 rounds"
  fi
fi
`;

/** What the sandbox beneath `own` reaches through its context: the project's egress, and its
 *  sandboxes. A sandbox's requests are answered by its context's `itx.fetch` (core/os
 *  src/sandbox/egress.ts), and its `start({ from })` finds the toolchain's sandbox through its own
 *  `itx.sandboxes` (core/os src/sandbox/durable-object.ts `#snapshotOf`). Its context's table
 *  resolves both through its parent's: the root has them, `/toolchain` and `/deployments/<id>` do
 *  not, so a sandbox beneath them has no internet and finds no snapshot ("has no snapshot to start
 *  from"). One rule each gives the context the root's. Keyed, so each lands once. */
async function withProjectRoots(own: Root) {
  await own.append(
    {
      type: "events.iterate.com/itx/rewrite-rule-configured",
      idempotencyKey: "cloud/sandbox-egress",
      payload: {
        match: "itx.fetch",
        target: "itx.cd('/').fetch",
        description: "the project's egress, for this context's sandbox",
      },
    },
    {
      type: "events.iterate.com/itx/rewrite-rule-configured",
      idempotencyKey: "cloud/sandbox-collection",
      payload: {
        match: "itx.sandboxes",
        target: "itx.cd('/').sandboxes",
        description:
          "the project's sandboxes, for this context's sandbox to start from the toolchain",
      },
    },
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────

async function exists(sandbox: Sandbox, path: string) {
  try {
    await sandbox.files.stat(path);
    return true;
  } catch (error) {
    if (errorCodeOf(error) === "ENOENT") return false;
    throw error;
  }
}

async function tailOf(sandbox: Sandbox, path: string, bytes: number) {
  return text(
    (await sandbox.exec(["bash", "-c", `tail -c ${bytes} ${shellQuote(path)} 2>/dev/null || true`]))
      .stdout,
  );
}

const text = (bytes: Uint8Array | { stdout: Uint8Array }) =>
  new TextDecoder().decode(bytes instanceof Uint8Array ? bytes : bytes.stdout);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
