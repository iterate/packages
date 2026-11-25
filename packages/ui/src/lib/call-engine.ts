// call-engine.ts — A CALL IN THIS TAB, and the hook that holds it for a page (`useCall`). One
// RTCPeerConnection sends this page's microphone, camera and screen to Cloudflare's SFU, another
// receives everyone else's. The call facet on the agent's context (a mind's config: `call.ts`)
// makes every SFU call; the page reaches it over the session it already holds, a member's context
// or a guest's view, by one call of one method (`invoke(["itx", "facets", ["get", "call"], …])`).
// It names other pages by their subscription rows alone, and never sees an SFU session id.
//
// - THE NETWORK: UDP first; Cloudflare's TURN relay (UDP, TCP, and TLS on 443) when UDP is blocked.
//   The call's `join` hands this page short-lived TURN credentials, and again before they end.
//   TCP candidates straight to the SFU are taken out of every description (call-rules.ts).
// - DEVICES: a picker for the microphone, the camera and the speaker, kept in this browser. In a
//   call a new microphone or camera replaces the track on its sender: no new connection.
// - REPAIR: a connection that fails, never connects, or stays disconnected for 5 s, is made anew,
//   five tries at most; then the page joins the call afresh, once for each Join the person pressed.
//   When that does not help either, the page leaves the call and says so.
// - ONE CALL, ONE SCOPE (`callScope`): what a call starts (a publish, a subscribe, a device it
//   opens) runs in that call's scope and stops with it, and the next call never waits on it.
// - SIMULCAST: the camera goes up in three layers; each tile takes the layer that fits its size.
// - CAPTURE STARTS ONLY BY THE PERSON'S OWN PRESS: a page that joins again by itself keeps the mute,
//   and its camera and screen stay off until the person turns them on.
// - CAPTIONS: this page transcribes its own microphone (OpenAI's gpt-live-transcribe, a socket with
//   a one-minute key that the call's `transcription` makes) and hands each finished line to the
//   call's `said`, which tells the agent. It runs only while this page is in the call and not
//   muted (a mute closes the session), and only speech is sent (call-rules.ts `TurnDetector`).
//   Each method carries the call's admission.
// - THE DELEGATION: the voice model's one way out is the agent of the context. Its host tab carries
//   the model's request to the call's `delegate`, and the answer, from the call's live state, back
//   to the model to say.
// - A MEMBER'S MAC: when the member lends a Mac to the mind (the iterate Mac app), the device
//   picker also offers its camera and its screens (call-rules.ts `liveMacs`, `macSources`). A choice
//   asks the Mac (`call.publish` of its lend), which joins the call as a page of its own and sends
//   the picture from its own connection; a browser device chosen again, the page's own camera or
//   screen turned on, or a Leave ends it (`call.unpublish`). The page that asked leaving the call
//   ends it on the Mac's side too.
// - THE VOICE AGENT: the member who invites it hosts it in their tab, which opens GPT-Live over
//   WebRTC with a session the call made. It hears a mix of the host's microphone and everyone the
//   host hears, and its voice is published into the call as the host's track `ai`.
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { errorCode } from "iterate/lib";
import {
  CallLive,
  cameraLayers,
  type CallView,
  DelegateAnswer,
  type DeviceKind,
  deviceOptions,
  FIRST_LAYER,
  heardSpeech,
  iceServersOf,
  lendCall,
  liveMacs,
  macOwner,
  type MacSource,
  macSources,
  JoinAnswer,
  layerFor,
  type Path,
  PATH_TEXT,
  pathAccepted,
  pathOf,
  pickDevice,
  REPAIR,
  pcm16Base64,
  repairLoop,
  repairNeed,
  ridOf,
  rmsOf,
  type Rid,
  scaleFor,
  SignalAnswer,
  TranscriptionAnswer,
  STUN,
  TurnDetector,
  udpOnly,
  viewOf,
  VoiceAnswer,
} from "#/lib/call-rules.ts";

const CONNECT_TIMEOUT_MS = 12_000;
/** THE MICROPHONE'S SAMPLES for the captions: an AudioWorklet that posts each block of mono
 *  samples (the channels averaged) to the page. A module of its own, loaded from a Blob. */
const TAP = `class CallTap extends AudioWorkletProcessor {
  process(inputs) {
    const channels = inputs[0];
    if (channels && channels.length) {
      const block = new Float32Array(channels[0].length);
      for (const channel of channels) for (let i = 0; i < block.length; i++) block[i] += channel[i] / channels.length;
      this.port.postMessage(block, [block.buffer]);
    }
    return true;
  }
}
registerProcessor("call-tap", CallTap);`;
const MIC = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
// the camera at 1280×720 when it can: the full layer of its simulcast
const CAMERA = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } };
const DEVICES_KEY = "iterate-call-devices";
type SavedDevices = Partial<Record<DeviceKind, { id: string; label: string } | null>>;
/** The devices this browser chose for calls: the engine's pickers and a lobby's share them. */
export function savedDevices(): SavedDevices {
  try {
    return JSON.parse(localStorage.getItem(DEVICES_KEY) ?? "{}") || {};
  } catch {
    return {};
  }
}
/** Keeps a choice for the next visit (`id` "" is the browser's default). No storage: it lasts as
 *  long as the page. */
export function saveDevice(kind: DeviceKind, id: string, label: string) {
  const saved = { ...savedDevices(), [kind]: id ? { id, label } : null };
  try {
    localStorage.setItem(DEVICES_KEY, JSON.stringify(saved));
  } catch {
    // no storage
  }
  return saved;
}
/** A microphone or a camera, opened as a call opens it (the same processing and size), by its id;
 *  a device that cannot be opened by its id falls back to the browser's default. A lobby opens its
 *  preview with it, so the tracks it hands to `join` are the call's own. */
export async function captureDevice(kind: "mic" | "camera", id: string) {
  const base = kind === "mic" ? MIC : CAMERA;
  if (!navigator.mediaDevices?.getUserMedia)
    throw Object.assign(new Error("this browser gives this page no camera or microphone"), {
      name: "NotSupportedError",
    });
  const ask = (constraints: MediaTrackConstraints) =>
    navigator.mediaDevices.getUserMedia(
      kind === "mic" ? { audio: constraints } : { video: constraints },
    );
  if (!id) return ask(base);
  try {
    return await ask({ ...base, deviceId: { exact: id } });
  } catch (error) {
    if (!["NotFoundError", "OverconstrainedError"].includes(nameOf(error))) throw error;
    return ask(base);
  }
}
/** The voice agent leaves when nobody, person or agent, said anything for this long. */
const AI_IDLE_MS = 5 * 60_000;

/** One of the call facet's methods, called over the session the page holds. */
export type CallFacet = (method: string, ...args: unknown[]) => Promise<unknown>;
type Pair = { path: Path | null; rttMs: number | null };
/** What a page sends, each its own track at the call (call/rules.ts `KINDS`). */
type SendKind = "mic" | "camera" | "screen" | "ai";
/** A camera or screen tile: this page's own, or another page's, by its track ("<page>:<kind>"). */
export type CallVideo = {
  key: string;
  name: string;
  kind: string;
  stream: MediaStream;
  local: boolean;
  track?: string;
};
/** What the call draws, a new object at each change. */
export type CallUi = {
  joined: boolean;
  joining: boolean;
  muted: boolean;
  /** The first Unmute of a page that only listened is at work: the microphone opens and is sent. */
  unmuting: boolean;
  camera: boolean;
  screen: boolean;
  /** Which path each connection takes, and its round trip. */
  net: string;
  notice: string;
  error: string;
  repair: string;
  /** This tab hosts the voice agent: "starting", "on", or "off". */
  ai: "off" | "starting" | "on";
  /** Why the voice agent this page invited did not come: the call's own words, and its marks
   *  for a spent credit or no key. */
  aiRefusal: VoiceRefusal | null;
  devices: {
    mic: { id: string; label: string }[];
    camera: { id: string; label: string }[];
    speaker: { id: string; label: string }[];
    chosen: Record<DeviceKind, string>;
    speakerSupported: boolean;
    /** What the member's lent Macs offer (none without one), and what a Mac sends for this page
     *  now, by the picker's value (`MacSource.id`). */
    mac?: {
      camera: { id: string; label: string }[];
      screen: { id: string; label: string }[];
      chosen: { camera: string; screen: string };
      /** A choice under way: the Mac asks its owner, or connects. */
      asking: string;
    };
  };
  videos: CallVideo[];
  /** This page's captions: its microphone transcribed, each finished line to the call. */
  captions: { status: "off" | "connecting" | "listening" | "error"; text: string };
};
/** Why the voice agent did not come: a refusal the call answers as such (no key, a spent credit,
 *  another host) has its marks; any other failure is its message alone. */
export type VoiceRefusal = { message: string; credit?: true; noKey?: true };

const IDLE: CallUi = {
  joined: false,
  joining: false,
  muted: false,
  unmuting: false,
  camera: false,
  screen: false,
  net: "",
  notice: "",
  error: "",
  repair: "",
  ai: "off",
  aiRefusal: null,
  devices: {
    mic: [],
    camera: [],
    speaker: [],
    chosen: { mic: "", camera: "", speaker: "" },
    speakerSupported: true,
  },
  videos: [],
  captions: { status: "off", text: "" },
};

/** Wait for the page's candidates before an offer or answer goes out: until gathering is complete,
 *  2 s at most, and 300 ms after the first candidate that is not a host one. */
async function gathered(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return;
  // the listeners go with the wait: each renegotiation waits anew
  const listening = new AbortController();
  await new Promise<void>((resolve) => {
    let soon: ReturnType<typeof setTimeout> | null = null;
    const done = () => {
      clearTimeout(timer);
      if (soon) clearTimeout(soon);
      listening.abort();
      resolve();
    };
    const timer = setTimeout(done, 2_000);
    const { signal } = listening;
    pc.addEventListener(
      "icegatheringstatechange",
      () => {
        if (pc.iceGatheringState === "complete") done();
      },
      { signal },
    );
    pc.addEventListener(
      "icecandidate",
      ({ candidate }) => {
        if (candidate?.type && candidate.type !== "host") soon ||= setTimeout(done, 300);
      },
      { signal },
    );
  });
}

/** The selected pair of a connection: its path and round trip. */
async function selectedPair(pc: RTCPeerConnection): Promise<Pair | null> {
  const stats = await pc.getStats();
  let pair: { localCandidateId?: string; currentRoundTripTime?: number } | undefined;
  stats.forEach((s: { type: string; selectedCandidatePairId?: string }) => {
    if (s.type === "transport" && s.selectedCandidatePairId)
      pair = stats.get(s.selectedCandidatePairId);
  });
  if (!pair) return null;
  return {
    path: pathOf(pair.localCandidateId ? stats.get(pair.localCandidateId) : undefined),
    rttMs: pair.currentRoundTripTime == null ? null : Math.round(pair.currentRoundTripTime * 1000),
  };
}

/** Resolves once `pc` is connected on a path this page uses; throws a plain reason otherwise, and
 *  at once when the call `gen` ends: `close()` fires no state change, so a closed connection would
 *  hold the wait for its whole timeout. */
