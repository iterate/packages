// call-rules.ts — THE PURE RULES OF A CALL IN A PAGE: the call's live state as a page reads it, who
// may press Join, which path a connection took, which ICE servers a page uses, which device a saved
// choice names, how a broken connection is repaired, which simulcast layer a tile takes, and which
// of the voice model's events mean someone spoke. No DOM and no network: the engine
// (call-engine.ts) uses them, and the tests check them.
//
// The call is a facet on an agent's context (a mind's config: `call.ts`, the processor row `call`).
// Its live state is what `useIterateContext(…).liveState.call.value` holds.
import { z } from "zod";

// ── WHAT THE CALL'S METHODS ANSWER (call.ts in a mind's config), parsed ──
/** `join`: the relay's ICE servers and how long they last. */
export const JoinAnswer = z.object({
  iceServers: z.array(z.unknown()).optional(),
  ttlS: z.number().optional(),
  /** The page's admission, as the call took it in. */
  admission: z.string().optional(),
});
/** `signal`: the SFU's description and, for a subscribe, each track's mid. */
export const SignalAnswer = z.object({
  sdp: z.string().optional(),
  tracks: z.array(z.object({ track: z.string(), mid: z.string().nullable() })).optional(),
});
/** `voiceAgent`: the answer to the host's offer, or a refusal the call expects, in words. */
export const VoiceAnswer = z.object({
  sdp: z.string().optional(),
  error: z.string().optional(),
  credit: z.literal(true).optional(),
  noKey: z.literal(true).optional(),
});

/** `delegate`: the delegation's id, or a refusal in words. */
export const DelegateAnswer = z.object({
  delegation: z.string().optional(),
  error: z.string().optional(),
});
/** `transcription`: a short-lived key and the socket's URL, or a refusal the call expects. */
export const TranscriptionAnswer = z.object({
  key: z.string().optional(),
  url: z.string().optional(),
  error: z.string().optional(),
  noKey: z.literal(true).optional(),
  credit: z.literal(true).optional(),
});
export type TranscriptionAnswer = z.infer<typeof TranscriptionAnswer>;

// ── THE CALL'S LIVE STATE ──
const CallWho = z.object({
  actor: z.string(),
  name: z.string(),
  kind: z.literal("guest").optional(),
});
/** A person in a call, as its live state names them: an id, a name, and whether they are a guest.
 *  Never an address. */
export type CallWho = z.infer<typeof CallWho>;
/** THE CALL'S LIVE STATE, parsed: who is in the call, keyed by each page's subscription row, with
 *  a number for each track the page sends (it changes when the track is published anew); the
 *  voice agent and its host page; which secrets the mind has (null until the facet's first read);
 *  the voice agent's last request to the agent; and the share links that let guests in. */
export const CallLive = z.object({
  since: z.number().nullable(),
  inCall: z.record(
    z.string(),
    z.object({ who: CallWho, tracks: z.record(z.string(), z.number()) }),
  ),
  voiceAgent: z
    .object({ host: CallWho, page: z.string(), since: z.number(), until: z.number() })
    .nullable(),
  setup: z.object({ sfu: z.boolean(), turn: z.boolean(), voice: z.boolean() }).nullable(),
  /** The voice agent's last request to the agent of the context, and its answer. */
  delegation: z
    .object({
      id: z.string(),
      status: z.enum(["waiting", "answered", "failed"]),
      answer: z.string().optional(),
      reason: z.string().optional(),
    })
    .nullable()
    .default(null),
  links: z
    .array(
      z.object({
        link: z.string(),
        until: z.number(),
        madeBy: z.string(),
        guests: z.array(z.string()),
      }),
    )
    .default([]),
});
export type CallLive = z.infer<typeof CallLive>;

/** Whether Join can be pressed: unless the mind is known to have no SFU app. A fresh call's setup
 *  is unknown (null) until the facet's first read, and the button waits on nothing that only a
 *  join would fill; the join itself says so in words when the SFU is missing. */
export const joinable = (live: CallLive | undefined) => live?.setup?.sfu !== false;

/** A person's name as the call shows it: a guest is marked, and a page that a member's Mac holds
 *  (the iterate Mac app, `call.publish`) is "<name>'s Mac". */
const nameOf = (who: CallWho, page = "") =>
  page.startsWith(MAC_PAGE) ? `${who.name}'s Mac` : who.kind ? `${who.name} (guest)` : who.name;

/** Who came into the call and who left it from one known live state to the next, the voice agent
 *  too, in words for a screen reader; nothing when either state is not known. */
export function callChanges(before: CallLive | undefined, after: CallLive | undefined) {
  // a state not read yet says nothing of who came or went
  if (!before || !after) return [];
  const was = before.inCall;
  const now = after.inCall;
  const lines = [
    ...Object.entries(now)
      .filter(([page]) => !Object.hasOwn(was, page))
      .map(([page, { who }]) => `${nameOf(who, page)} joined the call.`),
    ...Object.entries(was)
      .filter(([page]) => !Object.hasOwn(now, page))
      .map(([page, { who }]) => `${nameOf(who, page)} left the call.`),
  ];
  if (!before.voiceAgent && after.voiceAgent) lines.push("The voice agent joined the call.");
  if (before.voiceAgent && !after.voiceAgent) lines.push("The voice agent left the call.");
  return lines;
}

