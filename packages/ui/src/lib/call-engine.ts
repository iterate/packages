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
// - REPAIR: a connection that fails, or stays disconnected for 5 s, is made anew, five tries at
//   most; then the page joins the call afresh, once.
// - SIMULCAST: the camera goes up in three layers; each tile takes the layer that fits its size.
// - CAPTURE STARTS ONLY BY THE PERSON'S OWN PRESS: a page that joins again by itself keeps the mute,
//   and its camera and screen stay off until the person turns them on.
// - THE VOICE AGENT: the member who invites it hosts it in their tab, which opens GPT-Live over
//   WebRTC with a session the call made. It hears a mix of the host's microphone and everyone the
//   host hears, and its voice is published into the call as the host's track `ai`.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  CallLive,
  cameraLayers,
  type CallView,
  type DeviceKind,
  deviceOptions,
  FIRST_LAYER,
  heardSpeech,
  iceServersOf,
  JoinAnswer,
  layerFor,
  type Path,
  PATH_TEXT,
  pathAccepted,
  pathOf,
  pickDevice,
  REPAIR,
  repairLoop,
  repairNeed,
  ridOf,
  type Rid,
  scaleFor,
  SignalAnswer,
  STUN,
  udpOnly,
  viewOf,
  VoiceAnswer,
} from "#/lib/call-rules.ts";

const CONNECT_TIMEOUT_MS = 12_000;
const MIC = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
// the camera at 1280×720 when it can: the full layer of its simulcast
const CAMERA = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24 } };
const DEVICES_KEY = "iterate-call-devices";
/** The voice agent leaves when nobody, person or agent, said anything for this long. */
const AI_IDLE_MS = 5 * 60_000;

/** One of the call facet's methods, called over the session the page holds. */
export type CallFacet = (method: string, ...args: unknown[]) => Promise<unknown>;
type Pair = { path: Path | null; rttMs: number | null };
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
  camera: boolean;
  screen: boolean;
  /** Which path each connection takes, and its round trip. */
  net: string;
  notice: string;
  error: string;
  repair: string;
  /** This tab hosts the voice agent: "starting", "on", or "off". */
  ai: "off" | "starting" | "on";
  devices: {
    mic: { id: string; label: string }[];
    camera: { id: string; label: string }[];
    speaker: { id: string; label: string }[];
    chosen: Record<DeviceKind, string>;
    speakerSupported: boolean;
  };
  videos: CallVideo[];
};
/** A refusal of the voice agent that the call answers as such: no key, a spent credit, another
 *  host. `json` holds the call's own words and marks. */
export type VoiceRefusal = Error & { json?: { error?: string; credit?: true; noKey?: true } };

const IDLE: CallUi = {
  joined: false,
  joining: false,
  muted: false,
  camera: false,
  screen: false,
  net: "",
  notice: "",
  error: "",
  repair: "",
  ai: "off",
  devices: {
    mic: [],
    camera: [],
    speaker: [],
    chosen: { mic: "", camera: "", speaker: "" },
    speakerSupported: true,
  },
  videos: [],
};

/** Wait for the page's candidates before an offer or answer goes out: until gathering is complete,
 *  2 s at most, and 300 ms after the first candidate that is not a host one. */
async function gathered(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    let soon: ReturnType<typeof setTimeout> | null = null;
    const done = () => {
      clearTimeout(timer);
      if (soon) clearTimeout(soon);
      resolve();
    };
    const timer = setTimeout(done, 2_000);
    pc.addEventListener("icegatheringstatechange", () => {
      if (pc.iceGatheringState === "complete") done();
    });
    pc.addEventListener("icecandidate", ({ candidate }) => {
      if (candidate?.type && candidate.type !== "host") soon ||= setTimeout(done, 300);
    });
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

/** Resolves once `pc` is connected on a path this page uses; throws a plain reason otherwise. */
async function connectedPath(pc: RTCPeerConnection, name: string, hasRelay: () => boolean) {
  const tried = hasRelay()
    ? "neither over UDP nor through Cloudflare's TURN relay"
    : "over UDP, and this page has no TURN relay";
  if (pc.connectionState !== "connected")
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `${name}: no connection to Cloudflare in ${CONNECT_TIMEOUT_MS / 1000} s, ${tried}.`,
            ),
          ),
        CONNECT_TIMEOUT_MS,
      );
      pc.addEventListener("connectionstatechange", () => {
        if (pc.connectionState === "connected") {
          clearTimeout(timer);
          resolve();
        }
        if (pc.connectionState === "failed") {
          clearTimeout(timer);
          reject(new Error(`${name}: no path to Cloudflare, ${tried}.`));
        }
      });
    });
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

