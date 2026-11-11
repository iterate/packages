// install.ts — what a config repo's init case calls (README.md), what Kit's Prepare runs for a
// mind, and the upgrade of the build the config pins. The config repo
// depends on this package and re-exports its service and relay class from `voice.ts`, and every
// rule and row voice writes names that module of the mind's published config, as the agents
// app's name `agents.ts` (iterate/agents/install). Not the runtime, so importing it loads none.
// Kit lives in iterate/kit and installs this package from pkg.pr.new at a pinned commit: a change to
// what `ensureVoiceAgent` asks for or writes reaches Kit's Prepare only when that pin moves.
import type {} from "./api.ts"; // registers `itx.voice` on InstalledAppRoots
import type { FacetSpec, IterateContextApi, IterateContextApiWith, RepoHandle } from "iterate/api";
import { canonicalItxExpressionPrefix, type ItxExpressionInput } from "iterate/expression";
import { errorCode } from "iterate/lib";
import { z } from "zod";
import { SCREEN_FONT_CSS } from "./screen-font.ts";

/** Where voice's code is: `voice.ts` of the mind's published config, with no cache key, so what
 *  runs changes only when that module's bundle does (a new pin of this package). */
const PUBLISHED: Omit<FacetSpec, "className"> = {
  mainModule: "voice.ts",
  source: ["itx", ["cd", "/"], "config"],
};

/** The relay facet each device's own context runs (worker.ts `ensureVoiceDevice`). */
export const voiceAgentFacetSpec: FacetSpec = {
  className: "VoiceAgentDurableObject",
  ...PUBLISHED,
};

/** Idempotent: the screen font a screen script embeds (screen-context.md), and the `itx.voice` rule
 *  to `voice.ts`'s default export. Voice runs on the agents app, every device an agent, which the same
 *  init case installs (`installAgents`). */
export async function installVoice(
  itx: Pick<IterateContextApi, "append"> & { kv: Pick<IterateContextApi["kv"], "put"> },
) {
  await itx.kv.put("voice/screen-font.css", SCREEN_FONT_CSS);
  await itx.append({
    type: "events.iterate.com/itx/rewrite-rule-configured",
    payload: {
      match: "itx.voice",
      target: ["itx", "workers", ["get", PUBLISHED]],
      description:
        "The mind's installed voice service: ensureVoiceDevice({ client, screen? }), setImage({ device, image }), health()",
    },
  });
}

const VoiceHealth = z.object({ ok: z.literal(true) });

/** The config repo's part the voice checks read and the upgrade writes. */
type ConfigRepo = Pick<RepoHandle, "tip" | "readFile">;

/** What Kit's Prepare runs for a mind: the OpenAI key (the live model's) stored
 *  when the mind has none — `needs-openai-key` without one — then `itx.voice`, which the
 *  mind's init case installs (`installVoice`), waited for (`voiceInstalled`), and asked for
 *  `health()`. A mind whose config repo neither has `itx.voice` nor pins this package at its tip
 *  never gets one: refused at once, before a key is stored. */
export async function ensureVoiceAgent(
  mind: Pick<IterateContextApi, "waitForEvent"> & {
    secrets: Pick<IterateContextApi["secrets"], "list" | "set">;
    rewriteRules: Pick<IterateContextApi["rewriteRules"], "get">;
    repos: { get(path: string): ConfigRepo };
  },
  openaiKey?: string,
): Promise<"ready" | "needs-openai-key"> {
  const repo = mind.repos.get("/repos/config");
  const [secrets, rule, config] = await Promise.all([
    mind.secrets.list(),
    mind.rewriteRules.get("itx.voice"),
    // the config repo's tip, or none while a mind created a moment ago has no config repo yet:
    // voice is then waited for below
    repo.tip().then(
      (tip) => ({ tip }),
      (error: unknown) => {
        if (errorCode(error) === "NOT_CREATED") return undefined;
        throw error;
      },
    ),
  ]);
  const tip = config?.tip;
  // a config repo not created yet, or created but not yet seeded (no tip), is waited for below
  if (!rule?.target && tip && !voicePinIn(await repo.readFile("package.json", { commitOid: tip })))
    throw new Error(
      `This mind's config repo does not install voice: its package.json lists no @iterate-com/voice, and its init case calls no installVoice(itx) (@iterate-com/voice/install), as configs/voice does`,
    );
  if (!secrets.some((secret) => secret.path === "/secrets/openai")) {
    if (!openaiKey?.trim()) return "needs-openai-key";
    await mind.secrets.set("/secrets/openai", openaiKey.trim(), {
      urls: ["https://api.openai.com"],
    });
  }
  if (!rule?.target) await voiceInstalled(mind, tip);
  // The rule is there, so the handle answers `voice`: the mind's own service is still parsed,
  // since only ours is typed by VoiceApi.
  const installed = mind as typeof mind & Pick<IterateContextApiWith<"voice">, "voice">;
  VoiceHealth.parse(await installed.voice.health());
  return "ready";
}

/** The mind's `itx.voice` rule, as the root stores its match (parsed), waited for until one
 *  minute from now: a mind created a moment ago gets it from its config repo's first init case.
 *  A failed creation, or the refused publication of `tip`, the commit that pins voice (none while
 *  the repo is not created yet), refuses at once, saying why. */