async function connectedPath(
  pc: RTCPeerConnection,
  name: string,
  hasRelay: () => boolean,
  gen: AbortSignal,
) {
  gen.throwIfAborted();
  const tried = hasRelay()
    ? "neither over UDP nor through Cloudflare's TURN relay"
    : "over UDP, and this page has no TURN relay";
  if (pc.connectionState !== "connected") {
    // the listeners go with the wait
    const listening = new AbortController();
    const { signal } = listening;
    await new Promise<void>((resolve, reject) => {
      const end = (error?: unknown) => {
        clearTimeout(timer);
        listening.abort();
        if (error) reject(error);
        else resolve();
      };
      const timer = setTimeout(
        () =>
          end(
            new Error(
              `${name}: no connection to Cloudflare in ${CONNECT_TIMEOUT_MS / 1000} s, ${tried}.`,
            ),
          ),
        CONNECT_TIMEOUT_MS,
      );
      gen.addEventListener("abort", () => end(gen.reason), { signal });
      pc.addEventListener(
        "connectionstatechange",
        () => {
          if (pc.connectionState === "connected") end();
          if (pc.connectionState === "failed")
            end(new Error(`${name}: no path to Cloudflare, ${tried}.`));
        },
        { signal },
      );
    });
  }
  const pair = await selectedPair(pc);
  if (!pathAccepted(pair?.path)) {
    pc.close();
    throw new Error(
      `${name}: the path is ${pair?.path ? PATH_TEXT[pair.path] : "unknown"}, which this page does not use.`,
    );
  }
  return pair;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const nameOf = (error: unknown) => (error instanceof Error ? error.name : "");
/** The browser's errors for a microphone it refused, or that is not there. */
const NO_MIC = ["NotAllowedError", "NotFoundError"];
const stopTracks = (stream: MediaStream | null | undefined) => {
  for (const track of stream?.getTracks() ?? []) track.stop();
};

/**
 * ONE CALL'S WORK AND WHAT IT HOLDS, from the join that starts it to the teardown that ends it.
 * - `signal` aborts at the end: the call's work stops at its next step.
 * - `send` and `receive` are its two queues, one job at a time each. A job queued after the end
 *   does not run, and the next call has queues of its own, so it never waits on this one's.
 * - `own(close)` holds a track, a stream or a connection from the moment it exists: the end closes
 *   it, unless the release that `own` answers came first, when the thing became the page's
 *   (`mic`, `pub`, `local`). Owned after the end, it is closed at once.
 */
/** The last admission's order number in this tab: each later admission has a higher one, across
 *  reloads too (it starts at the clock), so the call refuses an older admit that came late. */
let lastSeq = 0;
function callScope() {
  const abort = new AbortController();
  const held = new Set<() => void>();
  // rejects at the end, for every caller that waits on this call's queues: a job stuck behind an
  // unanswered prompt holds nobody past the end
  const ended = new Promise<never>((_, reject) =>
    abort.signal.addEventListener("abort", () => reject(abort.signal.reason), { once: true }),
  );
  ended.catch(() => {});
  const queue = () => {
    let tail: Promise<unknown> = Promise.resolve();
    const run = <T>(work: () => Promise<T>): Promise<T> => {
      const next = tail.then(() => {
        abort.signal.throwIfAborted();
        return work();
      });
      tail = next.catch(() => {});
      return Promise.race([next, ended]);
    };
    /** Resolves once every job queued so far has ended, or the call has. */
    const settled = () =>
      Promise.race([tail, ended]).then(
        () => {},
        () => {},
      );
    return Object.assign(run, { settled });
  };
  /** The press that opens each kind's picture, while its picker or prompt is open. */
  const capturing: Partial<Record<"camera" | "screen", { track?: MediaStreamTrack }>> = {};
  return {
    signal: abort.signal,
    get ended() {
      return abort.signal.aborted;
    },
    /** This call's admission, chosen here: every method of the facet that this call sends carries
     *  it, and the facet refuses one that is not the row's current admission (call/rules.ts). So
     *  no leave, offer or agent of this call reaches a later one, whatever the timing. */
    admission: crypto.randomUUID(),
    /** This admission's order among the page's own (`lastSeq`). */
    seq: (lastSeq = Math.max(Date.now(), lastSeq + 1)),
    /** This call sent its join: a Leave owes the facet its admission's leave. */
    joinSent: false,
    /** A request to the browser (a device, the screen's picker) for this call: it settles at the
     *  call's end, and what it brings after the end is closed (`late`). */
    until<T>(work: Promise<T>, late: (value: T) => void): Promise<T> {
      work.then(
        (value) => {
          if (abort.signal.aborted) late(value);
        },
        () => {},
      );
      return Promise.race([work, ended]);
    },
    // this call's own work in flight: a new call starts with none of the old one's
    /** The subscriptions are being made to follow the call; `reconcileAgain`: once more after. */
    reconciling: false,
    reconcileAgain: false,
    /** This call is being left for a new one (`rejoin`). */
    rejoining: false,
    capturing,
    send: queue(),
    receive: queue(),
    own(close: () => void) {
      if (abort.signal.aborted) {
        close();
        return () => {};
      }
      held.add(close);
      return () => void held.delete(close);
    },
    end() {
      abort.abort(new Error("the call ended"));
      for (const close of held) close();
      held.clear();
    },
  };
}
type CallScope = ReturnType<typeof callScope>;

/**
 * THE CALL OF ONE PAGE. `facet(method, ...args)` calls one of the call facet's methods (`join`,
 * `signal`, `leave`, `voiceAgent`). `page` is this page's own subscription row on the agent's
 * context: the call knows the page by it. The answer is the engine: `ui` (a new object at each
 * change), `subscribe(listener)`, the actions, and `sync(view)`, which `useCall` calls with each
 * live state of the call.
 */
export function createCall({
  facet,
  page,
  invoke,
}: {
  facet: CallFacet;
  page: string;
  /** Any itx expression on the agent's context, as the page holds it: a member's lent Macs are
   *  read and asked through it. None (or a guest's view, which refuses it): no Mac is offered. */
  invoke?: (expression: unknown) => Promise<unknown>;
}) {
  const listeners = new Set<(ui: CallUi) => void>();
  let ui = IDLE;
  const set = (patch: Partial<CallUi>) => {
    ui = { ...ui, ...patch };
    for (const listener of listeners) listener(ui);
  };
  const say = (notice: string) => set({ notice });
  const fail = (error: unknown) => set({ error: messageOf(error) });
  /** One step of the SFU's signalling, for this page. */
  /** One signalling step of `call`, never after its end, under its admission. */
  const signal = async (step: Record<string, unknown>, call: CallScope) => {
    call.signal.throwIfAborted();
    return SignalAnswer.parse(await facet("signal", page, step, call.admission));
  };

  // ── what this page holds ──
  let joined = false;
  let view: CallView | null = null;
  let mic: MediaStream | null = null;
  // the sending connection, made with the first track this page sends: none while it only listens
  let pub: { pc: RTCPeerConnection; micTx: RTCRtpTransceiver | null } | null = null;
  let sub: { pc: RTCPeerConnection; connected: Promise<unknown> | null } | null = null;
  // a track ("<page>:<kind>") -> its subscription's mid, the number it was published under, its layer
  const subscribed = new Map<string, { mid: string; key: string | undefined; rid?: Rid }>();
  // a mid -> the track it carries, and what plays it
  const players = new Map<
    string,
    { track: string; stream: MediaStream } & (
      | { video: true }
      | { video: false; element: HTMLMediaElement }
    )
  >();
  const local: Partial<
    Record<
      "camera" | "screen",
      { stream: MediaStream; track: MediaStreamTrack; tx: RTCRtpTransceiver; onEnded: () => void }
    >
  > = {};
  // the call under way, or the next one: teardown ends it and makes a new one
  let scope = callScope();
  // one more at each teardown: a press that waited (a Start's enable) acts only in the call it saw
  let epoch = 0;
  // a microphone a switch is putting in place: a Mute meanwhile goes to it too
  let switchingTo: MediaStreamTrack | null = null;
  // the one automatic rejoin (a repair's, or the out-of-touch one), spent until the person presses
  // Join again
  let rejoinSpent = false;
  // the error a receiving connection's failure said, cleared when its repair works
  let receiveError = "";
  let joinedAt = 0;
  /** The join under way: a camera or a screen pressed during it waits for it. */
  let joining: Promise<void> | null = null;
  const paths: Record<"pub" | "sub", Pair | null> = { pub: null, sub: null };

  const videosChanged = () => {
    const videos: CallVideo[] = [];
    for (const kind of ["camera", "screen"] as const) {
      const own = local[kind];
      if (own)
        videos.push({ key: `local-${kind}`, name: "You", kind, stream: own.stream, local: true });
    }
    const names = new Map(view?.call.map((one) => [one.peer, one.name]));
    for (const [mid, player] of players) {
      if (!player.video) continue;
      const at = player.track.lastIndexOf(":");
      const owner = player.track.slice(0, at);
      videos.push({
        key: `mid-${mid}`,
        track: player.track,
        name: names.get(owner) ?? "Someone",
        kind: player.track.slice(at + 1),
        stream: player.stream,
        local: false,
      });
    }
    set({ videos, camera: Boolean(local.camera), screen: Boolean(local.screen) });
  };

  // ── TURN: the relay's credentials that the call's `join` answered ──
  let iceServers: RTCIceServer[] = [STUN];
  const relay: { on: boolean; refresh: ReturnType<typeof setTimeout> | null } = {
    on: false,
    refresh: null,
  };
  const iceConfig = (): RTCConfiguration => ({ iceServers, bundlePolicy: "max-bundle" });
  /** The credentials, handed to every live connection, and asked for again (a `join` again) at
   *  three quarters of their life. */
  function useIce(answer: { iceServers?: unknown[]; ttlS?: number } | null) {
    if (relay.refresh) clearTimeout(relay.refresh);
    if (answer?.iceServers?.length) {
      iceServers = iceServersOf(answer.iceServers);
      relay.on = true;
      for (const pc of [pub?.pc, sub?.pc, ai.pc])
        if (pc && pc.connectionState !== "closed")
          pc.setConfiguration({ ...pc.getConfiguration(), iceServers });
    } else if (!relay.on) iceServers = [STUN];
    const call = scope;
    relay.refresh = setTimeout(
      () => joined && !call.ended && void getIce(call),
      Math.max(60, Number(answer?.ttlS) || 0) * 750,
    );
  }
  /** The credentials again, for `call`'s admission while it is the row's: a refresh admits
   *  nobody. A failure keeps what the page has. */
  async function getIce(call: CallScope) {
    const answer = await facet("join", page, { admission: call.admission }).catch(() => null);
    if (call.ended) return;
    useIce(JoinAnswer.safeParse(answer).data ?? null);
  }

  // ── devices ──
  const devices: {
    list: MediaDeviceInfo[];
    saved: SavedDevices;
    sinkOk: boolean;
    sink: string;
  } = {
    list: [],
    saved: savedDevices(),
    sinkOk: Boolean(globalThis.HTMLMediaElement) && "setSinkId" in HTMLMediaElement.prototype,
    sink: "",
  };
  const deviceId = (kind: DeviceKind) => pickDevice(devices.list, kind, devices.saved[kind]);
  const inUse = (kind: DeviceKind) => {
    const track =
      kind === "mic"
        ? mic?.getAudioTracks()[0]
        : kind === "camera"
          ? local.camera?.track
          : undefined;
    const id = track?.readyState === "live" ? track.getSettings().deviceId : undefined;
    if (id) return ["default", "communications"].includes(id) ? "" : id;
    return kind === "speaker" ? devices.sink : deviceId(kind);
  };
  const renderDevices = () =>
    set({
      devices: {
        mic: deviceOptions(devices.list, "mic"),
        camera: deviceOptions(devices.list, "camera"),
        speaker: devices.sinkOk ? deviceOptions(devices.list, "speaker") : [],
        chosen: { mic: inUse("mic"), camera: inUse("camera"), speaker: inUse("speaker") },
        speakerSupported: devices.sinkOk,
        ...((macs.list.length || macs.chosen.camera || macs.chosen.screen) && {
          mac: {
            camera: macs.list.filter((one) => one.kind === "camera"),
            screen: macs.list.filter((one) => one.kind === "screen"),
            chosen: {
              camera: macs.chosen.camera?.id || "",
              screen: macs.chosen.screen?.id || "",
            },
            asking: macs.asking,
          },
        }),
      },
    });
  /** The browser's devices; with `macs`, also the member's lent Macs (only the picker asks for
   *  them, when it opens: a join or a camera's start reads no lend, so a call costs no reads for
   *  people with no Mac, guests too). */
  async function listDevices({ macs = false }: { macs?: boolean } = {}) {
    devices.list = (await navigator.mediaDevices?.enumerateDevices?.().catch(() => null)) ?? [];
    renderDevices();
    if (macs) await listMacs();
  }

  // ── a member's Mac: its camera or a screen, sent by the Mac app itself ──
  const macs: {
    list: MacSource[];
    chosen: Partial<Record<"camera" | "screen", MacSource>>;
    asking: string;
    /** The agent's path, as the context says it: the Mac joins this call. */
    context: string;
  } = { list: [], chosen: {}, asking: "", context: "" };
  /** The member's Macs lent now and what each offers: read when the picker opens. A Mac whose
   *  newest device event is another member's is not offered; a failure offers none. */
  async function listMacs() {
    if (!invoke) return;
    try {
      const [who, stubs, rows] = await Promise.all([
        invoke(["itx", ["whoami"]]),
        invoke(["itx", ["cd", "/"], "rpcStubs", ["list"]]),
        invoke(["itx", ["cd", "/"], "contexts", ["list", { under: "/devices", limit: 200 }]]),
      ]);
      const me = (who as { principal?: { actor?: string } } | null)?.principal?.actor;
      macs.context = String((who as { path?: string } | null)?.path || "");
      if (!me || !macs.context || !Array.isArray(stubs) || !Array.isArray(rows))
        throw new Error("no member");
      const lent = liveMacs(stubs as string[], rows as { path: string }[]);
      const offered = await Promise.all(
        lent.map(async (mac) => {
          const newest = (await invoke([
            "itx",
            ["cd", mac.path],
            ["readEvents", Math.max(0, mac.events - 100), 100],
          ]).catch(() => null)) as { events?: unknown[] } | null;
          if (macOwner(newest?.events || []) !== me) return [];
          const state = await invoke(["itx", ["cd", "/"], ...mac.lend.split("."), ["state"]]).catch(
            () => null,
          );
          return macSources(mac.lend, state);
        }),
      );
      macs.list = offered.flat();
    } catch {
      macs.list = [];
    }
    renderDevices();
  }
  /** The member chose a Mac's camera or screen (`id`), or "" for none: the Mac that sends this
   *  kind for this page now stops, and the chosen one is asked. The page's own camera or screen
   *  goes off first: one picture of each kind. */
  async function chooseMac(kind: "camera" | "screen", id: string) {
    const was = macs.chosen[kind];
    const next = id ? macs.list.find((one) => one.id === id && one.kind === kind) : undefined;
    if (was?.id === next?.id) return;
    delete macs.chosen[kind];
    renderDevices();
    if (was) await unpublishMac(was);
    if (!next) return;
    if (local[kind] || scope.capturing[kind]) await videoOff(kind);
    macs.chosen[kind] = next;
    macs.asking = next.label;
    renderDevices();
    try {
      await invoke!(
        lendCall(next.lend, "publish", { context: macs.context, source: next.source, as: page }),
      );
    } catch (error) {
      if (macs.chosen[kind] === next) delete macs.chosen[kind];
      fail(`Your Mac did not send its ${kind}: ${messageOf(error)}`);
    } finally {
      macs.asking = "";
      renderDevices();
    }
  }
  function unpublishMac(mac: MacSource) {
    return Promise.resolve(
      invoke?.(lendCall(mac.lend, "unpublish", { context: macs.context, source: mac.source })),
    ).catch(() => {});
  }
  /** Every Mac that sends for this page stops: a Leave, or the page goes. */
  function stopMacs() {
    const sending = Object.values(macs.chosen);
    macs.chosen = {};
    return Promise.all(sending.map((mac) => unpublishMac(mac)));
  }
  /** A device that cannot be opened by its id falls back to the browser's default, and says so. */
  async function openMedia(kind: "mic" | "camera", id: string, call: CallScope) {
    const base = kind === "mic" ? MIC : CAMERA;
    // the call's own request: one answered after its end is closed, and its caller is not held
    const ask = (constraints: MediaTrackConstraints) => {
      call.signal.throwIfAborted();
      return call.until(
        navigator.mediaDevices.getUserMedia(
          kind === "mic" ? { audio: constraints } : { video: constraints },
        ),
        stopTracks,
      );
    };
    if (!id) return ask(base);
    try {
      return await ask({ ...base, deviceId: { exact: id } });
    } catch (error) {
      const why = nameOf(error);
      // a call that ended asks for no default device
      if (
        call.ended ||
        !["NotFoundError", "OverconstrainedError", "NotReadableError", "AbortError"].includes(why)
      )
        throw error;
      say(
        `Your chosen ${kind === "mic" ? "microphone" : "camera"} could not be opened: the browser's default is used.`,
      );
      return ask(base);
    }
  }
  const sinkOf = (element: HTMLMediaElement) => {
    if (devices.sinkOk && devices.sink) void element.setSinkId(devices.sink).catch(() => {});
  };
  /** The microphone's track ended by itself (unplugged, or taken): the default stands in. */
  function watchMic() {
    const track = mic?.getAudioTracks()[0];
    track?.addEventListener("ended", () => {
      if (joined && mic?.getAudioTracks()[0] === track)
        void switchMic("", "Your microphone went away: the browser's default is used now.");
    });
  }
  function switchMic(id: string, notice?: string) {
    const call = scope;
    return call.send(async () => {
      if (!joined || !mic) return;
      const before = mic;
      let stream: MediaStream;
      try {
        stream = await openMedia("mic", id, call);
      } catch (error) {
        say(`No microphone could be opened (${messageOf(error)}).`);
        return;
      }
      const release = call.own(() => stopTracks(stream));
      const track = stream.getAudioTracks()[0]!;
      track.enabled = !ui.muted;
      try {
        call.signal.throwIfAborted();
        // only this call's own switch: an old one's never takes a newer call's Mute
        switchingTo = track;
        await pub?.micTx?.sender.replaceTrack(track);
        call.signal.throwIfAborted();
      } catch (error) {
        // the call ended while the browser opened it (its end stopped it): the microphone it kept
        // is not this one's
        if (!call.ended) {
          stopTracks(stream);
          say(`The new microphone could not be used (${messageOf(error)}).`);
        }
        return;
      } finally {
        if (switchingTo === track) switchingTo = null;
        release();
      }
      // the mute as it is now: a press during the switch went to the old microphone
      track.enabled = !ui.muted;
      mic = stream;
      watchMic();
      // the captions hear the new microphone, when they are on
      if (cap.audio) {
        stopAudio();
        void startAudio();
      }
      for (const old of before.getTracks()) old.stop();
      // the voice agent hears the new microphone, when this tab hosts it
      if (ai.context && ai.micNode && ai.mix) {
        ai.micNode.disconnect();
        ai.micNode = ai.context.createMediaStreamSource(mic);
        ai.micNode.connect(ai.mix);
      }
      if (notice) say(notice);
      renderDevices();
    });
  }
  function switchCamera(id: string) {
    const call = scope;
    return call.send(async () => {
      const source = local.camera;
      if (!joined || !source) return;
      const stream = await openMedia("camera", id, call);
      const track = stream.getVideoTracks()[0]!;
      const release = call.own(() => track.stop());
      try {
        // the camera went off, or the call ended, while the browser opened it
        if (local.camera !== source) throw new Error("the camera is off");
        await source.tx.sender.replaceTrack(track);
        // the same layers, each scaled again for this camera's width
        const params = source.tx.sender.getParameters();
        for (const encoding of params.encodings || []) {
          const rid = ridOf(encoding.rid);
          if (rid) encoding.scaleResolutionDownBy = scaleFor(rid, track.getSettings().width);
        }
        await source.tx.sender.setParameters(params).catch(() => {});
        call.signal.throwIfAborted();
        if (local.camera !== source) throw new Error("the camera is off");
      } catch (error) {
        // the call's end stopped it already
        if (call.ended) return;
        track.stop();
        if (local.camera !== source) return;
        throw error;
      } finally {
        release();
      }
      source.track.removeEventListener("ended", source.onEnded);
      source.track.stop();
      Object.assign(source, { stream, track });
      track.addEventListener("ended", source.onEnded);
      videosChanged();
      renderDevices();
    });
  }
  async function useSpeaker(id: string) {
    if (!devices.sinkOk) return;
    const elements = [
      ...[...players.values()].flatMap((player) => (player.video ? [] : [player.element])),
      ...(ai.audio ? [ai.audio] : []),
    ];
    try {
      await Promise.all(elements.map((element) => element.setSinkId(id)));
      devices.sink = id;
    } catch (error) {
      devices.sink = "";
      say(
        `That speaker could not be used (${nameOf(error) || messageOf(error)}): sound plays through the default.`,
      );
    }
    renderDevices();
  }
  /** The person chose a device: kept for the next visit, and used now. */
  async function chooseDevice(kind: DeviceKind, id: string) {
    if (id.startsWith("mac:") && kind === "camera") return chooseMac("camera", id);
    if (kind === "camera" && macs.chosen.camera) await chooseMac("camera", "");
    const label = devices.list.find((d) => d.deviceId === id)?.label ?? "";
    devices.saved = saveDevice(kind, id, label);
    // the switch says its own failure; one of a call that ended meanwhile is no error to show
    const call = scope;
    const unlessEnded = (error: unknown) => {
      if (!call.ended) fail(error);
    };
    if (kind === "mic") await switchMic(id).catch(unlessEnded);
    else if (kind === "camera") await switchCamera(id).catch(unlessEnded);
    else await useSpeaker(id);
    renderDevices();
  }

  // ── sending ──
  /** How `kind` is sent: the camera's simulcast layers, the screen's bitrate, else the default. */
  function sendEncodingsOf(track: MediaStreamTrack, kind: SendKind) {
    if (kind === "camera") return cameraLayers(track.getSettings().width);
    if (kind === "screen") return [{ maxBitrate: 1_500_000 }];
    return undefined;
  }
  /** `track`, sent: on the sending connection, or on a new one when this page sends nothing yet. A
   *  page sends a track only once it has one, so no page in the call holds an empty sender, which
   *  another page could subscribe to and get no offer for. */
  async function send(track: MediaStreamTrack, kind: SendKind, call: CallScope) {
    if (!pub) return publish(track, kind, call);
    const sending = pub;
    const tx = await publishTrack(track, kind, call);
    // a microphone after the camera or the screen: a switch of microphone replaces this sender's track
    if (kind === "mic") sending.micTx = tx;
    return tx;
  }
  /** The first track this page sends, on a new connection, which is the call's until it is `pub`. */
  async function publish(track: MediaStreamTrack, kind: SendKind, call: CallScope) {
    const pc = new RTCPeerConnection(iceConfig());
    const release = call.own(() => pc.close());
    guard(pc, "pub");
    let tx: RTCRtpTransceiver;
    try {
      tx = pc.addTransceiver(track, {
        direction: "sendonly",
        sendEncodings: sendEncodingsOf(track, kind),
      });
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      call.signal.throwIfAborted();
      const answer = await signal(
        { publish: kind, mid: tx.mid, sdp: udpOnly(pc.localDescription!.sdp) },
        call,
      );
      await pc.setRemoteDescription({ type: "answer", sdp: udpOnly(answer.sdp || "") });
      call.signal.throwIfAborted();
      pub = { pc, micTx: kind === "mic" ? tx : null };
    } catch (error) {
      pc.close();
      throw error;
    } finally {
      release();
    }
    try {
      paths.pub = await connectedPath(pc, "Sending", () => relay.on, call.signal);
    } catch (error) {
      // a sending connection that never connects is out of the call again: the call forgets its
      // tracks, so no other page subscribes to a track that carries nothing
      if (pub?.pc === pc && !call.ended) {
        pub = null;
        pc.close();
        await signal({ reset: "pub" }, call).catch(() => {});
      }
      throw error;
    }
    return tx;
  }
  /** One more track on the sending connection: its own sender, an offer, the SFU's answer. */
  async function publishTrack(track: MediaStreamTrack, kind: SendKind, call: CallScope) {
    const sending = pub!;
    const tx = sending.pc.addTransceiver(track, {
      direction: "sendonly",
      sendEncodings: sendEncodingsOf(track, kind),
    });
    await sending.pc.setLocalDescription(await sending.pc.createOffer());
    await gathered(sending.pc);
    const answer = await signal(
      { publish: kind, mid: tx.mid, sdp: udpOnly(sending.pc.localDescription!.sdp) },
      call,
    );
    await sending.pc.setRemoteDescription({ type: "answer", sdp: udpOnly(answer.sdp || "") });
    return tx;
  }
  /** The camera or the screen, opened from the press itself (the screen's picker needs the click),
   *  then sent on the call's sending queue, behind a publish that may be under way. */
  /** A camera or the screen, sent. `given`: a camera a lobby opened already, which the call owns
   *  from here (stopped on every path that does not send it). */
  async function videoOn(kind: "camera" | "screen", given?: MediaStream) {
    const call = scope;
    if (local[kind] || call.capturing[kind]) return stopTracks(given);
    // a press during the join waits on the sending queue behind the join's own publish; a press
    // with no call says why, and asks the browser for nothing
    if (!joined && !ui.joining) {
      stopTracks(given);
      fail(`No ${kind}: this page's connection to the call is not up. Join the call first.`);
      return;
    }
    // this press's picture: a second press while its picker is open is an Off, which ends it
    const press: { track?: MediaStreamTrack } = {};
    call.capturing[kind] = press;
    const mine = () => call.capturing[kind] === press;
    try {
      const stream =
        given ||
        (kind === "camera"
          ? await openMedia("camera", deviceId("camera"), call)
          : await call.until(
              navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: { ideal: 15, max: 30 } },
                audio: false,
              }),
              stopTracks,
            ));
      const track = stream.getVideoTracks()[0]!;
      // an Off while the picker was open: the chosen picture closes at once, not at its turn
      if (!mine()) {
        track.stop();
        return;
      }
      // an Off while it waits for its turn stops it at once
      press.track = track;
      const release = call.own(() => track.stop());
      // the browser's own "Stop sharing", or a camera that went away, ends the share: watched from
      // the moment the picture exists, also while it waits for its turn to be sent
      const onEnded = () => {
        if (local[kind]?.onEnded === onEnded) void videoOff(kind);
      };
      track.addEventListener("ended", onEnded);
      const ended = () => track.readyState === "ended";
      // a press during the join: its publish goes first
      if (joining) await call.until(joining, () => {});
      await call
        .send(async () => {
          // an Off, a second press, or a picture that ended while it waited: nothing is sent
          if (!mine() || local[kind] || ended()) return track.stop();
          // the join failed meanwhile: the press says why
          if (!joined)
            throw new Error("this page's connection to the call is not up. Join the call first.");
          // a page that only listens sends this picture as its first track
          const tx = await send(track, kind, call);
          const sending = pub!;
          call.signal.throwIfAborted();
          if (!mine() || ended()) {
            track.stop();
            await unpublish(kind, tx, sending, call);
            return;
          }
          local[kind] = { stream, track, tx, onEnded };
        })
        .catch((error: unknown) => {
          track.stop();
          throw error;
        })
        .finally(() => {
          release();
          if (mine()) delete call.capturing[kind];
        });
      if (kind === "camera") void listDevices();
      videosChanged();
    } catch (error) {
      if (mine()) delete call.capturing[kind];
      if (call.ended) return;
      fail(
        nameOf(error) === "NotAllowedError"
          ? `The browser did not give this page the ${kind}.`
          : `No ${kind}: ${messageOf(error)}`,
      );
    }
  }
  function videoOff(kind: "camera" | "screen") {
    const call = scope;
    // a picker still open: its picture, when it comes, is closed
    call.capturing[kind]?.track?.stop();
    delete call.capturing[kind];
    return call
      .send(async () => {
        const source = local[kind];
        if (!source) return;
        delete local[kind];
        source.track.stop();
        videosChanged();
        if (pub) await unpublish(kind, source.tx, pub, call);
      })
      .catch((error: unknown) => {
        if (!call.ended) fail(error);
      });
  }
  /** A track this page sends, out of the call: the SFU closes it, and its sender stops, so later
   *  offers do not carry it. Only on the connection `sending` that sent it, while it is the page's. */
  async function unpublish(
    kind: "camera" | "screen" | "ai",
    tx: RTCRtpTransceiver,
    sending: NonNullable<typeof pub>,
    call: CallScope,
  ) {
    if (pub !== sending) return;
    await signal({ unpublish: kind, mid: tx.mid }, call).catch(() => {});
    if (pub === sending) tx.stop();
  }

  // ── receiving ──
  /** The receiving connection, made on first use; the call makes its SFU session at the first
   *  subscribe. */
  function ensureSub() {
    if (sub) return sub;
    const pc = new RTCPeerConnection(iceConfig());
    guard(pc, "sub");
    pc.addEventListener("track", (event) => {
      const mid = event.transceiver.mid || "";
      // a mid this page did not subscribe to has no tile and no sound
      const track = [...subscribed].find(([, s]) => s.mid === mid)?.[0];
      if (!track) return;
      const stream = new MediaStream([event.track]);
      if (event.track.kind === "video") {
        // the tile plays it (call-tiles.tsx)
        players.set(mid, { track, stream, video: true });
        videosChanged();
        return;
      }
      const element = Object.assign(new Audio(), { autoplay: true, srcObject: stream });
      sinkOf(element);
      play(element);
      players.set(mid, { track, element, stream, video: false });
      aiMix();
    });
    sub = { pc, connected: null };
    return sub;
  }
  /** Answer the SFU's offer on the receiving connection. */
  async function answerOffer(
    s: { pc: RTCPeerConnection },
    sdp: string | undefined,
    call: CallScope,
  ) {
    if (!sdp) return;
    await s.pc.setRemoteDescription({ type: "offer", sdp: udpOnly(sdp) });
    await s.pc.setLocalDescription(await s.pc.createAnswer());
    await gathered(s.pc);
    await signal({ renegotiate: udpOnly(s.pc.localDescription!.sdp) }, call);
  }
  function dropPlayer(mid: string) {
    const player = players.get(mid);
    if (player && !player.video) {
      player.element.pause();
      player.element.srcObject = null;
    }
    players.delete(mid);
  }
  // sound the browser held back until the person's next click on the page
  let soundHeld = false;
  function replay() {
    soundHeld = false;
    for (const player of players.values())
      if (!player.video) void player.element.play().catch(() => {});
    void ai.audio?.play().catch(() => {});
  }
  function play(element: HTMLMediaElement) {
    element.play().catch((error: unknown) => {
      if (nameOf(error) !== "NotAllowedError" || soundHeld) return;
      soundHeld = true;
      say("The browser held back the sound: click anywhere on the page.");
      addEventListener("click", replay, { once: true, capture: true });
    });
  }
  function dropSubs() {
    for (const mid of players.keys()) dropPlayer(mid);
    subscribed.clear();
    videosChanged();
  }
  /** What this page should receive: every other page's tracks in the call, each keyed by its
   *  number, which changes when it is published anew (a repair): a changed key is subscribed again. */
  function wanted() {
    const want = new Map<string, string>();
    for (const one of view?.call || []) {
      if (one.peer === page) continue;
      for (const [kind, gen] of Object.entries(one.tracks))
        want.set(`${one.peer}:${kind}`, `${gen}`);
    }
    return want;
  }
  /** Stops when the `call` ends: its answers must not reach the next call's subscriptions. The
   *  receiving connection is made here, on first use. */
  async function syncSubs(call: CallScope) {
    call.signal.throwIfAborted();
    if (!joined) return;
    const want = wanted();
    const gone = [...subscribed].filter(([track, s]) => want.get(track) !== s.key);
    if (gone.length && sub) {
      await signal({ close: gone.map(([, s]) => s.mid) }, call).catch(() => {});
      call.signal.throwIfAborted();
      for (const [track, s] of gone) {
        subscribed.delete(track);
        dropPlayer(s.mid);
      }
      videosChanged();
    }
    const fresh = [...want].filter(([track]) => !subscribed.has(track));
    if (!fresh.length) return;
    const s = ensureSub();
    const layers = Object.fromEntries(
      fresh
        .filter(([track]) => track.endsWith(":camera"))
        .map(([track]) => [track, layerWanted.get(track) ?? FIRST_LAYER]),
    );
    const answer = await signal({ subscribe: fresh.map(([track]) => track), layers }, call);
    call.signal.throwIfAborted();
    for (const { track, mid } of answer.tracks || [])
      if (mid) subscribed.set(track, { mid, key: want.get(track), rid: layers[track] });
    await answerOffer(s, answer.sdp, call);
    s.connected ||= connectedPath(s.pc, "Receiving", () => relay.on, call.signal).then(
      (pair) => (paths.sub = pair),
      (error: unknown) => {
        // the next look waits on a new try, not on this failure
        s.connected = null;
        // one that never connected is made anew, as one that broke: the same bounded repair
        if (!call.ended && sub === s) void repair("sub");
        throw error;
      },
    );
    await s.connected;
  }
  /** The subscriptions, made to follow the call. A change that comes while one runs is followed
   *  once it ends. */
  function reconcile() {
    if (!joined || repairs.sub) return;
    const call = scope;
    if (call.reconciling) {
      call.reconcileAgain = true;
      return;
    }
    call.reconciling = true;
    void call
      .receive(() => syncSubs(call))
      // an error of a call that ended is no news
      .catch((error: unknown) => {
        if (call.ended) return;
        // the SFU ended this page's receiving session for good: the repair makes the connection and
        // the session anew, in its bounded tries, then one rejoin, then the page leaves and says so
        if (errorCode(error) === "CALL_SESSION_ENDED") return void repair("sub", true);
        receiveError = messageOf(error);
        fail(error);
      })
      .finally(() => {
        call.reconciling = false;
        if (!call.reconcileAgain || call.ended) return;
        call.reconcileAgain = false;
        reconcile();
      });
  }

  // ── simulcast: each camera tile takes the layer that fits it, 800 ms after its size settles ──
  const layerWanted = new Map<string, Rid>();
  const layerTimers = new Map<string, ReturnType<typeof setTimeout>>();
  function tileWidth(track: string | undefined, cssWidth: number) {
    if (!track?.endsWith(":camera")) return;
    layerWanted.set(track, layerFor(cssWidth, devicePixelRatio));
    clearTimeout(layerTimers.get(track));
    layerTimers.set(
      track,
      setTimeout(() => {
        const call = scope;
        void call
          .receive(async () => {
            const s = subscribed.get(track);
            const rid = layerWanted.get(track);
            if (!joined || !sub || !s || !rid || s.rid === rid) return;
            const answer = await signal({ layer: track, mid: s.mid, rid }, call);
            call.signal.throwIfAborted();
            await answerOffer(sub, answer.sdp, call);
            s.rid = rid;
          })
          .catch(() => {});
      }, 800),
    );
  }

  // ── repair of a connection that fails mid-call ──
  const repairs: Partial<Record<"pub" | "sub", true>> = {};
  const WHICH = { pub: "sending", sub: "receiving" } as const;
  const currentPc = (which: "pub" | "sub") => (which === "pub" ? pub?.pc : sub?.pc);
  function guard(pc: RTCPeerConnection, which: "pub" | "sub") {
    let wasConnected = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "connected") wasConnected = true;
      clearTimeout(timer);
      if (!joined || currentPc(which) !== pc) return;
      const need = repairNeed(pc.connectionState, wasConnected);
      if (need === "repair") void repair(which);
      if (need === "wait")
        timer = setTimeout(() => {
          if (joined && currentPc(which) === pc && pc.connectionState === "disconnected")
            void repair(which);
        }, REPAIR.disconnectedMs);
    });
  }
  /** `sessionEnded`: the SFU ended the session (a 410), so a connection that still says it is
   *  connected is not healed: the loop makes it anew. */
  async function repair(which: "pub" | "sub", sessionEnded = false) {
    if (repairs[which] || !joined) return;
    const call = scope;
    repairs[which] = true;
    const result = await repairLoop({
      // and while the browser is offline, until it is online again: a try with no network is wasted
      sleep: async (ms) => {
        await new Promise((resolve) => setTimeout(resolve, ms));
        if (!navigator.onLine && !call.ended)
          await new Promise((resolve) => {
            addEventListener("online", resolve, { once: true, signal: call.signal });
            call.signal.addEventListener("abort", resolve, { once: true });
          });
      },
      stale: () => call.ended || !joined,
      healed: () => !sessionEnded && currentPc(which)?.connectionState === "connected",
      step: ({ attempt }) =>
        set({
          repair: `Your ${WHICH[which]} connection was lost. Repairing it: try ${attempt} of ${REPAIR.waitsMs.length}.`,
        }),
      attempt: async () => {
        if (!relay.on) await getIce(call);
        await (which === "pub" ? rebuildPub(call) : rebuildSub(call));
      },
    });
    // a repair of a call that ended (also during its last try): the next call's state is not its
    // own to clear
    if (result.outcome === "stopped" || call.ended) return;
    delete repairs[which];
    set({ repair: "" });
    if (result.outcome === "succeeded") say(`Your ${WHICH[which]} connection is repaired.`);
    // repaired, or well again by itself: the error its failure said is over
    if (result.outcome !== "gave-up" && which === "sub" && ui.error === receiveError)
      set({ error: "" });
    if (result.outcome !== "gave-up" || call.rejoining || !joined) return;
    await rejoinOnce(`Your ${WHICH[which]} connection could not be repaired (${result.reason})`);
  }
  /** The one automatic rejoin until the person presses Join again: a repair's, or the out-of-touch
   *  one. The next one leaves the call and says why. */
  async function rejoinOnce(why: string) {
    if (rejoinSpent) {
      fail(`${why}. Press Join to try again.`);
      await leave();
      return;
    }
    rejoinSpent = true;
    say(`${why}, so this page joins the call afresh.`);
    await rejoin();
  }
  /** A new sending connection and session: what this page sent, sent again on it (the microphone,
   *  then the camera, the screen and the voice agent's voice, as they were). */
  function rebuildPub(call: CallScope) {
    return call.send(async () => {
      if (!joined) throw new Error("the call ended");
      // each step of this call's repair, only while it is the call: never into the next one
      call.signal.throwIfAborted();
      // the call closes the old sending session, and makes a new one at the next publish
      await signal({ reset: "pub" }, call);
      call.signal.throwIfAborted();
      pub?.pc.close();
      pub = null;
      const micTrack = mic?.getAudioTracks()[0];
      if (micTrack) await send(micTrack, "mic", call);
      for (const kind of ["camera", "screen"] as const) {
        const source = local[kind];
        call.signal.throwIfAborted();
        if (source) source.tx = await send(source.track, kind, call);
      }
      // the voice agent's voice, while it is the same invite's: one sent away meanwhile is not
      const invite = ai.invite;
      const same = () => ai.invite === invite && ai.state !== "off";
      call.signal.throwIfAborted();
      if (ai.track && same()) {
        const tx = await send(ai.track, "ai", call);
        if (same()) ai.tx = tx;
        else await unpublish("ai", tx, pub!, call);
      }
    });
  }
  /** A new receiving connection and session, and every subscription made again on it. */
  function rebuildSub(call: CallScope) {
    return call.receive(async () => {
      sub?.pc.close();
      sub = null;
      dropSubs();
      // the call closes the old receiving session, and makes a new one at the next subscribe
      call.signal.throwIfAborted();
      await signal({ reset: "sub" }, call);
      await syncSubs(call);
    });
  }

  // ── THE VOICE AGENT, when this tab hosts it ──
  const ai: {
    state: CallUi["ai"];
    /** The invite under way or done: its work goes on only while it is this one. */
    /** This invite: its id names it to the call (its claim, its own stop). */
    invite: { id: string } | null;
    claimed: boolean;
    pc: RTCPeerConnection | null;
    events: RTCDataChannel | null;
    context: AudioContext | null;
    mix: MediaStreamAudioDestinationNode | null;
    micNode: MediaStreamAudioSourceNode | null;
    sources: Map<string, MediaStreamAudioSourceNode>;
    audio: HTMLAudioElement | null;
    track: MediaStreamTrack | null;
    tx: RTCRtpTransceiver | null;
    startedAt: number;
    lastSpeechAt: number;
    /** What the voice model heard and said, line by line: the voice agent's own lines go to the
     *  call once finished, and the last of both go with a delegation. */
    lines: { id: string; who: "heard" | "agent"; text: string; at: number; posted: boolean }[];
  } = {
    state: "off",
    invite: null,
    claimed: false,
    pc: null,
    events: null,
    context: null,
    mix: null,
    micNode: null,
    sources: new Map(),
    audio: null,
    track: null,
    tx: null,
    startedAt: 0,
    lastSpeechAt: 0,
    lines: [],
  };
  const setAi = (state: CallUi["ai"]) => {
    ai.state = state;
    set({ ai: state });
  };
  /** Every other PERSON's voice goes into the agent's mix; the agent's own voice never does. */
  function aiMix() {
    if (!ai.context || !ai.mix) return;
    const voices = new Map<string, MediaStream>();
    for (const [mid, player] of players)
      if (!player.video && player.track.endsWith(":mic")) voices.set(mid, player.stream);
    for (const [mid, node] of ai.sources)
      if (!voices.has(mid)) {
        node.disconnect();
        ai.sources.delete(mid);
      }
    for (const [mid, stream] of voices) {
      if (ai.sources.has(mid)) continue;
      const node = ai.context.createMediaStreamSource(stream);
      node.connect(ai.mix);
      ai.sources.set(mid, node);
    }
  }
  /** Invite the voice agent, hosted by this tab (a member's: the call refuses anyone else). Why it
   *  did not come is `ui.aiRefusal`: a refusal the call answers as such (no key, a spent credit,
   *  another host) with the call's own words and marks. */
  /** The last voice agent start this page asked of the call: its call, and its answer (or
   *  failure). A later call's admission is another row's, so it waits for none of it. */
  let aiStart: { call: CallScope; answered: Promise<void> } | null = null;
  async function aiInvite() {
    const call = scope;
    // a press while the microphone is still on its way to the call waits for it
    await call.send.settled();
    // one start of this page at the call at a time: an invite after a dismiss waits for the
    // dismissed one's answer, so the call's list of withdrawn invites always holds the one
    // under way (call/rules.ts)
    if (aiStart?.call === call) await aiStart.answered;
    if (call.ended || ai.state !== "off" || !joined) return;
    // a page that only listens has no microphone for the voice agent to hear
    if (!mic) return say("Unmute first: the voice agent hears your microphone.");
    if (!pub) return;
    const invite = { id: crypto.randomUUID() };
    const current = () => ai.invite === invite;
    ai.invite = invite;
    let refused: VoiceRefusal | null = null;
    set({ aiRefusal: null });
    setAi("starting");
    ai.startedAt = ai.lastSpeechAt = Date.now();
    try {
      const context = (ai.context = new AudioContext());
      await context.resume().catch(() => {});
      const mix = (ai.mix = context.createMediaStreamDestination());
      ai.micNode = context.createMediaStreamSource(mic);
      ai.micNode.connect(mix);
      aiMix();
      const pc = (ai.pc = new RTCPeerConnection(iceConfig()));
      // not repaired: a new connection would be a new paid session
      pc.addEventListener("connectionstatechange", () => {
        if (ai.pc === pc && ai.state === "on" && pc.connectionState === "failed")
          void aiStop("its connection failed");
      });
      pc.addTrack(mix.stream.getAudioTracks()[0]!, mix.stream);
      pc.addEventListener("track", (event) => {
        if (!current()) return;
        // the agent's voice: played here once, and published into the call for everyone else
        const audio = Object.assign(new Audio(), {
          autoplay: true,
          srcObject: new MediaStream([event.track]),
        });
        ai.audio = audio;
        sinkOf(audio);
        play(audio);
        ai.track = event.track;
        void call
          .send(async () => {
            // an agent that left before its turn on the queue is not sent (a stop ends its invite)
            if (!current() || !pub) return;
            const sending = pub;
            const tx = await publishTrack(event.track, "ai", call);
            // and one that left while its voice was offered goes out again on this turn
            if (current()) ai.tx = tx;
            else await unpublish("ai", tx, sending, call);
          })
          .catch((error: unknown) => {
            if (!call.ended)
              fail(`The voice agent's voice could not be sent to the call: ${messageOf(error)}`);
          });
      });
      const events = (ai.events = pc.createDataChannel("oai-events"));
      events.addEventListener("message", ({ data }: MessageEvent) => {
        let event: {
          type?: string;
          delta?: unknown;
          error?: { message?: string };
          delegation?: { id?: unknown; target?: unknown };
        } = {};
        try {
          event = JSON.parse(String(data));
        } catch {
          // not JSON: nothing to read
        }
        if (heardSpeech(event)) ai.lastSpeechAt = Date.now();
        // THE MODEL DELEGATES: its one way out, which this tab carries to the call and back
        if (event.type === "session.delegation.created" && event.delegation?.target === "client")
          void delegate(String(event.delegation.id || ""));
        if (
          (event.type === "session.input_transcript.delta" ||
            event.type === "session.output_transcript.delta") &&
          typeof event.delta === "string"
        )
          heard(event.type.includes("output") ? "agent" : "heard", event.delta);
        if (event.type === "error")
          say(`OpenAI reported: ${String(event.error?.message || "an error").slice(0, 160)}`);
      });
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      // an invite that ended while it gathered (a stop, a leave, a new call) asks for no agent
      if (!current() || call.ended) return;
      const asking = facet(
        "voiceAgent",
        page,
        { start: pc.localDescription!.sdp, invite: invite.id },
        call.admission,
      );
      aiStart = {
        call,
        answered: asking.then(
          () => {},
          () => {},
        ),
      };
      const answer = VoiceAnswer.parse(await asking);
      // a refusal that is expected (no key, a spent credit, another host) is an answer
      if (answer.error) {
        refused = { message: answer.error, credit: answer.credit, noKey: answer.noKey };
        throw new Error(answer.error);
      }
      if (!current()) return;
      // the call's agent is this tab's from here: its stop is this tab's to say
      ai.claimed = true;
      await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp || "" });
      await connectedPath(pc, "The voice agent", () => relay.on, call.signal);
      // a stop while it connected (the host left) keeps it off
      if (current() && ui.ai === "starting") setAi("on");
    } catch (error) {
      // an invite that ended (a stop, a leave) has nothing of its own to close: what it made was
      // closed with it, and another invite may stand now
      if (!current()) return;
      await aiStop("it could not join", { quiet: true });
      if (!call.ended) set({ aiRefusal: refused || { message: messageOf(error) } });
    }
  }
  /** The open delegations of this tab, each waiting for its answer in the call's live state. */
  const answers = new Map<
    string,
    (done: { status: string; answer?: string; reason?: string }) => void
  >();
  /** A delegation of the model: the call puts the request on the agent's log, with what the model
   *  heard and said lately, and the answer comes back in the live state (`sync`), 90 s at most.
   *  The model gets the answer to say, or plain words that none came. */
  async function delegate(id: string) {
    const call = scope;
    if (!id || answers.has(id) || call.ended) return;
    const tell = (content: string) => {
      if (ai.events?.readyState === "open")
        ai.events.send(
          JSON.stringify({
            type: "session.commentary.append",
            event_id: crypto.randomUUID(),
            delegation_id: id,
            content,
          }),
        );
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const settled = new Promise<{ status: string; answer?: string; reason?: string }>((resolve) => {
      answers.set(id, resolve);
      timer = setTimeout(() => resolve({ status: "failed", reason: "no answer in 90 s" }), 90_000);
    });
    const transcript = ai.lines
      .map((line) => `${line.who === "agent" ? "voice agent" : "room"}: ${line.text.trim()}`)
      .join("\n")
      .slice(-4_000);
    try {
      const asked = DelegateAnswer.parse(
        await facet("delegate", page, { delegation: id, transcript }, call.admission),
      );
      if (asked.error)
        return tell(`The agent could not be asked (${asked.error}). Say that plainly.`);
      const done = await settled;
      if (done.status === "answered" && done.answer) tell(done.answer);
      else
        tell(`The agent gave no answer (${done.reason || "it took too long"}). Say that plainly.`);
    } catch (error) {
      tell(`The agent could not be reached (${messageOf(error)}). Say that plainly.`);
    } finally {
      if (timer) clearTimeout(timer);
      answers.delete(id);
    }
  }
  /** Words of the voice model: a line goes on while its speaker goes on, within 4 s. */
  function heard(who: "heard" | "agent", words: string) {
    const last = ai.lines.at(-1);
    if (last?.who === who && Date.now() - last.at < 4_000) {
      last.text += words;
      last.at = Date.now();
    } else
      ai.lines.push({ id: crypto.randomUUID(), who, text: words, at: Date.now(), posted: false });
    postAiLines();
    if (ai.lines.length > 60) ai.lines.shift();
  }
  /** What the voice agent said goes to the call from its host alone, each line once it is done: a
   *  newer line began, no word came for 4 s, or (`all`) it stops. What it heard is never posted:
   *  each person's own page posts their words. */
  function postAiLines(all = false) {
    ai.lines.forEach((line, at) => {
      const done = all || at < ai.lines.length - 1 || Date.now() - line.at >= 4_000;
      if (line.who !== "agent" || line.posted || !done || !line.text.trim()) return;
      line.posted = true;
      said({ id: line.id, text: line.text.trim(), ai: true });
    });
  }
  /** Everything this tab holds for the voice agent, closed at once, its session at OpenAI first (it
   *  bills while it runs). Answers what the call must still hear of: its published voice, and
   *  whether the call's agent was this tab's. */
  function aiClose() {
    const was = { tx: ai.tx, claimed: ai.claimed };
    ai.lines = [];
    for (const resolve of answers.values())
      resolve({ status: "failed", reason: "the voice agent left" });
    try {
      if (ai.events?.readyState === "open")
        ai.events.send(JSON.stringify({ type: "session.close" }));
    } catch {
      // the channel broke: the connection's close below ends the session too
    }
    ai.pc?.close();
    // the mix's own output track, which the agent heard
    for (const track of ai.mix?.stream.getTracks() ?? []) track.stop();
    ai.audio?.pause();
    for (const node of ai.sources.values()) node.disconnect();
    ai.sources.clear();
    void ai.context?.close().catch(() => {});
    Object.assign(ai, {
      invite: null,
      claimed: false,
      pc: null,
      events: null,
      context: null,
      mix: null,
      micNode: null,
      audio: null,
      track: null,
      tx: null,
    });
    if (ai.state !== "off") setAi("off");
    return was;
  }
  async function aiStop(why: string, { quiet = false } = {}) {
    if (ai.state === "off") return;
    // a start under way may have claimed the agent already: its stop goes too
    const starting = ai.state === "starting";
    const invite = ai.invite?.id;
    // what the voice agent said last goes to the call before its lines are dropped
    if (ai.claimed) postAiLines(true);
    const { tx, claimed } = aiClose();
    // its voice leaves the call on the sending queue, behind an offer that may be under way
    const sending = pub;
    const call = scope;
    if (tx && sending) void call.send(() => unpublish("ai", tx, sending, call)).catch(() => {});
    // this invite's agent alone (`withdraw`): another invite's stays, and a start that comes after
    // its stop claims nothing (call/rules.ts). A claimed one says `stop` too, which a call from
    // before `withdraw` reads as the plain stop of its (this tab's) agent; an unclaimed one does
    // not, so such a call sends away nobody's agent.
    // the voice agent's last lines reach the call before its stop, while this page still hosts it
    await saidQueue;
    const stop = claimed ? { stop: why, withdraw: invite } : { withdraw: invite, why };
    if (joined && invite && (claimed || starting))
      await facet("voiceAgent", page, stop, call.admission).catch(() => {});
    if (!quiet) say(`The voice agent left: ${why}.`);
  }

  // ── CAPTIONS: this page's own microphone, transcribed; each finished line to the call ──
  const FRAME_SAMPLES = 2_400; // 100 ms at 24,000 Hz
  const STT_WAITS_MS = [1_000, 2_000, 4_000, 8_000];
  /** Tries in a row before the page stops and says so: joining again starts afresh. */
  const STT_TRIES = 8;
  type Turn = { id: string; appended: boolean; itemId: string | null };
  const cap: {
    audio: AudioContext | null;
    samples: Float32Array[];
    count: number;
    detector: TurnDetector<Float32Array>;
    ws: WebSocket | null;
    on: boolean;
    fails: number;
    retry: ReturnType<typeof setTimeout> | null;
    turn: Turn | null;
    committed: Turn[];
    items: Map<string, Turn>;
  } = {
    audio: null,
    samples: [],
    count: 0,
    detector: new TurnDetector(),
    ws: null,
    on: false,
    fails: 0,
    retry: null,
    turn: null,
    committed: [],
    items: new Map(),
  };
  const captions = (status: CallUi["captions"]["status"], text: string) => {
    if (ui.captions.status !== status || ui.captions.text !== text)
      set({ captions: { status, text } });
  };
  /** The microphone's samples at 24,000 Hz, through a worklet, in frames of 100 ms. A browser with
   *  no AudioWorklet transcribes nothing, and says so. */
  async function startAudio() {
    if (cap.audio || !mic) return;
    if (!("AudioWorkletNode" in globalThis))
      return captions("off", "This browser cannot capture audio for transcription.");
    const stream = mic;
    const context = (cap.audio = new AudioContext({ sampleRate: 24_000 }));
    const module = URL.createObjectURL(new Blob([TAP], { type: "text/javascript" }));
    try {
      await context.audioWorklet.addModule(module);
      if (cap.audio !== context) return; // left meanwhile
      const tap = new AudioWorkletNode(context, "call-tap");
      // the worklet runs only when it leads somewhere: a silent sink
      const sink = context.createGain();
      sink.gain.value = 0;
      context
        .createMediaStreamSource(stream)
        .connect(tap)
        .connect(sink)
        .connect(context.destination);
      tap.port.onmessage = ({ data }: MessageEvent<Float32Array>) => onSamples(data);
      await context.resume().catch(() => {});
    } catch (error) {
      if (cap.audio === context) stopAudio();
      captions(
        "error",
        `The microphone could not be read for transcription (${messageOf(error)}).`,
      );
    } finally {
      URL.revokeObjectURL(module);
    }
  }
  function stopAudio() {
    void cap.audio?.close().catch(() => {});
    cap.audio = null;
    cap.samples = [];
    cap.count = 0;
  }
  /** A block from the worklet, gathered into a frame of 100 ms, through the voice detection. */
  function onSamples(block: Float32Array) {
    cap.samples.push(block);
    cap.count += block.length;
    if (cap.count < FRAME_SAMPLES || !joined) return;
    const data = new Float32Array(cap.count);
    let at = 0;
    for (const part of cap.samples) {
      data.set(part, at);
      at += part.length;
    }
    cap.samples = [];
    cap.count = 0;
    const rms = mic?.getAudioTracks()[0]?.enabled ? rmsOf(data) : 0;
    for (const action of cap.detector.push({ rms, ms: data.length / 24, data })) {
      if (action.type === "start")
        cap.turn = { id: crypto.randomUUID(), appended: false, itemId: null };
      else if (action.type === "send") for (const frame of action.frames) append(frame.data);
      else commitTurn();
    }
  }
  const sttOpen = () => cap.ws?.readyState === WebSocket.OPEN && cap.on;
  function append(samples: Float32Array) {
    if (!cap.turn || !sttOpen()) return;
    cap.ws!.send(
      JSON.stringify({ type: "input_audio_buffer.append", audio: pcm16Base64(samples) }),
    );
    cap.turn.appended = true;
  }
  /** The turn is over: what was sent of it is committed (never an empty buffer, which the model
   *  calls an error), and its line comes later. */
  function commitTurn() {
    const turn = cap.turn;
    cap.turn = null;
    if (!turn?.appended || !sttOpen()) return;
    cap.ws!.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    if (!turn.itemId) cap.committed.push(turn);
  }
  /** Which turn an event of the model is about: an item, once seen, keeps its turn. */
  function turnOf(itemId: unknown, committed = false) {
    if (typeof itemId !== "string" || !itemId) return null;
    let turn: Turn | null = cap.items.get(itemId) || null;
    if (!turn) {
      turn = cap.committed.shift() || (committed ? null : cap.turn);
      if (!turn) return null;
      turn.itemId = itemId;
      cap.items.set(itemId, turn);
    } else if (committed) cap.committed = cap.committed.filter((one) => one !== turn);
    return turn;
  }
  function onSttMessage(event: {
    type?: string;
    item_id?: unknown;
    transcript?: unknown;
    error?: { code?: string; message?: string };
  }) {
    if (event.type === "session.created") {
      cap.on = true;
      cap.fails = 0;
      captions("listening", "What you say is transcribed for the agent.");
    } else if (event.type === "input_audio_buffer.committed") turnOf(event.item_id, true);
    else if (event.type === "conversation.item.input_audio_transcription.completed") {
      const turn = turnOf(event.item_id, true);
      if (!turn) return;
      cap.items.delete(turn.itemId!);
      const text = String(event.transcript || "").trim();
      if (text) said({ id: turn.id, text });
    } else if (event.type === "error")
      captions(
        "error",
        `The transcription service reported an error (${String(event.error?.code || event.error?.message || "unknown").slice(0, 60)}).`,
      );
  }
  /** A transcription session: a new key from the call for each connection. */
  async function startStt() {
    if (cap.retry) clearTimeout(cap.retry);
    cap.retry = null;
    const call = scope;
    if (!joined || cap.ws || !cap.audio || ui.muted) return;
    if (ui.captions.status !== "error") captions("connecting", "Connecting the transcription.");
    const answer: TranscriptionAnswer = await facet("transcription", page, call.admission)
      .then((value) => TranscriptionAnswer.parse(value))
      .catch((error: unknown) => ({ error: messageOf(error) }));
    // the call ended, the microphone was muted, or another session opened meanwhile
    if (call.ended || !joined || cap.ws || !cap.audio || ui.muted) return;
    // no key, or a spent credit: nothing a retry mends
    if (answer.noKey || answer.credit)
      return captions("off", `${answer.error} What you say is not transcribed.`);
    if (!answer.key || !answer.url) {
      captions("error", `The transcription could not start (${answer.error || "no key"}).`);
      return retryStt();
    }
    const ws = (cap.ws = new WebSocket(answer.url, [
      "realtime",
      `openai-insecure-api-key.${answer.key}`,
    ]));
    ws.onmessage = ({ data }: MessageEvent) => {
      if (cap.ws !== ws) return;
      try {
        onSttMessage(JSON.parse(String(data)));
      } catch {
        // not JSON: nothing to read
      }
    };
    ws.onclose = () => {
      if (cap.ws !== ws) return;
      endSession();
      if (!joined) return;
      captions("connecting", "The transcription lost its connection. Connecting again.");
      retryStt();
    };
  }
  function retryStt() {
    if (cap.fails >= STT_TRIES)
      return captions(
        "error",
        `The transcription failed ${STT_TRIES} times in a row, so it stopped. Join the call again to try again.`,
      );
    cap.retry = setTimeout(
      () => void startStt(),
      STT_WAITS_MS[Math.min(cap.fails, STT_WAITS_MS.length - 1)],
    );
    cap.fails += 1;
  }
  /** The session is gone: a turn open or waiting for its line is lost with it. */
  function endSession() {
    cap.turn = null;
    cap.detector.reset();
    cap.committed = [];
    cap.items.clear();
    cap.ws = null;
    cap.on = false;
  }
  function stopCaptions() {
    if (cap.retry) clearTimeout(cap.retry);
    cap.retry = null;
    const ws = cap.ws;
    if (ws) {
      ws.onclose = ws.onmessage = null;
      ws.close();
    }
    endSession();
    stopAudio();
    cap.fails = 0;
    captions("off", "");
  }
  /** The captions follow the microphone: on while this page is in the call and not muted, off
   *  otherwise. */
  function captionsOn() {
    if (joined && !ui.muted) void startAudio().then(startStt);
    else stopCaptions();
  }
  /** Lines go to the call one at a time, in order. A line the call did not take is said once. */
  let saidQueue: Promise<unknown> = Promise.resolve();
  function said(line: { id: string; text: string; ai?: true }) {
    // under the admission of the call that heard it: a line queued just before a stop or a leave
    // is still sent, before that stop or leave, and the facet refuses one of an earlier admission
    const call = scope;
    saidQueue = saidQueue
      .then(() => facet("said", page, line, call.admission))
      .catch((error: unknown) => {
        if (!call.ended)
          say(`A line of the transcript did not reach the agent: ${messageOf(error)}`);
      });
  }

  /** The first Unmute of a page that only listened: the microphone opens now, by the person's
   *  press, and is published then, as the page's first track or beside its camera or screen. The
   *  bar shows the press at work (`unmuting`); a microphone that cannot be opened or sent leaves the
   *  page muted, and says why. */
  function micOn() {
    const call = scope;
    if (!joined || mic || ui.unmuting) return;
    set({ unmuting: true });
    return call
      .send(async () => {
        if (!joined || mic) return;
        let stream: MediaStream;
        try {
          stream = await openMedia("mic", deviceId("mic"), call);
        } catch (error) {
          say(
            nameOf(error) === "NotAllowedError"
              ? "The browser did not give this page the microphone. Allow it for this site, then press Unmute again."
              : `No microphone could be opened (${messageOf(error)}).`,
          );
          return;
        }
        const release = call.own(() => stopTracks(stream));
        try {
          call.signal.throwIfAborted();
          await send(stream.getAudioTracks()[0]!, "mic", call);
          call.signal.throwIfAborted();
        } catch (error) {
          if (!call.ended) {
            stopTracks(stream);
            say(`The microphone could not be sent, so you are still muted (${messageOf(error)}).`);
          }
          return;
        } finally {
          release();
        }
        mic = stream;
        watchMic();
        set({ muted: false });
        captionsOn();
        renderDevices();
      })
      .finally(() => {
        if (!call.ended) set({ unmuting: false });
      });
  }

  // ── the call itself ──
  /** Into the call. A person's own press joins unmuted. A rejoin hands over the microphone it had
   *  (`kept`): from this function's first line the call owns it, so every path that does not take
   *  it stops it, and its mute is the track's own at the hand-over. The camera and the screen stay
   *  off until the person turns them on: capture starts only by the person's own act.
   *
   *  `listenOnly`: a join that no press of the person's made (a page opened with `call=join`). It
   *  opens no microphone and sends nothing: the page has no sending connection, and shows the call
   *  as muted. The person's first Unmute opens the microphone and publishes it (`micOn`). */
  /** `orListen`: a microphone the browser refuses, or that is not there, does not keep the page
   *  out. It joins listening, and says why it sends no sound. */
  async function join(kept?: MediaStream | null, listenOnly = false, orListen = false) {
    const call = scope;
    if (joined || ui.joining) {
      stopTracks(kept);
      return;
    }
    set({ error: "", notice: "", aiRefusal: null, joining: true });
    let joinSettled!: () => void;
    const wait = (joining = new Promise<void>((resolve) => (joinSettled = resolve)));
    try {
      // the microphone first: the call hears of this page once it can be heard, and a refused
      // microphone tells nobody anything
      let noMic = false;
      const stream =
        kept ||
        (listenOnly
          ? null
          : await openMedia("mic", deviceId("mic"), call).catch((error: unknown) => {
              if (!orListen || call.ended || !NO_MIC.includes(nameOf(error))) throw error;
              noMic = true;
              return null;
            }));
      const release = call.own(() => stopTracks(stream));
      call.signal.throwIfAborted();
      mic = stream;
      release();
      const track = stream?.getAudioTracks()[0];
      if (stream && !kept) watchMic();
      // the chosen speaker, once the list says which it is, for the sound already playing too
      void listDevices().then(async () => {
        if (devices.sinkOk) await useSpeaker(deviceId("speaker"));
      });
      // in the call, and the relay's credentials, in one call
      call.joinSent = true;
      const asked = facet("join", page, { admit: call.admission, seq: call.seq });
      // whatever the join answers once a leave or a dispose ended the call, the facet may have
      // taken the page in after that leave: this admission's leave again (a newer one outlives it)
      const leaveIfEnded = () => {
        if (call.ended) void facet("leave", page, call.admission).catch(() => {});
      };
      asked.then(leaveIfEnded, leaveIfEnded);
      // and a dispose does not wait for an answer that may never come
      const answer = JoinAnswer.parse(await call.until(asked, () => {}));
      call.signal.throwIfAborted();
      useIce(answer);
      if (!relay.on) say("No TURN relay: this page connects over UDP alone.");
      joined = true;
      joinedAt = Date.now();
      set({ joined: true, muted: !track?.enabled });
      if (noMic)
        fail(
          "The browser did not give this page the microphone, so you only listen. Allow it for this site, then press Unmute.",
        );
      // on the sending queue: a camera, a screen or a voice agent pressed meanwhile waits for it
      await call.send(async () => {
        // listening only: nothing to send until the person's first Unmute, camera or screen
        if (!mic) return;
        let sent = mic.getAudioTracks()[0]!;
        // the kept microphone ended meanwhile (unplugged while the call took the page in): the
        // default stands in, with the mute it had
        if (sent.readyState === "ended") {
          const fresh = await openMedia("mic", "", call);
          const releaseFresh = call.own(() => stopTracks(fresh));
          call.signal.throwIfAborted();
          const next = fresh.getAudioTracks()[0]!;
          next.enabled = !ui.muted;
          stopTracks(mic);
          mic = fresh;
          releaseFresh();
          watchMic();
          say("Your microphone went away: the browser's default is used now.");
          sent = next;
        }
        await publish(sent, "mic", call);
      });
      reconcile();
      captionsOn();
    } catch (error) {
      // a leave or a dispose ended this call: it closed everything, and there is nothing to say
      if (call.ended) return;
      fail(
        nameOf(error) === "NotAllowedError"
          ? "The browser did not give this page the microphone. Allow it for this site, then join again."
          : error,
      );
      await leave();
    } finally {
      joinSettled();
      if (joining === wait) joining = null;
      // an ended call's join: teardown said it is over, and a newer join may be under way
      if (!call.ended) set({ joining: false });
    }
  }
  /** Everything this page holds for the call, closed; the call is told nothing. */
  function teardown() {
    joined = false;
    epoch += 1;
    switchingTo = null;
    scope.end();
    scope = callScope();
    aiClose();
    stopCaptions();
    if (relay.refresh) clearTimeout(relay.refresh);
    for (const timer of layerTimers.values()) clearTimeout(timer);
    layerTimers.clear();
    removeEventListener("click", replay, { capture: true });
    soundHeld = false;
    delete repairs.pub;
    delete repairs.sub;
    pub?.pc.close();
    sub?.pc.close();
    stopTracks(mic);
    for (const kind of ["camera", "screen"] as const) {
      local[kind]?.track.stop();
      delete local[kind];
    }
    dropSubs();
    pub = null;
    sub = null;
    mic = null;
    paths.pub = null;
    paths.sub = null;
    set({ joined: false, joining: false, muted: false, unmuting: false, net: "", repair: "" });
  }
  /** Out: everything here closes at once, the voice agent's session at OpenAI first; then the call
   *  hears of it, the agent's stop first. */
  async function leave() {
    const call = scope;
    // out before the call hears it: a live state that says "not in the call" while the leave is
    // on its way is the leave itself, never a reason to join again
    if (ai.claimed) postAiLines(true);
    teardown();
    // a Mac that sends for this page stops with it
    void stopMacs();
    // the voice agent's last lines (queued above) reach the call before the leave that ends it
    await saidQueue;
    // then the call hears it, at once: the leave of this call's admission, which a newer one
    // outlives, and which ends the voice agent this page hosted (call/rules.ts `#remove`). One
    // whose join is still on its way takes it out as soon as the facet takes it in.
    if (call.joinSent) await facet("leave", page, call.admission).catch(() => {});
  }
  async function rejoin() {
    const call = scope;
    call.rejoining = true;
    try {
      const { camera, screen } = ui;
      await aiStop("its host joined again", { quiet: true });
      // a leave or a dispose came while the agent stopped: nothing of this call reaches the next
      if (call.ended) return;
      // the call closes this page's sending and receiving sessions, so the join below makes new
      // ones: a broken connection's session takes no new offer. A page the call took for out
      // has no sessions there, and the call refuses the reset: nothing to do.
      await Promise.all(
        (["pub", "sub"] as const).map((which) => signal({ reset: which }, call).catch(() => {})),
      );
      // a leave or a dispose came first: the page stays out
      if (call.ended) return;
      // the microphone goes to the next call, which owns it from here: a browser that asks each
      // time does not ask in the middle of a call
      const kept = mic;
      mic = null;
      teardown();
      const next = scope;
      // a page that only listened listens again: no microphone opens without the person's press
      await join(kept, !kept);
      // the new admission did not come in: the earlier one's row goes, by its own leave (which
      // removes nothing once a newer admission has the row)
      if (!joined) void facet("leave", page, call.admission).catch(() => {});
      // the notice is the next call's own: a later call hears nothing of this rejoin
      if (scope === next && joined && (camera || screen)) {
        const what =
          camera && screen ? "camera and screen are" : camera ? "camera is" : "screen is";
        say(
          `This page joined the call again. Your ${what} off until you turn ${camera && screen ? "them" : "it"} on.`,
        );
      }
    } finally {
      call.rejoining = false;
    }
  }

  /** Each live state of the call: the subscriptions follow it, a host that was sent away closes
   *  its session, and a page that the call took for gone joins afresh. */
  async function sync(next: CallView, known = true) {
    view = next;
    // a read sent before the join answered may still say "not in the call"; and no live state at
    // all (`known` false) says nothing of who is in it, so it never makes the page join again
    if (
      known &&
      joined &&
      !next.me.inCall &&
      !scope.rejoining &&
      !ui.joining &&
      Date.now() - joinedAt > 5_000
    ) {
      await rejoinOnce("This page was out of touch with the call");
      return;
    }
    reconcile();
    aiMix();
    if (ai.state === "on") postAiLines();
    // the answer to this tab's delegation, once the call has it
    const delegation = next.delegation;
    if (delegation && delegation.status !== "waiting") answers.get(delegation.id)?.(delegation);
    if (known && ai.state === "on" && next.hostPage !== page && Date.now() - ai.startedAt > 8_000)
      void aiStop("it was sent away");
    else if (ai.state === "on" && Date.now() - ai.lastSpeechAt > AI_IDLE_MS)
      void aiStop(`nobody spoke for ${AI_IDLE_MS / 60_000} minutes`);
    // the network line: which path each connection takes, and its round trip
    if (!joined) return;
    const parts = await Promise.all(
      (["pub", "sub"] as const).map(async (which) => {
        const connection = which === "pub" ? pub : sub;
        if (!connection) return "";
        const pair = await selectedPair(connection.pc).catch(() => null);
        if (pair) paths[which] = pair;
        const seen = paths[which];
        if (!seen) return "";
        return `${WHICH[which]}: ${seen.path ? PATH_TEXT[seen.path] : "?"}${seen.rttMs == null ? "" : `, ${seen.rttMs} ms`}`;
      }),
    );
    const net = parts.filter(Boolean).join(" · ") || "Connecting…";
    if (net !== ui.net) set({ net });
  }

  return {
    get ui() {
      return ui;
    },
    subscribe(listener: (ui: CallUi) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    sync,
    /** The person's own Join: a repair may again join afresh once. `listenOnly`: a join with no
     *  microphone: nothing is sent until the person's Unmute. `orListen`: a refused microphone
     *  joins listening, and says so, rather than keep the person out. A lobby hands over what it
     *  opened (`mic`, whose track's `enabled` is the mute; `camera`): the call owns them from
     *  here, and the browser is not asked again. */
    join: async ({
      listenOnly = false,
      orListen = false,
      mic: given = null,
      camera = null,
    }: {
      listenOnly?: boolean;
      orListen?: boolean;
      mic?: MediaStream | null;
      camera?: MediaStream | null;
    } = {}) => {
      rejoinSpent = false;
      if (joined || ui.joining) {
        stopTracks(given);
        stopTracks(camera);
        return;
      }
      await join(given, listenOnly && !given, orListen);
      // a lobby's microphone is new to the call: an unplug is watched as a fresh one's is
      if (given && joined && mic === given) watchMic();
      if (!camera) return;
      if (joined) await videoOn("camera", camera);
      else stopTracks(camera);
    },
    /** A number that changes at each teardown (a Leave, a dispose, a new call): a press that waited
     *  for something (a Start's enable) joins only while it is the same. */
    get epoch() {
      return epoch;
    },
    leave,
    toggleMute() {
      const track = mic?.getAudioTracks()[0];
      // a page that only listens: this press is the person's own act, which opens the microphone
      if (!track) return void micOn();
      track.enabled = !track.enabled;
      // a microphone being switched in takes the same mute
      if (switchingTo) switchingTo.enabled = track.enabled;
      set({ muted: !track.enabled });
      // transcription only while the microphone is on: a mute closes the session, which bills
      captionsOn();
    },
    // a press while the kind's picker is open is an Off: the picture it chooses is not sent
    // the page's own camera or screen on: a Mac that sends that kind for this page stops
    toggleCamera: () =>
      local.camera || scope.capturing.camera
        ? videoOff("camera")
        : (macs.chosen.camera && void chooseMac("camera", ""), videoOn("camera")),
    toggleScreen: () =>
      local.screen || scope.capturing.screen
        ? videoOff("screen")
        : (macs.chosen.screen && void chooseMac("screen", ""), videoOn("screen")),
    chooseDevice,
    /** A member's Mac's camera or screen, by the picker's value; "" stops the Mac's. */
    chooseMac,
    listDevices,
    tileWidth,
    aiInvite,
    /** Send the voice agent away: this tab's own, or another tab's (the call tells its host). */
    aiDismiss: () =>
      ai.state === "off"
        ? facet("voiceAgent", page, { stop: "sent away" }, scope.admission).then(() => {}, fail)
        : aiStop("sent away"),
    /** A notice in the call's words (`ui.notice`), from the page that holds the call. */
    say,
    /** An error in the call's words (`ui.error`), from the page that holds the call: a start
     *  that failed. */
    fail,
    dismiss: () => set({ error: "", notice: "", aiRefusal: null }),
    /** This page's row is gone, or the page closes: everything the call held here closes (the
     *  voice agent's session at OpenAI first, as it bills). Joining again is the person's press. */
    dispose: () => {
      const call = scope;
      // the voice agent's last lines, queued before everything closes, reach the call before the
      // leave, as at a Leave (a page that closes may not live to send them)
      if (ai.claimed) postAiLines(true);
      teardown();
      void stopMacs();
      if (call.joinSent)
        void saidQueue.then(() => facet("leave", page, call.admission)).catch(() => {});
    },
  };
}
export type CallEngine = ReturnType<typeof createCall>;

/** What a page holds the call through: a member's context (`itx.cd(agent)`) or a guest's view of
 *  it. Both take one call of one method of a facet as an itx expression. */
export type CallContext = { invoke(expression: unknown, ...args: unknown[]): Promise<unknown> };

/**
 * THE CALL FOR A PAGE: the engine for this page, what it draws, and the call's live state, parsed.
 *
 *   const log = useIterateContext(stub, AgentChat.contextOptions);
 *   const { call, ui, live } = useCall(stub, log.subscription, log.liveState.call?.value);
 *
 * `context` is the agent's context as the page holds it (a member's stub or a guest's view);
 * `page` is this page's own subscription row on it (`useIterateContext(…).subscription`), which the
 * call knows the page by; `liveValue` is the call facet's live state as it comes. A new row (the
 * page's socket came back) is a new page to the call: the old engine closes, and joining again is
 * the person's own press, which the new engine's notice asks for when the old one was in the call.
 * `call` is null until there is a context and a row; `live` is undefined until the call's live
 * state is there and parses.
 */
export function useCall(
  context: CallContext | undefined,
  page: string | undefined,
  liveValue: unknown,
) {
  const live = useMemo(() => {
    const parsed = CallLive.safeParse(liveValue);
    return parsed.success ? parsed.data : undefined;
  }, [liveValue]);
  const call = useMemo(
    () =>
      context && page
        ? createCall({
            facet: (method, ...args) =>
              context.invoke(["itx", "facets", ["get", "call"], [method, ...args]]),
            invoke: (expression) => context.invoke(expression),
            page,
          })
        : null,
    [context, page],
  );
  // the engine of the last row was in the call: the new one says how to come back
  const wasIn = useRef(false);
  useEffect(() => {
    if (!call) return;
    if (wasIn.current)
      call.say(
        "The connection to the mind came back as a new session, so this page left the call. Press Join to come back into it.",
      );
    wasIn.current = false;
    return () => {
      wasIn.current = call.ui.joined;
      call.dispose();
    };
  }, [call]);
  // the page closes: the voice agent's session ends at OpenAI at once
  useEffect(() => {
    if (!call) return;
    const closing = () => call.dispose();
    addEventListener("pagehide", closing);
    return () => removeEventListener("pagehide", closing);
  }, [call]);
  const subscribe = useCallback(
    (listener: (ui: CallUi) => void) => call?.subscribe(listener) ?? (() => {}),
    [call],
  );
  const ui = useSyncExternalStore(
    subscribe,
    () => call?.ui || IDLE,
    () => IDLE,
  );
  // each live state of the call, and every 5 s for the network line
  useEffect(() => {
    if (!call || !page) return;
    const known = Boolean(live);
    void call.sync(viewOf(live, page), known);
    const timer = setInterval(() => void call.sync(viewOf(live, page), known), 5_000);
    return () => clearInterval(timer);
  }, [call, live, page]);
  return { call, ui, live };
}
