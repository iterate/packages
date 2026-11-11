import { runInNewContext } from "node:vm";
import { URL } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { build } from "esbuild";
import { expect, test, vi } from "vitest";

import { admitLoadedCodeRow } from "../../../core/itx/src/context/itx-expression-rewriting.ts";

// Whichever row runs first pays for bundling the worker with esbuild (`loadVoiceWorker()`), which
// used to run under the hook budget; every row gets that budget.
vi.setConfig({ testTimeout: 10_000 });

test.for([0, 1, 2, 3, 4])(
  "RGBA PNG row filter %i reaches the panel as 15000 black bytes",
  async (filter) => {
    const { worker, quickAction, setImage } = await harness(png(4, filter));
    const result = await worker.setImage({
      device: "waveshare_rlcd_4_2",
      image: { html: "hello" },
    });
    expect(result).toMatchObject({ shown: true, bytes: 15000 });
    expect(quickAction).toHaveBeenCalledWith(
      "screenshot",
      expect.objectContaining({
        viewport: { width: 400, height: 300, deviceScaleFactor: 1 },
      }),
    );
    const chunks = setImage.mock.calls.map(([chunk]) => chunk);
    expect(chunks.map((chunk) => chunk.offset)).toEqual([0, 4096, 8192, 12288]);
    expect(new Set(chunks.map((chunk) => chunk.uploadId))).toMatchObject({ size: 1 });
    expect(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.data, "base64")))).toEqual(
      Buffer.alloc(15000, 255),
    );
  },
);

test("a null image uses the same setter without rendering", async () => {
  const { worker, quickAction, setImage } = await harness();
  expect(await worker.setImage({ device: "waveshare_rlcd_4_2", image: null })).toMatchObject({
    shown: false,
    bytes: 0,
  });
  expect(quickAction).not.toHaveBeenCalled();
  expect(setImage).toHaveBeenCalledExactlyOnceWith(null);
});

test("an incorrect device acknowledgment stops the upload", async () => {
  const { worker, setImage } = await harness();
  setImage.mockResolvedValueOnce(0);
  await expect(
    worker.setImage({ device: "waveshare_rlcd_4_2", image: { html: "hello" } }),
  ).rejects.toThrow("expected 4096");
  expect(setImage).toHaveBeenCalledTimes(1);
});

test.for(["waveshare_rlcd_4_2", "zectrix_note4", "home_assistant_voice_preview_edition"])(
  "%s: provisioning makes the device's agent, told how to answer a call, and its relay on a context of its own; the screen guide only to a screen",
  async (device) => {
    const { worker, appended, at, create } = await harness();
    const screen = device !== "home_assistant_voice_preview_edition";
    const path = `/voice/${device}`;
    const agentPath = `/agents/voice/${device}`;
    expect(
      await worker.ensureVoiceDevice({ client: device, ...(screen && { screen: device }) }),
    ).toEqual({ path, agentPath });
    expect(at).toHaveBeenCalledExactlyOnceWith("/");
    expect(create).toHaveBeenCalledExactlyOnceWith(agentPath);
    const guide = (name: string) =>
      readFileSync(new URL(`./${name}`, import.meta.url), "utf8").replaceAll("{{DEVICE}}", device);
    // Instructions start no turn: the agent's first turn is the first hand-over.
    const instruction = (content: string) => ({
      type: "events.iterate.com/agent/context-added",
      idempotencyKey: expect.stringMatching(/^voice-device\/.+:[0-9a-f]{16}$/),
      payload: {
        role: "developer",
        content,
        llmRequestPolicy: { behaviour: "dont-trigger-request" },
      },
    });
    expect(appended).toEqual({
      [agentPath]: [
        [
          instruction(guide("voice-context.md")),
          ...(screen ? [instruction(guide("screen-context.md"))] : []),
          // no debounce for a waiting caller; the idle summary 15 minutes after a request
          {
            type: "events.iterate.com/agent/configured",
            idempotencyKey: expect.stringMatching(/^voice-device\/configured:[0-9a-f]{16}$/),
            payload: {
              config: {
                llmRequestDebounceMs: 0,
                idleCompactionAfterMs: 900_000,
                idleCompactionMinNewTokens: 2_000,
              },
            },
          },
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
          {
            type: "events.iterate.com/itx/subscription-configured",
            idempotencyKey: `voice-device/script-failures-to:${path}`,
            payload: expect.objectContaining({
              name: "voice-relay-script-failed",
              consumes: ["events.iterate.com/agent/context-added"],
              target: expect.objectContaining({
                path,
                type: "events.iterate.com/voice-agent/script-failed",
              }),
            }),
          },
        ],
      ],
      [path]: [
        [
          {
            type: "events.iterate.com/itx/rewrite-rule-configured",
            idempotencyKey: "voice-device/parent",
            payload: { match: "itx", target: 'itx.cd("/")' },
          },
          {
            type: "events.iterate.com/itx/subscription-configured",
            idempotencyKey: "voice-device/relay",
            payload: {
              name: "voice-agent",
              target: [
                "itx",
                "facets",
                [
                  "get",
                  "voice-agent",
                  {
                    className: "VoiceAgentDurableObject",
                    mainModule: "voice.ts",
                    source: ["itx", ["cd", "/"], "config"],
                  },
                ],
                "processEventBatch",
              ],
              consumes: [
                "*",
                "events.iterate.com/voice-agent/mic-frame",
                "events.iterate.com/voice-agent/keepalive",
              ],
            },
          },
          // each press readies the agent, beside the dial
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
        ],
      ],
    });
  },
);