/** The call as the engine follows it: the pages in the call by row, each with its tracks' numbers,
 *  and the voice agent's host page. `page` is this page's row. */
export function viewOf(live: CallLive | undefined, page: string) {
  const inCall = live?.inCall || {};
  return {
    // own keys alone: a page named "constructor" or "__proto__" is not in the call by a prototype's
    me: { inCall: Object.hasOwn(inCall, page) },
    call: Object.entries(inCall).map(([peer, { who, tracks }]) => ({
      peer,
      name: nameOf(who, peer),
      tracks,
    })),
    hostPage: live?.voiceAgent?.page || null,
    delegation: live?.delegation || null,
  };
}
export type CallView = ReturnType<typeof viewOf>;

// ── THE PATH: UDP straight to the SFU, or Cloudflare's TURN relay over UDP, TCP or TLS ──
export type Path = "udp-direct" | "turn-udp" | "turn-tcp" | "turn-tls" | "turn" | "tcp-direct";
export const PATH_TEXT: Record<Path, string> = {
  "udp-direct": "UDP direct",
  "turn-udp": "TURN over UDP",
  "turn-tcp": "TURN over TCP",
  "turn-tls": "TURN over TLS",
  turn: "TURN",
  "tcp-direct": "TCP direct",
};
/** The path of a selected candidate pair, from its LOCAL candidate's stats: a relay candidate is
 *  TURN, and `relayProtocol` (else the TURN URL) says how the page reaches the relay. */
export function pathOf(
  local:
    | { candidateType?: string; relayProtocol?: string; url?: string; protocol?: string }
    | undefined,
): Path | null {
  if (!local) return null;
  if (local.candidateType === "relay") {
    const how = String(local.relayProtocol || "").toLowerCase();
    if (how === "udp" || how === "tcp" || how === "tls") return `turn-${how}`;
    const url = String(local.url || "");
    if (/^turns:/i.test(url)) return "turn-tls";
    if (/transport=tcp/i.test(url)) return "turn-tcp";
    return /^turn:/i.test(url) ? "turn-udp" : "turn";
  }
  return local.protocol === "tcp" ? "tcp-direct" : "udp-direct";
}
/** The paths a page uses: UDP to the SFU, or the relay by any transport. */
export const pathAccepted = (path: Path | null | undefined) =>
  path === "udp-direct" || Boolean(path?.startsWith("turn"));
/** No TCP straight to the SFU: every TCP candidate line leaves a description, the page's and the
 *  SFU's. A relay's candidate is UDP (the relay's side), so the TURN path stays whole; a network
 *  that lets only TCP 443 out goes through TURN over TLS on 443. */
export const udpOnly = (sdp: string) =>
  sdp
    .split(/\r?\n/)
    .filter((line) => !(/^a=candidate:/i.test(line) && /\stcp\s/i.test(line)))
    .join("\r\n");

/** Cloudflare's STUN always, and the TURN servers the call's `join` answered for this page. A URL
 *  on port 53 is dropped: browsers block it. The browser's own priorities put UDP first. */
export const STUN: RTCIceServer = { urls: "stun:stun.cloudflare.com:3478" };
const TurnServers = z.array(
  z.object({
    urls: z.unknown().optional(),
    username: z.unknown().optional(),
    credential: z.unknown().optional(),
  }),
);
export function iceServersOf(turn: unknown): RTCIceServer[] {
  const servers = [STUN];
  for (const server of TurnServers.safeParse(turn).data ?? []) {
    const urls = [server.urls ?? []]
      .flat()
      .filter(
        (url): url is string =>
          typeof url === "string" && /^turns?:/i.test(url) && !/:53(\?|$)/.test(url),
      );
    if (!urls.length) continue;
    servers.push({
      urls,
      username: String(server.username ?? ""),
      credential: String(server.credential ?? ""),
    });
  }
  return servers;
}

// ── DEVICES: a saved choice, and the device it names now ──
export type DeviceKind = "mic" | "camera" | "speaker";
const DEVICE_KINDS: Record<DeviceKind, MediaDeviceKind> = {
  mic: "audioinput",
  camera: "videoinput",
  speaker: "audiooutput",
};
type Device = Pick<MediaDeviceInfo, "kind" | "deviceId" | "label">;
const listOf = (devices: readonly Device[], kind: DeviceKind) =>
  devices.filter(
    (d) =>
      d.kind === DEVICE_KINDS[kind] &&
      d.deviceId &&
      !["default", "communications"].includes(d.deviceId),
  );
/** The device a saved choice `{ id, label }` names: by its id, else by its label (an id can change
 *  when a browser forgets the site's permission), else "": the browser's default. */