async function voiceInstalled(
  mind: Pick<IterateContextApi, "waitForEvent"> & {
    rewriteRules: Pick<IterateContextApi["rewriteRules"], "get">;
  },
  tip: string | null | undefined,
) {
  const deadline = Date.now() + 60_000;
  for (let afterOffset = 0; Date.now() < deadline;) {
    const event = await mind
      .waitForEvent({
        type: [
          "events.iterate.com/itx/rewrite-rule-configured",
          "events.iterate.com/mind/create-failed",
          "events.iterate.com/mind/worker-update-failed",
        ],
        afterOffset,
        timeoutMs: deadline - Date.now(),
      })
      .catch((error: unknown) => {
        if (errorCode(error) !== "WAIT_TIMEOUT") throw error;
      });
    if (!event) break;
    const { payload } = event;
    if (event.type === "events.iterate.com/mind/create-failed")
      throw new Error(
        `The mind's creation failed, so its config repo installs no voice: ${String(payload?.error)}`,
      );
    if (
      event.type === "events.iterate.com/mind/worker-update-failed" &&
      tip &&
      payload?.commitOid === tip
    )
      throw new Error(
        `The mind's config (commit ${tip.slice(0, 7)}) was not published, so it installs no voice: ${String(payload.error)}`,
      );
    if (
      event.type === "events.iterate.com/itx/rewrite-rule-configured" &&
      payload?.target &&
      canonicalItxExpressionPrefix(payload.match as ItxExpressionInput) === "itx.voice" &&
      // the log keeps every rule the root ever had: one a later write removed is not installed
      (await mind.rewriteRules.get("itx.voice"))?.target
    )
      return;
    afterOffset = event.offset;
  }
  throw new Error(
    "Voice was not installed within a minute: the mind's config repo pins @iterate-com/voice, and installs it with installVoice(itx) (@iterate-com/voice/install) in its init case, as configs/voice does",
  );
}

/** The part of a config repo's root package.json an upgrade reads and rewrites; every other field
 *  is carried through untouched. */
const RootManifest = z.object({ dependencies: z.record(z.string(), z.string()).optional() });

/** The `@iterate-com/voice` a root package.json's `text` lists among its dependencies: undefined for
 *  none, no file, or one that is not a package.json. */
function voicePinIn(text: string | null): string | undefined {
  try {
    return RootManifest.parse(JSON.parse(text || "{}")).dependencies?.["@iterate-com/voice"];
  } catch {
    return undefined;
  }
}

/** The build of voice the mind RUNS: what the root package.json pins at the commit of
 *  `/repos/config` the platform last published (the `mind` facet's `publishedCommit`), which
 *  the tip is not while an upgrade's publication is owed or after it was refused. Undefined before
 *  the first publication, or when that commit pins no such package. */
export async function voiceVersion(mind: {
  facets: {
    get(name: "mind"): { snapshot(): Promise<{ state: { publishedCommit: string | null } }> };
  };
  repos: { get(path: string): Pick<RepoHandle, "readFile"> };
}): Promise<string | undefined> {
  const { state } = await mind.facets.get("mind").snapshot();
  if (!state.publishedCommit) return undefined;
  const repo = mind.repos.get("/repos/config");
  return voicePinIn(await repo.readFile("package.json", { commitOid: state.publishedCommit }));
}

/**
 * AN UPGRADE of the mind's voice to `version`: the root package.json's pin, committed on the tip
 * it read (refused if main moved meanwhile; a file already so commits nothing, and the tip's outcome
 * answers), then that commit's outcome on `/`, past any give-up for now (`unavailable`), which
 * leaves it owed. Published, each device's relay loads the new build at its next event
 * (`voiceAgentFacetSpec`); refused, main moving on included, it throws why and the person upgrades again. Answers the
 * commit. The agents app is the platform's own (iterate/agents) and upgrades with it.
 */
export async function upgradeVoice(
  mind: Pick<IterateContextApi, "waitForEvent"> & {
    repos: { get(path: string): ConfigRepo & Pick<RepoHandle, "commitFiles"> };
  },
  version: string,
) {
  const repo = mind.repos.get("/repos/config");
  const tip = await repo.tip();
  const manifest: Record<string, unknown> = JSON.parse(
    (await repo.readFile("package.json")) || "{}",
  );
  // the pin set in place: every other field and dependency keeps its value and its order
  const { dependencies } = RootManifest.parse(manifest);
  manifest.dependencies = { ...dependencies, "@iterate-com/voice": version };
  const { commitOid } = await repo.commitFiles({
    message: `Upgrade @iterate-com/voice to ${version}`,
    parent: tip,
    changes: [{ path: "package.json", content: `${JSON.stringify(manifest, null, 2)}\n` }],
  });
  // one deadline for the whole wait: a give-up for now does not restart it
  const deadline = Date.now() + 120_000;
  for (let afterOffset = 0; ;) {
    const outcome = await mind.waitForEvent({
      type: [
        "events.iterate.com/mind/worker-updated",
        "events.iterate.com/mind/worker-update-failed",
      ],
      payload: { commitOid },
      afterOffset,
      timeoutMs: Math.max(1, deadline - Date.now()),
    });
    if (outcome.type === "events.iterate.com/mind/worker-updated") return commitOid;
    if (!outcome.payload?.unavailable)
      throw new Error(`The upgrade was not published: ${String(outcome.payload?.error)}`);
    // the platform gave up for now and still owes the commit: its outcome comes after this one
    afterOffset = outcome.offset;
  }
}
