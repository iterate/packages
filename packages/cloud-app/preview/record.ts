// Turns one deployment's recorded log into preview/moments.json: the live state a browser gets
// (secrets masked) at each moment of an install that the deployment page must draw well. The
// processor is pure, so replaying the log through its reduce gives every state the page saw.
//
//   pnpm page-preview:record <log.json>
//
// <log.json> is the deployment context's events as JSON, `{ type, offset, createdAt, payload }`,
// with the config left out of `cloud/deployment-requested` (it holds the secrets). Two moments the
// run did not reach are made from it and say so: Alchemy failing on a resource, and the check
// still waiting.
import { readFileSync, writeFileSync } from "node:fs";
import { mintConfig } from "@iterate-com/cloud/config";
import { DeploymentState, type DeploymentRecord } from "@iterate-com/cloud/records";
import { DeploymentProcessor } from "../../cloud/src/deployment.ts";

type Logged = { type: string; offset: number; createdAt: string; payload: any };

const log: Logged[] = JSON.parse(readFileSync(process.argv[2]!, "utf8"));
// the reduce is pure: it never calls the sandbox work, so the deps refuse
const refuse = () => Promise.reject(new Error("a replay does no sandbox work"));
const processor = new DeploymentProcessor({ prepare: refuse, attempt: refuse });
const reduce = (state: DeploymentState, event: Logged) =>
  // safe: a logged event is the deployment context's own (`{ type, offset, createdAt, payload }`
  // as readEvents gives it), of the types the contract defines; the reduce reads only `state` and
  // `event`, and its arguments' type names the engine's other fields, which a replay has none of
  processor.reduce({ state, event } as never) || state;

// a config of fresh secrets in place of the one left out: the live state masks every one
const requested = log.find((event) => event.type === "cloud/deployment-requested")!;
const record: DeploymentRecord = requested.payload.record;
requested.payload.config = mintConfig(record);

const states: { event: Logged; state: DeploymentState }[] = [];
let state = DeploymentState.parse({});
for (const event of log.filter((logged) => logged.type.startsWith("cloud/"))) {
  state = reduce(state, event);
  states.push({ event, state });
}
const live = (at: DeploymentState) => processor.projectLiveState(at);
const running = (at: DeploymentState, step: string) =>
  at.run?.steps.some((known) => known.name === step && known.status === "running");
const inProgress = (at: DeploymentState) =>
  at.run?.resources.filter((resource) => /ing\b/.test(resource.status || "")).length || 0;

const sandbox = states.find((at) => at.state.preparation?.status === "running")!.state;
const build = states.findLast((at) => running(at.state, "build"))!.state;
const alchemy = states
  .filter((at) => running(at.state, "alchemy"))
  .reduce((most, at) => (inProgress(at.state) > inProgress(most.state) ? at : most));
const beforeCheck = states.findLast((at) => running(at.state, "alchemy"))!;
const checkBatch = states.find((at) => running(at.state, "check"))!.event;
const done = states.at(-1)!.state;

// made: the check's first record alone, its step's marker, so the step runs with nothing printed
const checking = reduce(beforeCheck.state, {
  ...checkBatch,
  payload: { ...checkBatch.payload, lines: ["== step check"] },
});
// made: the Worker fails while Alchemy creates the resources, and the run settles failed with the
// line Alchemy printed last, as runs.ts says it
const worker = alchemy.state.run!.resources.find(
  (resource) => resource.type === "Cloudflare.Worker",
)!;
const lastLine = alchemy.state.run!.steps.find((step) => step.name === "alchemy")!.tail.at(-1);
const failing = reduce(alchemy.state, {
  type: "cloud/alchemy-reported",
  offset: alchemy.event.offset + 1,
  createdAt: alchemy.event.createdAt,
  payload: {
    requestOffset: alchemy.state.run!.requestOffset,
    attempt: 1,
    at: alchemy.state.run!.lines,
    event: {
      type: "apply.resource.status",
      fqn: worker.fqn,
      id: worker.id,
      resourceType: worker.type,
      status: "fail",
      message: "made for the preview: no real run failed here",
    },
  },
});
const failed = reduce(failing, {
  type: "cloud/run-settled",
  offset: alchemy.event.offset + 2,
  createdAt: alchemy.event.createdAt,
  payload: {
    requestOffset: alchemy.state.run!.requestOffset,
    status: "failed",
    attempts: 1,
    error: `The script exited with 1: ${lastLine}`,
  },
});

const standIns = new Map<string, string>();

const moments = [
  { name: "The installer's sandbox starts", state: live(sandbox) },
  { name: "The build prints", state: live(build) },
  { name: "Alchemy creates the resources", state: live(alchemy.state) },
  { name: "The check waits for the Worker (made)", state: live(checking) },
  { name: "Installed", state: live(done) },
  { name: "Alchemy fails on the Worker (made)", state: live(failed) },
];
const out = JSON.stringify(
  moments,
  (_key, value: unknown) => (typeof value === "string" ? standIn(value) : value),
  2,
);
const { adminBearer, secretsEncryption, login } = requested.payload.config;
for (const secret of [adminBearer, secretsEncryption.key, login.methods.password.password])
  if (out.includes(secret)) throw new Error("a secret is in the moments");
writeFileSync(new URL("./moments.json", import.meta.url), `${out}\n`);

/** `text` with every id, hash, account id and random suffix in it replaced by a stand-in of the
 *  same length, the same for the same original: packages/ is copied to a public repo, which holds
 *  no real one (lint/public-copies.test.ts), and the moments stay consistent. A stand-in is runs of
 *  one character and a counter, which reads as test data. */
function standIn(text: string) {
  return text.replace(
    /(?<![0-9a-z])(?:[0-9a-f]{8,}|[a-z0-9]{16,}|\d{10,})(?![0-9a-z])/g,
    (found) => {
      if (found.length < 8 || !/\d/.test(found)) return found;
      let replaced = standIns.get(found);
      if (!replaced) {
        const counter = String(standIns.size + 1);
        const fill = /^[0-9a-f]+$/.test(found) ? "0" : "x";
        replaced = fill.repeat(found.length - counter.length) + counter;
        standIns.set(found, replaced);
      }
      return replaced;
    },
  );
}
console.log(moments.map((moment) => moment.name).join("\n"));