export function pickDevice(
  devices: readonly Device[],
  kind: DeviceKind,
  saved: { id?: string; label?: string } | null | undefined,
) {
  if (!saved?.id && !saved?.label) return "";
  const list = listOf(devices, kind);
  return (
    list.find((d) => d.deviceId === saved.id)?.deviceId ??
    (saved.label ? list.find((d) => d.label === saved.label)?.deviceId : undefined) ??
    ""
  );
}
/** A picker's choices: the browser's default first, then each device. */
export function deviceOptions(devices: readonly Device[], kind: DeviceKind) {
  const word = { mic: "Microphone", camera: "Camera", speaker: "Speaker" }[kind];
  return [
    { id: "", label: "The browser's default" },
    ...listOf(devices, kind).map((d, i) => ({
      id: d.deviceId,
      label: d.label || `${word} ${i + 1}`,
    })),
  ];
}

// ── REPAIR: a connection that failed, or stayed disconnected, is made anew a bounded number of times ──
export const REPAIR = { waitsMs: [1_000, 2_000, 4_000, 8_000, 16_000], disconnectedMs: 5_000 };
/** What a change of state asks for: "repair", "wait" (disconnected often heals by itself), or
 *  "none". A connection that never formed is the join's own failure. */
export function repairNeed(state: RTCPeerConnectionState, wasConnected: boolean) {
  if (!wasConnected) return "none";
  if (state === "failed") return "repair";
  return state === "disconnected" ? "wait" : "none";
}
/** Wait, then try, once per wait of `waitsMs`. A connection that came back by itself before the
 *  first try (`healed`) ends it; `stale` says the call ended. Answers `{ outcome, tries, reason }`. */
export async function repairLoop({
  attempt,
  sleep,
  healed = () => false,
  stale = () => false,
  step = () => {},
  waitsMs = REPAIR.waitsMs,
}: {
  attempt: (tries: number) => Promise<unknown>;
  sleep: (ms: number) => Promise<unknown>;
  healed?: () => boolean;
  stale?: () => boolean;
  step?: (step: { step: "waiting" | "trying"; attempt: number }) => void;
  waitsMs?: readonly number[];
}): Promise<{
  outcome: "succeeded" | "recovered" | "gave-up" | "stopped";
  tries: number;
  reason: string;
}> {
  let tries = 0;
  let reason = "";
  for (const wait of waitsMs) {
    step({ step: "waiting", attempt: tries + 1 });
    await sleep(wait);
    if (stale()) return { outcome: "stopped", tries, reason };
    if (!tries && healed()) return { outcome: "recovered", tries, reason };
    tries += 1;
    step({ step: "trying", attempt: tries });
    try {
      await attempt(tries);
      return { outcome: stale() ? "stopped" : "succeeded", tries, reason };
    } catch (error) {
      if (stale()) return { outcome: "stopped", tries, reason };
      reason = error instanceof Error ? error.message : String(error);
    }
  }
  return { outcome: "gave-up", tries, reason };
}

// ── SIMULCAST: the camera's layers, and the one a tile takes ──
export type Rid = "f" | "h" | "q";
const RIDS: readonly Rid[] = ["f", "h", "q"];
/** The layer an encoding's RID names, or undefined for an encoding with none of ours. */
export const ridOf = (rid: string | undefined) => RIDS.find((one) => one === rid);
/** Full, half and quarter width; the RIDs' ASCII order is their priority for the SFU. */
const LAYER_WIDTH: Record<Rid, number> = { f: 1280, h: 640, q: 320 };
const LAYER_BITRATE: Record<Rid, number> = { f: 900_000, h: 400_000, q: 150_000 };
/** How much a camera `width` pixels wide is scaled down for a layer: to its width, never up. */
export const scaleFor = (rid: Rid, width: number | undefined) => {
  const w = Math.max(1, Number(width) || LAYER_WIDTH.f);
  return w / Math.min(w, LAYER_WIDTH[rid]);
};
/** The encodings for this camera: each layer at its own width; a layer that would repeat a smaller
 *  one (a narrow camera) is left out, and a subscriber that asks for it gets the next one. */
export function cameraLayers(width: number | undefined): RTCRtpEncodingParameters[] {
  const w = Math.max(1, Number(width) || LAYER_WIDTH.f);
  const kept: RTCRtpEncodingParameters[] = [];
  for (const rid of ["q", "h", "f"] as const) {
    const scale = scaleFor(rid, w);
    if (
      kept.some(
        (layer) => Math.round(w / (layer.scaleResolutionDownBy ?? 1)) === Math.round(w / scale),
      )
    )
      continue;
    kept.unshift({ rid, scaleResolutionDownBy: scale, maxBitrate: LAYER_BITRATE[rid] });
  }
  return kept;
}
/** The smallest layer at least nearly as wide as the tile on the screen, in device pixels. */
export function layerFor(cssWidth: number, pixelRatio = 1): Rid {
  const px = Math.max(0, Number(cssWidth) || 0) * Math.max(1, Number(pixelRatio) || 1);
  if (px > LAYER_WIDTH.h * 1.15) return "f";
  return px > LAYER_WIDTH.q * 1.15 ? "h" : "q";
}
/** The layer a new subscription asks for, before its tile is drawn. */
export const FIRST_LAYER: Rid = "h";

