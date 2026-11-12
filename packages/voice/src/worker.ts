/// <reference path="./markdown.d.ts" />
/**
 * The voice service, explicitly mounted at `itx.voice`, is what a device calls when it connects:
 *
 *   await root.voice.ensureVoiceDevice({ client, screen? })   // → { path, agentPath }
 *
 * A device has two contexts, made once and kept: its agent (`/agents/voice/<client>`, normal agent
 * creation: the parent link to the context that asked, the catalog entry and the agents app's
 * processor, which answers every delegation) and its relay (`/voice/<client>`, the voice relay's
 * subscription and a parent link of its own). Two, because a context's birth restarts what it
 * runs, and an agent's cold build must never sit in front of the relay's dial. The press is then
 * the device's ONE append to the relay's context, `call-started`, with nothing created on it. The
 * device carries no source or class name: the relay is `voice.ts`'s class of the mind's
 * published config, the module this worker is (install.ts `voiceAgentFacetSpec`).
 */
import type { AgentsRootApi } from "iterate/agents";
import type { IterateContextApi } from "iterate/api";
import { bytesToBase64 } from "iterate/lib";
import { IterateConfigEntrypoint } from "iterate/sdk";
import { z } from "zod";
import type { VoiceApi } from "./api.ts";
import { voiceAgentFacetSpec } from "./install.ts";
import { ScreenInfo, ScreenImageInput, renderScreenPixels } from "./screen.ts";
import SCREEN_CONTEXT from "./screen-context.md";
import VOICE_CONTEXT from "./voice-context.md";

/** A device's name in its two paths: a Kit board's `itx.clients` name, or the installation id a
 *  browser or the CLI keeps. */
const VoiceDeviceName = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** The device agent's `agent/configured` patch: no debounce, and an idle summary 15 minutes after
 *  its last request, while the provider still holds its history in cache, once 2,000 tokens are
 *  new since the last summary. A call adds a few hundred tokens, so the platform's default (30,000)
 *  never summarised a device and each press sent its whole history. The patch is keyed by its
 *  digest, so every device takes a changed patch at its next connect. */
const DEVICE_AGENT_CONFIG = {
  llmRequestDebounceMs: 0,
  idleCompactionAfterMs: 15 * 60_000,
  idleCompactionMinNewTokens: 2_000,
};