test("provisioning a provisioned device appends the same keyed rows, which the log keeps once", async () => {
  const { worker, appended } = await harness();
  await worker.ensureVoiceDevice({ client: "web-1a2b3c", screen: "zectrix_note4" });
  const first = structuredClone(appended);
  await worker.ensureVoiceDevice({ client: "web-1a2b3c", screen: "zectrix_note4" });
  expect(appended).toEqual(
    Object.fromEntries(
      Object.entries(first).map(([path, batches]) => [path, [...batches, ...batches]]),
    ),
  );
});

test.for([
  { name: "a device name that is not one path segment", client: "../agents", screen: undefined },
  {
    name: "a screen that is not an itx.clients name",
    client: "waveshare",
    screen: "waveshare-rlcd-4-2",
  },
])("$name is refused before the agent exists", async ({ client, screen }) => {
  const { worker, create } = await harness();
  await expect(worker.ensureVoiceDevice({ client, screen })).rejects.toThrow();
  expect(create).not.toHaveBeenCalled();
});

test("the device's agent and relay are linked to the context that asked, not to the root this worker runs as", async () => {
  const { worker, appended, at, create } = await harness(png(3, 0), {}, "/child");
  await worker.ensureVoiceDevice({ client: "pin" });
  expect(at).toHaveBeenCalledExactlyOnceWith("/child");
  expect(create).toHaveBeenCalledExactlyOnceWith("/agents/voice/pin");
  expect(appended["/voice/pin"]?.[0]?.[0]).toMatchObject({
    payload: { match: "itx", target: 'itx.cd("/child")' },
  });
});

// Regression: a photo URL in the September 21 voice stream returned HTTP 404.
// Chromium still produced a valid PNG containing the broken-image icon.
test.for([true, false])(
  "image decode success=%s controls whether pixels reach the device",
  async (loaded) => {
    const { worker, quickAction, setImage } = await harness();
    quickAction.mockImplementationOnce(async (...args: any[]) => {
      const options = args[1];
      const attrs = new Map<string, string>();
      const document = {
        images: [{ decode: () => (loaded ? Promise.resolve() : Promise.reject(new Error("404"))) }],
        fonts: { ready: Promise.resolve() },
        documentElement: {
          removeAttribute: (key: string) => attrs.delete(key),
          setAttribute: (key: string, value: string) => attrs.set(key, value),
        },
      };
      // Run the actual browser guard, including its rejected-decode path.
      await runInNewContext(options.addScriptTag[0].content, { document, Promise });
      expect(options.waitForSelector).toMatchObject({
        selector: '[data-iterate-screen-assets="ready"]',
        timeout: 5000,
      });
      if (attrs.get("data-iterate-screen-assets") !== "ready")
        throw new Error("asset readiness timeout");
      return new Uint8Array(png(3, 0));
    });
    const render = worker.setImage({
      device: "waveshare_rlcd_4_2",
      image: { html: '<img src="https://example.com/missing.jpg">' },
    });
    if (loaded) {
      await expect(render).resolves.toMatchObject({ shown: true });
      expect(setImage).toHaveBeenCalledTimes(4);
    } else {
      await expect(render).rejects.toThrow("asset readiness timeout");
      expect(setImage).not.toHaveBeenCalled();
    }
  },
);