// ── THE VOICE AGENT'S IDLE CLOCK ──
/** Events of GPT-Live's data channel that mean someone spoke: a person's words as the model heard
 *  them, the model's own words, and a voice detector's start or end of speech. */
const SPEECH = new Set([
  "session.input_transcript.delta",
  "session.output_transcript.delta",
  "input_audio_buffer.speech_started",
  "input_audio_buffer.speech_stopped",
]);
/** Whether `event` says that someone, a person or the agent, spoke: the host's page ends the agent
 *  after five minutes with none. Any other event with text in `delta` counts too. */
export const heardSpeech = (event: { type?: unknown; delta?: unknown } | null | undefined) =>
  SPEECH.has(String(event?.type)) || typeof event?.delta === "string";

// ── CAPTIONS: which of the microphone's audio goes to the transcription model ──
// The model (OpenAI's gpt-live-transcribe) bills each minute of audio SENT, and its session has no
// voice detection, so the page decides what is speech:
// - A TURN STARTS when the level passes the threshold for two frames in a row; the 300 ms before
//   the first loud frame go too, so a word's start is not cut off.
// - A TURN ENDS after 700 ms below the threshold: that audio is sent, then committed.
// - A long turn is committed at its first dip of 250 ms after 25 s, or at 40 s flat, and the next
//   turn starts at once.
// - Nothing is sent while no turn is open. A muted microphone is a level of 0: an open turn ends,
//   and no new one starts.
export const TURN = {
  threshold: 0.012,
  startFrames: 2,
  prerollMs: 300,
  endMs: 700,
  longMs: 25_000,
  dipMs: 250,
  maxMs: 40_000,
};
/** One frame of the microphone: its level, its length, and what is sent of it. */
export type Frame<T> = { rms: number; ms: number; data: T };
export type TurnAction<T> =
  | { type: "start" }
  | { type: "send"; frames: Frame<T>[] }
  | { type: "commit" };
const lengthOf = (frames: readonly Frame<unknown>[]) =>
  frames.reduce((total, frame) => total + frame.ms, 0);

/** The voice detection, one frame at a time: `push(frame)` answers what to do, in order. A commit
 *  always follows at least one send of its own turn. */
export class TurnDetector<T> {
  #ring: Frame<T>[] = [];
  #loud: Frame<T>[] = [];
  #open = false;
  #turnMs = 0;
  #quietMs = 0;

