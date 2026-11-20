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
  /** The join used a ring's one-time code up: the page opens the microphone (the person pressed
   *  Accept on their device), and with `voiceAgent` invites the voice agent. */
  ring: z.object({ voiceAgent: z.boolean() }).optional(),
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

/** A person's name as the call shows it: a guest is marked. */
const nameOf = (who: CallWho) => (who.kind ? `${who.name} (guest)` : who.name);

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
      .map(([, { who }]) => `${nameOf(who)} joined the call.`),
    ...Object.entries(was)
      .filter(([page]) => !Object.hasOwn(now, page))
      .map(([, { who }]) => `${nameOf(who)} left the call.`),
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
      name: nameOf(who),
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