/** The first 16 hex digits of the words' SHA-256: what keys an instruction to its words. */
async function shortDigest(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest).subarray(0, 8), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export default class VoiceWorker extends IterateConfigEntrypoint implements VoiceApi {
  async health() {
    using itx = this.getItx();
    const { mindId, mindSlug } = await itx.whoami();
    return { ok: true as const, mindId, mindSlug };
  }

  /** Render to the resolution and pixel format advertised by the target. */
  async setImage(rawInput: Parameters<VoiceApi["setImage"]>[0]) {
    const input = ScreenImageInput.parse(rawInput);
    const startedAt = Date.now();
    // One scope for the whole upload, bounded by the screen's refreshTimeoutMs.
    using scope = this.getItx();
    // ITX mounts are dynamic remote capabilities. Validate their returned
    // metadata at the boundary; this interface describes the methods we call.
    const itx = scope as unknown as {
      browser: {
        quickAction(action: "screenshot", options: Record<string, unknown>): Promise<Uint8Array>;
      };
      clients: Record<
        string,
        {
          screen: {
            info(): Promise<unknown>;
            setImage(
              input: null | { uploadId: number; offset: number; format: string; data: string },
            ): Promise<unknown>;
          };
        }
      >;
    };
    const screen = itx.clients[input.device]!.screen;
    const info = ScreenInfo.parse(await screen.info());
    if (!input.image) {
      const transferStartedAt = Date.now();
      await screen.setImage(null);
      const transferMs = Date.now() - transferStartedAt;
      return {
        shown: false as const,
        bytes: 0,
        renderMs: 0,
        transferMs,
        totalMs: Date.now() - startedAt,
      };
    }
    const format = input.image.format || info.preferredFormat;
    if (!info.formats.includes(format)) throw new Error(`Screen does not support ${format}`);
    const renderStartedAt = Date.now();
    const png = await itx.browser.quickAction("screenshot", {
      html: input.image.html,
      viewport: { width: info.width, height: info.height, deviceScaleFactor: 1 },
      // A screenshot can succeed even when an <img> is a broken-link icon.
      // Gate capture on decoded images and loaded fonts, with a bounded wait.
      addScriptTag: [
        {
          content: `
          document.documentElement.removeAttribute("data-iterate-screen-assets");
          Promise.all([
            ...Array.from(document.images, image => { image.loading = "eager"; return image.decode(); }),
            document.fonts.ready,
          ]).then(
            () => document.documentElement.setAttribute("data-iterate-screen-assets", "ready"),
            () => document.documentElement.setAttribute("data-iterate-screen-assets", "failed"),
          );
        `,
        },
      ],
      waitForSelector: { selector: '[data-iterate-screen-assets="ready"]', timeout: 5000 },
      screenshotOptions: { type: "png", fullPage: false },
    });
    const renderMs = Date.now() - renderStartedAt;
    const bitmap = renderScreenPixels(
      png instanceof Uint8Array ? png : new Uint8Array(png),
      info,
      format,
    );
    const uploadId = Math.floor(Math.random() * 0x7fffffff);
    const transferStartedAt = Date.now();
    let slowestChunkMs = 0;
    for (let offset = 0; offset < bitmap.length; offset += info.maxChunkBytes) {
      const expected = Math.min(offset + info.maxChunkBytes, bitmap.length);
      const sentAt = Date.now();
      const answer = screen.setImage({
        uploadId,
        format,
        offset,
        data: bytesToBase64(bitmap.subarray(offset, expected)),
      });
      // The chunk that completes the frame is answered once the panel shows it, and fails if the
      // refresh fails (iterate/kit's firmware/components/capabilities/src/screen.c). Its bound is the
      // screen's refreshTimeoutMs on top of the slowest round trip an earlier chunk took.
      let refreshDeadline: ReturnType<typeof setTimeout> | undefined;
      const acknowledged = await (expected < bitmap.length
        ? answer
        : Promise.race([
            answer,
            new Promise<never>((_, reject) => {
              refreshDeadline = setTimeout(
                () => reject(new Error("Screen refresh timed out")),
                slowestChunkMs + info.refreshTimeoutMs,
              );
            }),
          ]).finally(() => {
            if (refreshDeadline) clearTimeout(refreshDeadline);
          }));
      slowestChunkMs = Math.max(slowestChunkMs, Date.now() - sentAt);
      if (acknowledged !== expected) {
        throw new Error(
          `screen acknowledged ${String(acknowledged)} bytes; expected ${String(expected)}`,
        );
      }
    }
    const transferMs = Date.now() - transferStartedAt;
    return {
      shown: true as const,
      width: info.width,
      height: info.height,
      format,
      bytes: bitmap.length,
      renderMs,
      transferMs,
      totalMs: Date.now() - startedAt,
    };
  }

  /** Provisioning, before any press: the device's agent at `/agents/voice/<client>`, told how to
   *  answer a spoken call, and its relay at `/voice/<client>`, each linked to the context that asked.
   *  Idempotent: for a provisioned device it is one append to each context, which changes nothing. */
  async ensureVoiceDevice(options: Parameters<VoiceApi["ensureVoiceDevice"]>[0]) {
    const client = VoiceDeviceName.parse(options.client);
    // the device `setImage` will be asked to draw on, so it is held to the same name
    const screen = options.screen ? ScreenImageInput.shape.device.parse(options.screen) : undefined;
    const path = `/voice/${client}`;
    const agentPath = `/agents/voice/${client}`;
    // The link goes to the context that asked (`callerPath`), not to the root this worker runs as:
    // every context linked to the root inherits `itx.voice`, and a device holds no more than the
    // context that provisioned it.
    const caller = this.callerPath();
    // `itx.agents` is the rewrite rule the agents app mounts on the root, installed by the same init
    // case, and this scope is the root's, so it is the root collection, `at` included.
    using itx = this.getItx() as IterateContextApi & { agents: AgentsRootApi } & Disposable;
    await itx.agents.at(caller).create(agentPath);
    /* Each instruction is keyed by its words, so a build with new words adds them once. They start
     * no turn: the first turn is the first hand-over. */
    const instruction = async (name: string, content: string) => ({
      type: "events.iterate.com/agent/context-added",
      idempotencyKey: `voice-device/${name}:${await shortDigest(content)}`,
      payload: {
        role: "developer",
        content,
        llmRequestPolicy: { behaviour: "dont-trigger-request" },
      },
    });
    await Promise.all([
      itx.cd(agentPath).append(
        await instruction("voice-context", VOICE_CONTEXT),
        ...(screen
          ? [
              await instruction(
                `screen-context:${screen}`,
                SCREEN_CONTEXT.replaceAll("{{DEVICE}}", screen),
              ),
            ]
          : []),
        /* A person on a call is waiting: the agent answers a hand-over at once, with no window
         * for more words. Between calls, the agent's history gets its idle summary. Keyed by
         * its values, like the instructions, so a build with new ones patches them once. */
        {
          type: "events.iterate.com/agent/configured",
          idempotencyKey: `voice-device/configured:${await shortDigest(JSON.stringify(DEVICE_AGENT_CONFIG))}`,
          payload: { config: DEVICE_AGENT_CONFIG },
        },
        /* What the relay needs of the agent's log, copied to the relay's: its status, its
         * messages, a pause, and each failed script. */
        {
          type: "events.iterate.com/itx/subscription-configured",
          idempotencyKey: `voice-device/copy-to:${path}`,
          payload: {
            name: "voice-relay",
            consumes: [
              "events.iterate.com/agent/summary-updated",
              "events.iterate.com/agent/web-message-sent",
              "events.iterate.com/agent/paused",
            ],
            target: { path, payload: "payload" },
          },
        },
        /* The platform never copies an `itx/*` event, so a failed script reaches the relay as
         * the agent's own report of it, the note its next turn reads (iterate/agents
         * result-render.ts). */
        {
          type: "events.iterate.com/itx/subscription-configured",
          idempotencyKey: `voice-device/script-failures-to:${path}`,
          payload: {
            name: "voice-relay-script-failed",
            consumes: ["events.iterate.com/agent/context-added"],
            filter: `$substring(payload.content, 0, 18) = "Your script failed"`,
            target: {
              path,
              type: "events.iterate.com/voice-agent/script-failed",
              payload: `{ "report": $substring(payload.content, 0, 300) }`,
            },
          },
        },
      ),
      itx.cd(path).append(
        {
          type: "events.iterate.com/itx/rewrite-rule-configured",
          idempotencyKey: "voice-device/parent",
          payload: { match: "itx", target: `itx.cd(${JSON.stringify(caller)})` },
        },
        {
          type: "events.iterate.com/itx/subscription-configured",
          idempotencyKey: "voice-device/relay",
          payload: {
            name: "voice-agent",
            target: [
              "itx",
              "facets",
              ["get", "voice-agent", voiceAgentFacetSpec],
              "processEventBatch",
            ],
            /* Every durable event, plus the two ephemeral types a processor only sees by name. */
            consumes: [
              "*",
              "events.iterate.com/voice-agent/mic-frame",
              "events.iterate.com/voice-agent/keepalive",
            ],
          },
        },
        /* The live model delegates within seconds of a press, so each press asks the agent to get
         * ready. A row, not the relay's own code: nothing it does can delay the dial. */
        {
          type: "events.iterate.com/itx/subscription-configured",
          idempotencyKey: `voice-device/warm-up:${agentPath}`,
          payload: {
            name: "voice-agent-warm-up",
            consumes: ["events.iterate.com/voice-agent/call-started"],
            target: { path: agentPath, type: "events.iterate.com/agent/warm-up-requested" },
          },
        },
        {
          type: "events.iterate.com/voice-agent/device-provisioned",
          idempotencyKey: `voice-device/provisioned:${agentPath}`,
          payload: { agentPath },
        },
      ),
    ]);
    return { path, agentPath };
  }
}