  push(frame: Frame<T>): TurnAction<T>[] {
    const loud = frame.rms >= TURN.threshold;
    if (!this.#open) {
      if (!loud) {
        this.#ring.push(...this.#loud, frame);
        this.#loud = [];
        while (this.#ring.length && lengthOf(this.#ring) - this.#ring[0]!.ms >= TURN.prerollMs)
          this.#ring.shift();
        return [];
      }
      this.#loud.push(frame);
      if (this.#loud.length < TURN.startFrames) return [];
      const frames = [...this.#ring, ...this.#loud];
      this.#ring = [];
      this.#loud = [];
      this.#open = true;
      this.#turnMs = lengthOf(frames);
      this.#quietMs = 0;
      return [{ type: "start" }, { type: "send", frames }];
    }
    this.#turnMs += frame.ms;
    this.#quietMs = loud ? 0 : this.#quietMs + frame.ms;
    const out: TurnAction<T>[] = [{ type: "send", frames: [frame] }];
    if (
      this.#quietMs >= TURN.endMs ||
      (this.#turnMs >= TURN.longMs && this.#quietMs >= TURN.dipMs)
    ) {
      this.#open = false;
      out.push({ type: "commit" });
    } else if (this.#turnMs >= TURN.maxMs) {
      this.#turnMs = 0;
      this.#quietMs = 0;
      out.push({ type: "commit" }, { type: "start" });
    }
    return out;
  }

  /** Forget everything, an open turn too: after a leave or a lost socket. */
  reset() {
    this.#ring = [];
    this.#loud = [];
    this.#open = false;
    this.#turnMs = 0;
    this.#quietMs = 0;
  }
}

/** The root mean square of samples: the level the detection reads. */
export function rmsOf(samples: Float32Array) {
  let total = 0;
  for (const sample of samples) total += sample * sample;
  return samples.length ? Math.sqrt(total / samples.length) : 0;
}

/** Float samples (-1 to 1) as the model takes them: mono PCM16, little-endian, in base64. */
export function pcm16Base64(samples: Float32Array) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, at) => {
    const s = Math.max(-1, Math.min(1, sample));
    view.setInt16(at * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  });
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

// ── A MEMBER'S MAC: a camera or a screen from the iterate Mac app, in the device picker ──
// A member who lends a Mac to the mind (the iterate Mac app, `iterate provide` as `itx.<name>`)
// may send its camera or one of its screens into a call from the picker: the page asks the lend
// (`call.publish`), and the Mac joins the call as a page of its own, `mac-call-<name>-<id>`, which
// every page draws as "<the member>'s Mac". Without such a lend the picker is as before.

/** The prefix of a page that a Mac holds in a call (the Mac app's bridge/call.mjs `PAGE_PREFIX`). */
export const MAC_PAGE = "mac-call-";

/** One source a Mac offers a call: a screen (`screen:<display>`) or its camera. `id` is the
 *  picker's value. */
export type MacSource = {
  id: string;
  lend: string;
  source: string;
  kind: "camera" | "screen";
  label: string;
};
/** The kind of event only a Mac app's bridge writes on its device's context. */
const MAC_EVENT = "device/presence-changed";
/** A lend's name, as `itx.rpcStubs.list()` names a live lend: `itx.<name>`, dotted. */
const LEND = /^itx\.([A-Za-z][\w-]*(?:\.[A-Za-z][\w-]*){0,3})$/;

/** The catalog's row of a context, as `contexts.list` answers it: its event types with counts. */
type DeviceRow = {
  path: string;
  eventCount?: number;
  eventTypes?: Partial<Record<string, number>>;
};
/** THE MACS LENT NOW: a live lend `itx.<name>` with a device context `/devices/<name>` that a Mac
 *  app writes (its presence). Whose each is, is `macOwner`'s. */
export function liveMacs(stubs: readonly string[], devices: readonly DeviceRow[]) {
  const written = new Map(devices.map((row) => [row.path, row]));
  return stubs.flatMap((stub) => {
    const name = LEND.exec(stub)?.[1];
    const row = name ? written.get(`/devices/${name}`) : undefined;
    return name && row?.eventTypes?.[MAC_EVENT]
      ? [{ lend: name, path: row.path, events: row.eventCount ?? 0 }]
      : [];
  });
}

/** WHOSE A MAC IS: the actor who wrote its newest `device/…` event, the Mac app's bridge, which
 *  writes as the person who lent the Mac (`events`: a page of the context's newest events). */
export function macOwner(events: readonly unknown[]) {
  for (const event of [...events].reverse()) {
    const parsed = WrittenEvent.safeParse(event);
    if (parsed.success && parsed.data.type.startsWith("device/"))
      return parsed.data.source?.principal?.actor;
  }
  return undefined;
}
const WrittenEvent = z.object({
  type: z.string(),
  source: z.object({ principal: z.object({ actor: z.string() }).optional() }).optional(),
});

/** A Mac's own state (`itx.<name>.state()`): each thing and the owner's choice for it. */
const MacState = z.object({
  things: z.array(
    z.object({
      kind: z.string(),
      name: z.string(),
      sharing: z.string(),
      permitted: z.boolean().optional(),
      display: z.number().int().nullable().optional(),
    }),
  ),
});

/** WHAT A MAC OFFERS A CALL: each display and its camera that its owner has not set to Off and
 *  macOS allows (an Ask asks the owner at the choice). Nothing when its state does not parse. */
export function macSources(lend: string, state: unknown): MacSource[] {
  const parsed = MacState.safeParse(state);
  if (!parsed.success) return [];
  const on = parsed.data.things.filter(
    (thing) => thing.sharing !== "off" && thing.permitted !== false,
  );
  const mac = `Your Mac “${lend}” (iterate app)`;
  const screens = on.flatMap((thing) =>
    thing.kind === "screen" && typeof thing.display === "number"
      ? [
          {
            kind: "screen" as const,
            source: `screen:${thing.display}`,
            label: `${mac}: ${thing.name}`,
          },
        ]
      : [],
  );
  const camera = on.find((thing) => thing.kind === "camera");
  const cameras = camera
    ? [{ kind: "camera" as const, source: "camera", label: `${mac}: ${camera.name}` }]
    : [];
  return [...cameras, ...screens].map((one) => ({ ...one, lend, id: `mac:${lend}:${one.source}` }));
}

/** The itx expression of a call of a lend's method from an agent's context: the lend is the root's. */
export const lendCall = (lend: string, method: string, input: unknown) => [
  "itx",
  ["cd", "/"],
  ...lend.split("."),
  "call",
  [method, input],
];

/** The itx expression of a call of a lend's method by its dotted path, from an agent's context:
 *  `lendMethod("jonas.mac", "control.input", input)` is `itx.jonas.mac.control.input(input)`. */
export const lendMethod = (lend: string, method: string, ...args: unknown[]) => {
  const names = method.split(".");
  return ["itx", ["cd", "/"], ...lend.split("."), ...names.slice(0, -1), [names.at(-1), ...args]];
};

// ── DRIVE: a person in the call drives a lent Mac or a lent Chrome tab ──
// A device that may be driven says so on its own context: the iterate Mac app appends
// `device/control-configured { kind: "mac", lend, control: "ask" | "shared", displays }` on
// `/devices/<name>` (and `control: null` when that ends). The page lists each such Mac whose lend
// is live now, with the person's name. A lent Chrome (`itx.chrome.<person>.<id>`, the iterate
// browser extension) may be driven in each tab of its tab group: the group is its owner's choice.
// No list of devices is in a config file.

/** The fact of a Mac that may be driven (the Mac app's ControlOffer.swift). */
export const CONTROL_FACT = "device/control-configured";
const ControlFact = z.object({
  kind: z.string(),
  lend: z.string(),
  control: z.enum(["ask", "shared"]).nullable(),
  displays: z
    .array(z.object({ display: z.number().int(), name: z.string(), screen: z.string() }))
    .optional(),
  why: z.string().optional(),
});
export type ControlFact = z.infer<typeof ControlFact>;
const WrittenFact = z.object({
  type: z.string(),
  offset: z.number().optional(),
  payload: z.unknown(),
  source: z
    .object({
      principal: z
        .object({ actor: z.string().optional(), email: z.string().optional() })
        .optional(),
    })
    .optional(),
});
/** The newest offer in a page of a device context's events (oldest first), and who wrote it (the
 *  Mac app writes as the person who lent the Mac). Undefined when the page has none. */
export function newestOffer(events: readonly unknown[]) {
  for (const event of [...events].reverse()) {
    const written = WrittenFact.safeParse(event);
    if (!written.success || written.data.type !== CONTROL_FACT) continue;
    const fact = ControlFact.safeParse(written.data.payload);
    if (!fact.success) continue;
    const principal = written.data.source?.principal;
    return { offset: written.data.offset ?? 0, fact: fact.data, owner: principal?.email || "" };
  }
  return undefined;
}

/** The offer of a Mac read from its own `state()`, for a Mac whose newest fact is too far back in
 *  its log to read: Control this Mac's choice and each display that is not Off, as the fact says
 *  them. Undefined when the state does not parse. */
export function offerFromState(lend: string, state: unknown): ControlFact | undefined {
  const parsed = MacState.safeParse(state);
  if (!parsed.success) return undefined;
  const control = parsed.data.things.find((thing) => thing.kind === "control");
  const on = (sharing: string) => sharing === "ask" || sharing === "shared";
  const displays = parsed.data.things.flatMap((thing) =>
    thing.kind === "screen" && typeof thing.display === "number" && on(thing.sharing)
      ? [{ display: thing.display, name: thing.name, screen: thing.sharing }]
      : [],
  );
  const offered = control && on(control.sharing) && control.permitted !== false && displays.length;
  return offered
    ? { kind: "mac", lend, control: control.sharing as "ask" | "shared", displays }
    : { kind: "mac", lend, control: null };
}

/** Whose a device is, by address: who wrote its newest `device/…` event ("" when none says). */
export function newestOwner(events: readonly unknown[]) {
  for (const event of [...events].reverse()) {
    const written = WrittenFact.safeParse(event);
    if (written.success && written.data.type.startsWith("device/"))
      return written.data.source?.principal?.email || "";
  }
  return "";
}

/** A person's first name as a device's label says it: "jonas@nustom.com" is "Jonas". */
export const firstName = (email: string) => {
  const name = email.split("@", 1)[0]?.split(/[._+-]/, 1)[0] ?? "";
  return name ? name[0]!.toUpperCase() + name.slice(1) : "";
};
/** A Mac's name in the Drive menu: "Jonas's Mac" when its lend begins with its owner's name
 *  (`jonas.mac`), else its lend's first word (`zaktop.macApp` is "zaktop"). */
export function macLabel(lend: string, owner: string) {
  const first = lend.split(".", 1)[0]!;
  const name = firstName(owner);
  return name && first.toLowerCase() === name.toLowerCase() ? `${name}'s Mac` : first;
}

/** One thing the Drive menu offers: a display of a Mac, or a tab of a lent Chrome. */
export type DriveTarget = {
  id: string;
  kind: "mac" | "browser";
  lend: string;
  label: string;
  /** A Mac's display (`control.start({ display })`, `call.publish`'s `screen:<n>`). */
  display?: number;
  /** A Chrome's tab. */
  tab?: number;
  /** A Mac's Control this Mac: "ask" asks its owner at the start. */
  control?: "ask" | "shared";
};
/** THE MACS THAT MAY BE DRIVEN NOW: each live lend `itx.<lend>` whose newest fact offers it, one
 *  entry for each display it offers ("Jonas's Mac", or "Jonas's Mac: <display>" when it offers
 *  several). `offers`: the newest offer of each lend, read from its context. */
export function macTargets(
  stubs: readonly string[],
  offers: ReadonlyMap<string, { fact: ControlFact; owner: string }>,
): DriveTarget[] {
  const live = new Set(stubs.flatMap((stub) => LEND.exec(stub)?.[1] ?? []));
  return [...offers].flatMap(([lend, { fact, owner }]) => {
    if (!live.has(lend) || !fact.control || fact.kind !== "mac") return [];
    const label = macLabel(lend, owner);
    const displays = fact.displays || [];
    return displays.map((one) => ({
      id: `drive:${lend}:${one.display}`,
      kind: "mac" as const,
      lend,
      label: displays.length > 1 ? `${label}: ${one.name}` : label,
      display: one.display,
      control: fact.control!,
    }));
  });
}
/** A lent Chrome's name, as the extension lends it: `chrome.<person>.<browser>`. */
const CHROME = /^itx\.(chrome\.([A-Za-z0-9-]+)\.([A-Za-z0-9-]+))$/;
/** The lent Chromes now: `{ lend, person, browser }` for each live `itx.chrome.<person>.<id>`. */
export const liveChromes = (stubs: readonly string[]) =>
  stubs.flatMap((stub) => {
    const match = CHROME.exec(stub);
    return match ? [{ lend: match[1]!, person: match[2]!, browser: match[3]! }] : [];
  });
const ChromeTabs = z.array(
  z.object({ id: z.number().int(), url: z.string().optional(), title: z.string().optional() }),
);
/** THE CHROME TABS THAT MAY BE DRIVEN: each tab in a lent Chrome's group ("Jonas's Chrome: <the
 *  tab's title>"). A person with two Chromes lent has each named by its browser too. `tabs`: each
 *  Chrome's `tabs()` answer, by its lend. */
export function browserTargets(
  chromes: readonly { lend: string; person: string; browser: string }[],
  tabs: ReadonlyMap<string, unknown>,
): DriveTarget[] {
  return chromes.flatMap((chrome) => {
    const list = ChromeTabs.safeParse(tabs.get(chrome.lend));
    if (!list.success) return [];
    const twin = chromes.filter((one) => one.person === chrome.person).length > 1;
    const name = `${firstName(chrome.person)}'s Chrome${twin ? ` (${chrome.browser})` : ""}`;
    return list.data.map((tab) => ({
      id: `drive:${chrome.lend}:tab:${tab.id}`,
      kind: "browser" as const,
      lend: chrome.lend,
      label: `${name}: ${(tab.title || tab.url || "a tab").slice(0, 60)}`,
      tab: tab.id,
    }));
  });
}

/** The page of a Mac's picture in the call (bridge/call.mjs `pageOf`): its track is `<page>:screen`. */
export const macCallPage = (lend: string, publication: string) =>
  `${MAC_PAGE}${lend.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80)}-${publication.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12)}`;
const Publications = z.object({
  publications: z.array(
    z.object({ publication: z.string(), context: z.string(), source: z.string() }),
  ),
});
/** The publication of `source` into the call on `context`, in a Mac's `call.publish` or
 *  `call.state` answer. */
export function publicationOf(answer: unknown, context: string, source: string) {
  const parsed = Publications.safeParse(answer);
  return parsed.success
    ? parsed.data.publications.find((one) => one.context === context && one.source === source)
        ?.publication
    : undefined;
}

// ── DRIVE: the input, from the tile to the device ──
/** One event of a Mac's `control.input` (the Mac app's README, "Control"). x and y are 0–1 on the
 *  display, from its top left. A browser's drive maps the same events to CDP (`cdpInput`). */
export type DriveEvent =
  | { t: "move"; x: number; y: number }
  | { t: "down" | "up"; x: number; y: number; button: 0 | 1 | 2; clicks?: number; mods?: Mod[] }
  | { t: "scroll"; dx: number; dy: number; x?: number; y?: number }
  | { t: "key"; code: string; down: boolean; mods?: Mod[]; key?: string }
  | { t: "text"; text: string };
type Mod = "shift" | "ctrl" | "alt" | "meta";

/** Where the picture is in its element: a video or an image drawn with `object-fit: contain` in a
 *  box. `box` is the element's box on the page, `width` and `height` the picture's own size. */
export function pictureRect(
  box: { left: number; top: number; width: number; height: number },
  width: number,
  height: number,
) {
  if (!width || !height || !box.width || !box.height) return box;
  const scale = Math.min(box.width / width, box.height / height);
  const w = width * scale;
  const h = height * scale;
  return {
    left: box.left + (box.width - w) / 2,
    top: box.top + (box.height - h) / 2,
    width: w,
    height: h,
  };
}
/** A point of the page as 0–1 on the picture (clamped: a drag out of the picture stays on its
 *  edge), and whether it is inside it. */
export function pointOn(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
) {
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  const clamp = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return { x: clamp(x), y: clamp(y), inside: x >= 0 && x <= 1 && y >= 0 && y <= 1 };
}

/** The driver's browser runs on a Mac (or an iPad): its Command is the Mac's Command. */
export const onMac = (platform: string) => /Mac|iPhone|iPad|iPod/i.test(platform);
/** The modifiers held, as the Mac takes them. A driver not on a Mac presses Ctrl for a shortcut
 *  (Ctrl+C), which is Command on a Mac: `ctrlIsCommand` maps it. */
export function modsOf(
  event: { shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean },
  ctrlIsCommand: boolean,
): Mod[] {
  const mods: Mod[] = [];
  if (event.shiftKey) mods.push("shift");
  if (event.ctrlKey) mods.push(ctrlIsCommand ? "meta" : "ctrl");
  if (event.altKey) mods.push("alt");
  if (event.metaKey && !(ctrlIsCommand && event.ctrlKey))
    mods.push(ctrlIsCommand ? "ctrl" : "meta");
  return mods;
}
const SWAP: Record<string, string> = {
  ControlLeft: "MetaLeft",
  ControlRight: "MetaRight",
  MetaLeft: "ControlLeft",
  MetaRight: "ControlRight",
};
/** A key of the driver's keyboard as the events of a drive. A printable character with no Ctrl,
 *  Alt or Command goes as `text`, in the driver's own layout ("ü" is "ü" on any Mac); every other
 *  key goes as the physical key (`code`), down and up, with its modifiers: shortcuts, arrows,
 *  Return. A key that only makes a printable character sends nothing on its release. */
export function keyEvents(
  event: {
    type: "keydown" | "keyup";
    code: string;
    key: string;
    shiftKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
    isComposing?: boolean;
  },
  ctrlIsCommand: boolean,
): DriveEvent[] {
  if (event.isComposing || !event.code) return [];
  const printable =
    [...event.key].length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
  if (printable) return event.type === "keydown" ? [{ t: "text", text: event.key }] : [];
  const code = ctrlIsCommand ? (SWAP[event.code] ?? event.code) : event.code;
  const mods = modsOf(event, ctrlIsCommand);
  return [
    {
      t: "key",
      code,
      down: event.type === "keydown",
      key: event.key,
      ...(mods.length > 0 && { mods }),
    },
  ];
}

/** ONE BATCH IN FLIGHT: events wait while a batch is on its way, and go together as the next one.
 *  Consecutive moves are one, the last (the Mac folds them too). Text in a row is one text, at most
 *  2,000 characters (the Mac's limit). */
export function nextBatch(waiting: readonly DriveEvent[]): DriveEvent[] {
  const batch: DriveEvent[] = [];
  for (const event of waiting) {
    const last = batch.at(-1);
    if (event.t === "move" && last?.t === "move") batch[batch.length - 1] = event;
    else if (
      event.t === "text" &&
      last?.t === "text" &&
      last.text.length + event.text.length <= 2000
    )
      batch[batch.length - 1] = { t: "text", text: last.text + event.text };
    else batch.push(event);
  }
  return batch;
}

/** A browser tab's viewport, in CSS pixels (CDP `Page.getLayoutMetrics`). */
export type Viewport = { width: number; height: number };
const CDP_BUTTON = ["left", "middle", "right"] as const;
const CDP_MODS: Record<Mod, number> = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
const cdpMods = (mods: Mod[] = []) => mods.reduce((sum, mod) => sum | CDP_MODS[mod], 0);
/** One drive event as the CDP commands of a Chrome tab (`Input.dispatch*`), at the tab's CSS
 *  pixels. `held`: the button held now (a move while it is held is a drag). */
export function cdpInput(
  event: DriveEvent,
  viewport: Viewport,
  held: { button: 0 | 1 | 2 | null; x: number; y: number },
): [string, Record<string, unknown>][] {
  const at = (x: number, y: number) => ({
    x: Math.round(x * viewport.width),
    y: Math.round(y * viewport.height),
  });
  switch (event.t) {
    case "move":
      held.x = event.x;
      held.y = event.y;
      return [
        [
          "Input.dispatchMouseEvent",
          {
            type: "mouseMoved",
            ...at(event.x, event.y),
            button: held.button === null ? "none" : CDP_BUTTON[held.button],
            buttons: held.button === null ? 0 : [1, 4, 2][held.button],
          },
        ],
      ];
    case "down":
    case "up":
      held.button = event.t === "down" ? event.button : null;
      return [
        [
          "Input.dispatchMouseEvent",
          {
            type: event.t === "down" ? "mousePressed" : "mouseReleased",
            ...at(event.x, event.y),
            button: CDP_BUTTON[event.button],
            clickCount: event.clicks ?? 1,
            modifiers: cdpMods(event.mods),
          },
        ],
      ];
    case "scroll":
      return [
        [
          "Input.dispatchMouseEvent",
          {
            type: "mouseWheel",
            ...at(event.x ?? held.x, event.y ?? held.y),
            deltaX: event.dx,
            deltaY: event.dy,
          },
        ],
      ];
    case "text":
      return [["Input.insertText", { text: event.text }]];
    case "key":
      return [
        [
          "Input.dispatchKeyEvent",
          {
            type: event.down ? "rawKeyDown" : "keyUp",
            code: event.code,
            key: event.key || "",
            windowsVirtualKeyCode: VIRTUAL_KEYS[event.code] ?? 0,
            modifiers: cdpMods(event.mods),
          },
        ],
      ];
  }
}
/** The Windows key codes CDP needs for a key that types nothing (Chrome acts on them). */
const VIRTUAL_KEYS: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  NumpadEnter: 13,
  Escape: 27,
  Space: 32,
  PageUp: 33,
  PageDown: 34,
  End: 35,
  Home: 36,
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
  Delete: 46,
  ...Object.fromEntries(
    Array.from({ length: 26 }, (_, i) => [`Key${String.fromCharCode(65 + i)}`, 65 + i]),
  ),
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`Digit${i}`, 48 + i])),
};