test("NOTE4 grayscale uses the same transfer and sends 60000 bytes", async () => {
  const { worker, setImage } = await harness(png(3, 0), { formats: ["mono1", "gray4"] });
  expect(
    await worker.setImage({ device: "zectrix_note4", image: { html: "grey", format: "gray4" } }),
  ).toMatchObject({ shown: true, bytes: 60000, format: "gray4" });
  expect(setImage.mock.calls.every(([chunk]) => chunk.format === "gray4")).toBe(true);
});

test("an unsupported format fails before rendering or transfer", async () => {
  const { worker, quickAction, setImage } = await harness();
  await expect(
    worker.setImage({ device: "waveshare_rlcd_4_2", image: { html: "x", format: "rgb565" } }),
  ).rejects.toThrow("does not support");
  expect(quickAction).not.toHaveBeenCalled();
  expect(setImage).not.toHaveBeenCalled();
});

test("an e-paper upload returns once the chunk that completes the frame is answered", async () => {
  const { worker, setImage } = await harness();
  let refreshed = (_acknowledged: number) => {};
  setImage.mockImplementation(async (chunk: any) => {
    const acknowledged = chunk.offset + Buffer.from(chunk.data, "base64").length;
    if (acknowledged < 15000) return acknowledged;
    return new Promise((resolve) => (refreshed = resolve));
  });
  let settled = false;
  const shown = worker
    .setImage({ device: "zectrix_note4", image: { html: "x" } })
    .finally(() => (settled = true));
  await vi.waitFor(() => expect(setImage).toHaveBeenCalledTimes(4));
  expect(settled).toBe(false);
  refreshed(15000);
  expect(await shown).toMatchObject({ shown: true, bytes: 15000 });
});

test("a failed refresh never reports shown", async () => {
  const { worker, setImage } = await harness();
  setImage.mockImplementation(async (chunk: any) => {
    const acknowledged = chunk.offset + Buffer.from(chunk.data, "base64").length;
    if (acknowledged < 15000) return acknowledged;
    throw new Error("screen refresh failed");
  });
  await expect(worker.setImage({ device: "zectrix_note4", image: { html: "x" } })).rejects.toThrow(
    "screen refresh failed",
  );
});

test("an abandoned refresh times out", async () => {
  const { worker, setImage } = await harness(png(3, 0), { refreshTimeoutMs: 1 });
  setImage.mockImplementation(async (chunk: any) => {
    const acknowledged = chunk.offset + Buffer.from(chunk.data, "base64").length;
    if (acknowledged < 15000) return acknowledged;
    return new Promise(() => {});
  });
  await expect(worker.setImage({ device: "zectrix_note4", image: { html: "x" } })).rejects.toThrow(
    "timed out",
  );
});

let voiceWorker: Promise<any> | undefined;

/**
 * Deployed, `iterate/sdk` links to the platform's SDK build. Supply just the
 * IterateConfigEntrypoint environment here and exercise the actual bundled worker, built
 * once per file on first use.
 */