/**
 * THE CALL OF ONE PAGE. `facet(method, ...args)` calls one of the call facet's methods (`join`,
 * `signal`, `leave`, `voiceAgent`). `page` is this page's own subscription row on the agent's
 * context: the call knows the page by it. The answer is the engine: `ui` (a new object at each
 * change), `subscribe(listener)`, the actions, and `sync(view)`, which `useCall` calls with each
 * live state of the call.
 */
export function createCall({ facet, page }: { facet: CallFacet; page: string }) {
  const listeners = new Set<(ui: CallUi) => void>();
  let ui = IDLE;
  const set = (patch: Partial<CallUi>) => {
    ui = { ...ui, ...patch };
    for (const listener of listeners) listener(ui);
  };
  const say = (notice: string) => set({ notice });
  const fail = (error: unknown) => set({ error: messageOf(error) });
  /** One step of the SFU's signalling, for this page. */
  const signal = async (step: Record<string, unknown>) =>
    SignalAnswer.parse(await facet("signal", page, step));

  // ── what this page holds ──
  let joined = false;
  let view: CallView | null = null;
  let mic: MediaStream | null = null;
  let pub: { pc: RTCPeerConnection; micTx: RTCRtpTransceiver } | null = null;
  let sub: { pc: RTCPeerConnection; connected: Promise<unknown> | null } | null = null;
  // a track ("<page>:<kind>") -> its subscription's mid, the number it was published under, its layer
  const subscribed = new Map<string, { mid: string; key: string | undefined; rid?: Rid }>();
  // a mid -> the track it carries, and what plays it
  const players = new Map<
    string,
    { track: string; element: HTMLMediaElement; stream: MediaStream; video: boolean }
  >();
  const local: Partial<
    Record<
      "camera" | "screen",
      { stream: MediaStream; track: MediaStreamTrack; tx: RTCRtpTransceiver; onEnded: () => void }
    >
  > = {};
  let pubQueue: Promise<unknown> = Promise.resolve();
  let subQueue: Promise<unknown> = Promise.resolve();
  const onPub = <T>(work: () => Promise<T>) => {
    const run = pubQueue.then(work);
    pubQueue = run.catch(() => {});
    return run;
  };
  const onSub = <T>(work: () => Promise<T>) => {
    const run = subQueue.then(work);
    subQueue = run.catch(() => {});
    return run;
  };
  let reconciling = false;
  let callGen = 0; // one number per call: a repair of an earlier call stops
  let rejoining = false;
  let joinedAt = 0;
  const paths: Record<"pub" | "sub", Pair | null> = { pub: null, sub: null };

  const videosChanged = () => {
    const videos: CallVideo[] = [];
    for (const kind of ["camera", "screen"] as const) {
      const own = local[kind];
      if (own)
        videos.push({ key: `local-${kind}`, name: "You", kind, stream: own.stream, local: true });
    }
    for (const [mid, player] of players) {
      if (!player.video) continue;
      const at = player.track.lastIndexOf(":");
      const owner = player.track.slice(0, at);
      videos.push({
        key: `mid-${mid}`,
        track: player.track,
        name: view?.call.find((one) => one.peer === owner)?.name ?? "Someone",
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
    relay.refresh = setTimeout(
      () => joined && void getIce(),
      Math.max(60, Number(answer?.ttlS) || 0) * 750,
    );
  }
  /** The credentials again: the call's `join` again. A failure keeps what the page has. */
  async function getIce() {
    useIce(JoinAnswer.safeParse(await facet("join", page).catch(() => null)).data ?? null);
  }

  // ── devices ──
  const devices: {
    list: MediaDeviceInfo[];
    saved: Partial<Record<DeviceKind, { id: string; label: string } | null>>;
    sinkOk: boolean;
    sink: string;
  } = {
    list: [],
    saved: (() => {
      try {
        return JSON.parse(localStorage.getItem(DEVICES_KEY) ?? "{}") || {};
      } catch {
        return {};
      }
    })(),
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
      },
    });
  async function listDevices() {
    devices.list = (await navigator.mediaDevices?.enumerateDevices?.().catch(() => null)) ?? [];
    renderDevices();
  }
  /** A device that cannot be opened by its id falls back to the browser's default, and says so. */
  async function openMedia(kind: "mic" | "camera", id: string) {
    const base = kind === "mic" ? MIC : CAMERA;
    const ask = (constraints: MediaTrackConstraints) =>
      navigator.mediaDevices.getUserMedia(
        kind === "mic" ? { audio: constraints } : { video: constraints },
      );
    if (!id) return ask(base);
    try {
      return await ask({ ...base, deviceId: { exact: id } });
    } catch (error) {
      const why = nameOf(error);
      if (
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
    return onPub(async () => {
      if (!joined || !mic) return;
      const before = mic;
      let stream: MediaStream;
      try {
        stream = await openMedia("mic", id);
      } catch (error) {
        say(`No microphone could be opened (${messageOf(error)}).`);
        return;
      }
      const track = stream.getAudioTracks()[0]!;
      track.enabled = !ui.muted;
      await pub?.micTx.sender.replaceTrack(track);
      mic = stream;
      watchMic();
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
    return onPub(async () => {
      const source = local.camera;
      if (!joined || !source) return;
      const stream = await openMedia("camera", id);
      const track = stream.getVideoTracks()[0]!;
      await source.tx.sender.replaceTrack(track);
      // the same layers, each scaled again for this camera's width
      const params = source.tx.sender.getParameters();
      for (const encoding of params.encodings || []) {
        const rid = ridOf(encoding.rid);
        if (rid) encoding.scaleResolutionDownBy = scaleFor(rid, track.getSettings().width);
      }
      await source.tx.sender.setParameters(params).catch(() => {});
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
      ...[...players.values()].filter((p) => !p.video).map((p) => p.element),
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
    const label = devices.list.find((d) => d.deviceId === id)?.label ?? "";
    devices.saved = { ...devices.saved, [kind]: id ? { id, label } : null };
    try {
      localStorage.setItem(DEVICES_KEY, JSON.stringify(devices.saved));
    } catch {
      // no storage: the choice lasts as long as the page
    }
    if (kind === "mic") await switchMic(id);
    else if (kind === "camera") await switchCamera(id).catch(fail);
    else await useSpeaker(id);
    renderDevices();
  }

  // ── sending ──
  /** The microphone, sent: muted from its first frame when `muted` (a rejoin keeps the mute). */
  async function publish(muted: boolean) {
    mic = await openMedia("mic", deviceId("mic"));
    mic.getAudioTracks()[0]!.enabled = !muted;
    watchMic();
    void listDevices().then(() => {
      devices.sink = devices.sinkOk ? deviceId("speaker") : "";
      renderDevices();
    });
    const pc = new RTCPeerConnection(iceConfig());
    guard(pc, "pub");
    const micTx = pc.addTransceiver(mic.getAudioTracks()[0]!, { direction: "sendonly" });
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    const answer = await signal({
      publish: "mic",
      mid: micTx.mid,
      sdp: udpOnly(pc.localDescription!.sdp),
    });
    await pc.setRemoteDescription({ type: "answer", sdp: udpOnly(answer.sdp || "") });
    pub = { pc, micTx };
    paths.pub = await connectedPath(pc, "Sending", () => relay.on);
  }
  /** One more track on the sending connection: its own sender, an offer, the SFU's answer. */
  async function publishTrack(track: MediaStreamTrack, kind: "camera" | "screen" | "ai") {
    const sending = pub!;
    const sendEncodings =
      kind === "camera"
        ? cameraLayers(track.getSettings().width)
        : kind === "screen"
          ? [{ maxBitrate: 1_500_000 }]
          : undefined;
    const tx = sending.pc.addTransceiver(track, { direction: "sendonly", sendEncodings });
    await sending.pc.setLocalDescription(await sending.pc.createOffer());
    await gathered(sending.pc);
    const answer = await signal({
      publish: kind,
      mid: tx.mid,
      sdp: udpOnly(sending.pc.localDescription!.sdp),
    });
    await sending.pc.setRemoteDescription({ type: "answer", sdp: udpOnly(answer.sdp || "") });
    return tx;
  }
  function videoOn(kind: "camera" | "screen") {
    return onPub(async () => {
      if (!joined || !pub || local[kind]) return;
      const stream =
        kind === "camera"
          ? await openMedia("camera", deviceId("camera"))
          : await navigator.mediaDevices.getDisplayMedia({
              video: { frameRate: { ideal: 15, max: 30 } },
              audio: false,
            });
      const track = stream.getVideoTracks()[0]!;
      const tx = await publishTrack(track, kind).catch((error: unknown) => {
        track.stop();
        throw error;
      });
      // the browser's own "Stop sharing", or a camera that went away, ends the share
      const onEnded = () => {
        if (local[kind]?.onEnded === onEnded) void videoOff(kind);
      };
      local[kind] = { stream, track, tx, onEnded };
      track.addEventListener("ended", onEnded);
      if (kind === "camera") void listDevices();
      videosChanged();
    }).catch((error: unknown) =>
      fail(
        nameOf(error) === "NotAllowedError"
          ? `The browser did not give this page the ${kind}.`
          : `No ${kind}: ${messageOf(error)}`,
      ),
    );
  }
  function videoOff(kind: "camera" | "screen") {
    return onPub(async () => {
      const source = local[kind];
      if (!source) return;
      delete local[kind];
      source.track.stop();
      videosChanged();
      if (pub) await signal({ unpublish: kind, mid: source.tx.mid }).catch(() => {});
      await source.tx.sender.replaceTrack(null).catch(() => {});
    }).catch(fail);
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
      const track = [...subscribed].find(([, s]) => s.mid === mid)?.[0] ?? "?";
      const stream = new MediaStream([event.track]);
      if (event.track.kind === "video") {
        const element = document.createElement("video");
        element.srcObject = stream;
        players.set(mid, { track, element, stream, video: true });
        videosChanged();
        return;
      }
      const element = Object.assign(new Audio(), { autoplay: true, srcObject: stream });
      sinkOf(element);
      element
        .play()
        .catch(() => say("The browser held back the sound: click anywhere on the page."));
      players.set(mid, { track, element, stream, video: false });
      aiMix();
    });
    sub = { pc, connected: null };
    return sub;
  }
  /** Answer the SFU's offer on the receiving connection. */
  async function answerOffer(s: { pc: RTCPeerConnection }, sdp: string | undefined) {
    if (!sdp) return;
    await s.pc.setRemoteDescription({ type: "offer", sdp: udpOnly(sdp) });
    await s.pc.setLocalDescription(await s.pc.createAnswer());
    await gathered(s.pc);
    await signal({ renegotiate: udpOnly(s.pc.localDescription!.sdp) });
  }
  function dropPlayer(mid: string) {
    players.get(mid)?.element.pause();
    players.delete(mid);
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
  async function syncSubs() {
    if (!joined) return;
    const want = wanted();
    const gone = [...subscribed].filter(([track, s]) => want.get(track) !== s.key);
    if (gone.length && sub) {
      await signal({ close: gone.map(([, s]) => s.mid) }).catch(() => {});
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
    const answer = await signal({ subscribe: fresh.map(([track]) => track), layers });
    for (const { track, mid } of answer.tracks || [])
      if (mid) subscribed.set(track, { mid, key: want.get(track), rid: layers[track] });
    await answerOffer(s, answer.sdp);
    s.connected ||= connectedPath(s.pc, "Receiving", () => relay.on).then(
      (pair) => (paths.sub = pair),
    );
    await s.connected;
  }
  function reconcile() {
    if (!joined || reconciling || repairs.sub) return;
    reconciling = true;
    void onSub(syncSubs)
      .catch(fail)
      .finally(() => (reconciling = false));
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
      setTimeout(
        () =>
          void onSub(async () => {
            const s = subscribed.get(track);
            const rid = layerWanted.get(track);
            if (!joined || !sub || !s || !rid || s.rid === rid) return;
            const answer = await signal({ layer: track, mid: s.mid, rid });
            await answerOffer(sub, answer.sdp);
            s.rid = rid;
          }).catch(() => {}),
        800,
      ),
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
  async function repair(which: "pub" | "sub") {
    if (repairs[which] || !joined) return;
    const gen = callGen;
    repairs[which] = true;
    const result = await repairLoop({
      // and while the browser is offline, until it is online again: a try with no network is wasted
      sleep: async (ms) => {
        await new Promise((resolve) => setTimeout(resolve, ms));
        if (!navigator.onLine && gen === callGen)
          await new Promise((resolve) => addEventListener("online", resolve, { once: true }));
      },
      stale: () => gen !== callGen || !joined,
      healed: () => currentPc(which)?.connectionState === "connected",
      step: ({ attempt }) =>
        set({
          repair: `Your ${WHICH[which]} connection was lost. Repairing it: try ${attempt} of ${REPAIR.waitsMs.length}.`,
        }),
      attempt: async () => {
        if (!relay.on) await getIce();
        await (which === "pub" ? rebuildPub(gen) : rebuildSub(gen));
      },
    });
    delete repairs[which];
    set({ repair: "" });
    if (result.outcome === "succeeded") say(`Your ${WHICH[which]} connection is repaired.`);
    if (result.outcome !== "gave-up" || rejoining || !joined) return;
    say(
      `Your ${WHICH[which]} connection could not be repaired (${result.reason}), so this page joins the call afresh.`,
    );
    await rejoin();
  }
  /** A new sending connection and session: the microphone, then the camera, the screen and the
   *  voice agent's voice, as they were. */
  function rebuildPub(gen: number) {
    return onPub(async () => {
      if (gen !== callGen || !mic) throw new Error("the call ended");
      const pc = new RTCPeerConnection(iceConfig());
      guard(pc, "pub");
      try {
        const micTx = pc.addTransceiver(mic.getAudioTracks()[0]!, { direction: "sendonly" });
        await pc.setLocalDescription(await pc.createOffer());
        await gathered(pc);
        // the call closes the old sending session and makes a new one at this publish
        await signal({ reset: "pub" });
        const answer = await signal({
          publish: "mic",
          mid: micTx.mid,
          sdp: udpOnly(pc.localDescription!.sdp),
        });
        await pc.setRemoteDescription({ type: "answer", sdp: udpOnly(answer.sdp || "") });
        pub?.pc.close();
        pub = { pc, micTx };
        paths.pub = await connectedPath(pc, "Sending", () => relay.on);
        for (const kind of ["camera", "screen"] as const) {
          const source = local[kind];
          if (source) source.tx = await publishTrack(source.track, kind);
        }
        if (ai.track && ai.state !== "off") ai.tx = await publishTrack(ai.track, "ai");
      } catch (error) {
        pc.close();
        throw error;
      }
    });
  }
  /** A new receiving connection and session, and every subscription made again on it. */
  function rebuildSub(gen: number) {
    return onSub(async () => {
      if (gen !== callGen) throw new Error("the call ended");
      sub?.pc.close();
      sub = null;
      dropSubs();
      // the call closes the old receiving session, and makes a new one at the next subscribe
      await signal({ reset: "sub" });
      ensureSub();
      await syncSubs();
    });
  }

  // ── THE VOICE AGENT, when this tab hosts it ──
  const ai: {
    state: CallUi["ai"];
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
  } = {
    state: "off",
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
  /** Invite the voice agent, hosted by this tab (a member's: the call refuses anyone else). A
   *  refusal the call answers as such (no key, a spent credit, another host) throws a
   *  `VoiceRefusal` with the call's own words in `json`. */
  async function aiInvite() {
    if (ai.state !== "off" || !joined || !pub || !mic) return;
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
        // the agent's voice: played here once, and published into the call for everyone else
        const audio = Object.assign(new Audio(), {
          autoplay: true,
          srcObject: new MediaStream([event.track]),
        });
        ai.audio = audio;
        sinkOf(audio);
        audio.play().catch(() => {});
        ai.track = event.track;
        void onPub(async () => {
          ai.tx = await publishTrack(event.track, "ai");
        }).catch((error: unknown) =>
          fail(`The voice agent's voice could not be sent to the call: ${messageOf(error)}`),
        );
      });
      const events = (ai.events = pc.createDataChannel("oai-events"));
      events.addEventListener("message", ({ data }: MessageEvent) => {
        let event: { type?: string; delta?: unknown; error?: { message?: string } } = {};
        try {
          event = JSON.parse(String(data));
        } catch {
          // not JSON: nothing to read
        }
        if (heardSpeech(event)) ai.lastSpeechAt = Date.now();
        if (event.type === "error")
          say(`OpenAI reported: ${String(event.error?.message || "an error").slice(0, 160)}`);
      });
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      const answer = VoiceAnswer.parse(
        await facet("voiceAgent", page, { start: pc.localDescription!.sdp }),
      );
      // a refusal that is expected (no key, a spent credit, another host) is an answer
      if (answer.error) throw Object.assign(new Error(answer.error), { json: answer });
      // the call's agent is this tab's from here: its stop is this tab's to say
      ai.claimed = true;
      await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp || "" });
      await connectedPath(pc, "The voice agent", () => relay.on);
      // a stop while it connected (the host left) keeps it off
      if (ui.ai === "starting") setAi("on");
    } catch (error) {
      await aiStop("it could not join", { quiet: true });
      throw error;
    }
  }
  async function aiStop(why: string, { quiet = false } = {}) {
    if (ai.state === "off") return;
    setAi("off");
    // end the session at OpenAI first: it bills while it runs
    if (ai.events?.readyState === "open") ai.events.send(JSON.stringify({ type: "session.close" }));
    ai.pc?.close();
    ai.audio?.pause();
    const tx = ai.tx;
    if (tx && pub) {
      await signal({ unpublish: "ai", mid: tx.mid }).catch(() => {});
      await tx.sender.replaceTrack(null).catch(() => {});
    }
    for (const node of ai.sources.values()) node.disconnect();
    ai.sources.clear();
    await ai.context?.close().catch(() => {});
    Object.assign(ai, {
      pc: null,
      events: null,
      context: null,
      mix: null,
      micNode: null,
      audio: null,
      track: null,
      tx: null,
    });
    // a claim that failed was never this tab's: the call undid it, and another tab's agent stays
    if (joined && ai.claimed) await facet("voiceAgent", page, { stop: why }).catch(() => {});
    ai.claimed = false;
    if (!quiet) say(`The voice agent left: ${why}.`);
  }

  // ── the call itself ──
  /** Into the call. A person's own press joins unmuted; a rejoin (`muted` as it was) keeps the
   *  mute, and the camera and the screen stay off until the person turns them on: capture starts
   *  only by the person's own act. */
  async function join({ muted = false } = {}) {
    if (joined || ui.joining) return;
    set({ error: "", notice: "", joining: true });
    try {
      // in the call, and the relay's credentials, in one call
      useIce(JoinAnswer.parse(await facet("join", page)));
      if (!relay.on) say("No TURN relay: this page connects over UDP alone.");
      joined = true;
      joinedAt = Date.now();
      callGen += 1;
      set({ joined: true, muted });
      await publish(muted);
      reconcile();
    } catch (error) {
      fail(
        nameOf(error) === "NotAllowedError"
          ? "The browser did not give this page the microphone. Allow it for this site, then join again."
          : error,
      );
      await leave();
    } finally {
      set({ joining: false });
    }
  }
  /** Everything this page holds for the call, closed; the call is told nothing. */
  function teardown() {
    joined = false;
    callGen += 1;
    if (relay.refresh) clearTimeout(relay.refresh);
    delete repairs.pub;
    delete repairs.sub;
    pub?.pc.close();
    sub?.pc.close();
    for (const track of mic?.getTracks() ?? []) track.stop();
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
    set({ joined: false, muted: false, net: "", repair: "" });
  }
  async function leave() {
    await aiStop("its host left", { quiet: true });
    // out before the call hears it: a live state that says "not in the call" while the leave is
    // on its way is the leave itself, never a reason to join again
    const wasIn = joined;
    joined = false;
    callGen += 1;
    if (wasIn) await facet("leave", page).catch(() => {});
    teardown();
  }
  async function rejoin() {
    rejoining = true;
    const { muted, camera, screen } = ui;
    await aiStop("its host joined again", { quiet: true });
    // the call closes this page's sending and receiving sessions, so the join below makes new
    // ones: a broken connection's session takes no new offer. A page the call took for out
    // has no sessions there, and the call refuses the reset: nothing to do.
    for (const which of ["pub", "sub"] as const) await signal({ reset: which }).catch(() => {});
    teardown();
    await join({ muted });
    if (camera || screen) {
      const what = camera && screen ? "camera and screen are" : camera ? "camera is" : "screen is";
      say(
        `This page joined the call again. Your ${what} off until you turn ${camera && screen ? "them" : "it"} on.`,
      );
    }
    rejoining = false;
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
      !rejoining &&
      !ui.joining &&
      Date.now() - joinedAt > 5_000
    ) {
      say("This page was out of touch, so it joins the call again.");
      await rejoin();
      return;
    }
    reconcile();
    aiMix();
    if (known && ai.state === "on" && next.hostPage !== page && Date.now() - ai.startedAt > 8_000)
      void aiStop("it was sent away");
    else if (ai.state === "on" && Date.now() - ai.lastSpeechAt > AI_IDLE_MS)
      void aiStop(`nobody spoke for ${AI_IDLE_MS / 60_000} minutes`);
    // the network line: which path each connection takes, and its round trip
    if (!joined) return;
    const parts: string[] = [];
    for (const which of ["pub", "sub"] as const) {
      const connection = which === "pub" ? pub : sub;
      if (!connection) continue;
      const pair = await selectedPair(connection.pc).catch(() => null);
      if (pair) paths[which] = pair;
      const known = paths[which];
      if (known)
        parts.push(
          `${WHICH[which]}: ${known.path ? PATH_TEXT[known.path] : "?"}${known.rttMs == null ? "" : `, ${known.rttMs} ms`}`,
        );
    }
    const net = parts.join(" · ") || "Connecting…";
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
    join: () => join(),
    leave,
    toggleMute() {
      const track = mic?.getAudioTracks()[0];
      if (!track) return;
      track.enabled = !track.enabled;
      set({ muted: !track.enabled });
    },
    toggleCamera: () => (local.camera ? videoOff("camera") : videoOn("camera")),
    toggleScreen: () => (local.screen ? videoOff("screen") : videoOn("screen")),
    chooseDevice,
    listDevices,
    tileWidth,
    aiInvite,
    /** Send the voice agent away: this tab's own, or another tab's (the call tells its host). */
    aiDismiss: () =>
      ai.state === "off" ? facet("voiceAgent", page, { stop: "sent away" }) : aiStop("sent away"),
    dismiss: () => set({ error: "", notice: "" }),
    /** This page's row is gone, or the page closes: everything the call held here closes (the
     *  voice agent's session at OpenAI first, as it bills). Joining again is the person's press. */
    dispose() {
      if (ai.events?.readyState === "open")
        ai.events.send(JSON.stringify({ type: "session.close" }));
      ai.pc?.close();
      teardown();
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
 * the person's own press. `call` is null until there is a context and a row; `live` is undefined
 * until the call's live state is there and parses.
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
            page,
          })
        : null,
    [context, page],
  );
  useEffect(() => () => call?.dispose(), [call]);
  // the page closes: the voice agent's session ends at OpenAI at once
  useEffect(() => {
    if (!call) return;
    const closing = () => call.dispose();
    addEventListener("pagehide", closing);
    return () => removeEventListener("pagehide", closing);
  }, [call]);
  const ui = useSyncExternalStore(
    (listener) => call?.subscribe(listener) ?? (() => {}),
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