function loadVoiceWorker(): Promise<any> {
  // The SDK's own itx-scope.ts, found as core/os/scripts/build.ts finds loaded-worker.ts.
  const itxScopeModule = join(
    dirname(createRequire(import.meta.url).resolve("iterate/sdk")),
    "itx-scope.ts",
  );
  voiceWorker ||= (async () => {
    const bundle = await build({
      entryPoints: [new URL("./worker.ts", import.meta.url).pathname],
      bundle: true,
      write: false,
      format: "esm",
      platform: "node",
      loader: { ".md": "text" },
      plugins: [
        {
          name: "sdk-runtime",
          setup(builder) {
            builder.onResolve({ filter: /^iterate\/sdk$/ }, () => ({
              path: "processor",
              namespace: "test-runtime",
            }));
            // The SDK's real `itxScope` (node-safe), so the rows run the worker's reach through
            // the same recording proxy and release as a deployed config worker.
            builder.onLoad({ filter: /.*/, namespace: "test-runtime" }, () => ({
              contents: [
                `import { itxScope } from ${JSON.stringify(itxScopeModule)};`,
                // `callerPath` as the platform hands it: the context the call came from
                "export class IterateConfigEntrypoint { constructor(env, callerPath) { this.env = env; this.callerPath = () => callerPath; } getItx() { return itxScope(this.env.ITX); } }",
              ].join("\n"),
              resolveDir: new URL(".", import.meta.url).pathname,
            }));
          },
        },
      ],
    });
    const { default: VoiceWorker } = await import(
      `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString("base64")}`
    );
    return VoiceWorker;
  })();
  return voiceWorker;
}

function png(channels: 3 | 4, filter: number) {
  const width = 400;
  const height = 300;
  const rows = Buffer.alloc(height * (width * channels + 1));
  for (let y = 0; y < height; y++) {
    const row = y * (width * channels + 1);
    rows[row] = filter;
    // A constant black RGB/opaque RGBA image. PNG filter predictors are zero
    // except alpha: after its first pixel, the selected predictor is 255.
    if (channels === 4) {
      for (let x = 0; x < width; x++) {
        const left = x ? 255 : 0;
        const up = y ? 255 : 0;
        const predictor =
          filter === 0
            ? 0
            : filter === 1
              ? left
              : filter === 2
                ? up
                : filter === 3
                  ? Math.floor((left + up) / 2)
                  : left || up;
        rows[row + 1 + x * channels + 3] = (255 - predictor) & 255;
      }
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length);
    result.write(type, 4, "ascii");
    result.set(data, 8);
    result.writeUInt32BE(crc32(result.subarray(4, data.length + 8)), data.length + 8);
    return result;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = channels === 3 ? 2 : 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function harness(image = png(3, 0), infoOverride = {}, callerPath = "/") {
  const VoiceWorker = await loadVoiceWorker();
  const info = {
    width: 400,
    height: 300,
    formats: ["mono1"],
    preferredFormat: "mono1",
    maxChunkBytes: 4096,
    refreshTimeoutMs: 1000,
    partialRefresh: false,
    ...infoOverride,
  };
  const quickAction = vi.fn(async () => new Uint8Array(image));
  const setImage = vi.fn(async (chunk: any): Promise<unknown> => {
    if (chunk === null) return true;
    return chunk.offset + Buffer.from(chunk.data, "base64").length;
  });
  const screen = { setImage, info: vi.fn(async () => info) };
  /** Each context's appends, a batch per call, as the platform's app wall admits them there. */
  const appended: Record<string, unknown[][]> = {};
  const create = vi.fn(async (_path: string) => ({}));
  const at = vi.fn((_base: string) => ({ create }));
  const itx = {
    agents: { at },
    browser: { quickAction },
    clients: { waveshare_rlcd_4_2: { screen }, zectrix_note4: { screen }, tiny: { screen } },
    cd: vi.fn((path: string) => ({
      append: async (...events: any[]) => {
        for (const event of events) admitLoadedCodeRow(event, path);
        (appended[path] ??= []).push(events);
        return [];
      },
    })),
  };
  return {
    worker: new VoiceWorker({ ITX: { get: () => itx } }, callerPath),
    quickAction,
    setImage,
    appended,
    at,
    create,
  };
}
