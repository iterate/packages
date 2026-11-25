// The pure rules of a call in a page: Join on a fresh call, the view the engine follows, the path a
// page takes, the ICE servers, a saved device, the repair loop, and the simulcast layers.
import { expect, test } from "vitest";
import {
  CallLive,
  callChanges,
  cameraLayers,
  iceServersOf,
  joinable,
  layerFor,
  lendCall,
  liveMacs,
  macOwner,
  macSources,
  pathOf,
  pcm16Base64,
  pickDevice,
  repairLoop,
  rmsOf,
  TurnDetector,
  udpOnly,
  viewOf,
} from "./call-rules.ts";

/** A call's live state as the facet answers it right after a page turned it on: nobody in it, and
 *  its setup not read yet. */
const FRESH = { since: null, inCall: {}, voiceAgent: null, setup: null, links: [] };

test("Join can be pressed on a fresh call, whose setup is not read yet, and not on a mind with no SFU app", () => {
  expect(joinable(CallLive.parse(FRESH))).toBe(true);
  expect(joinable(undefined)).toBe(true);
  const noSfu = CallLive.parse({ ...FRESH, setup: { sfu: false, turn: true, voice: true } });
  expect(joinable(noSfu)).toBe(false);
  const ready = CallLive.parse({ ...FRESH, setup: { sfu: true, turn: false, voice: false } });
  expect(joinable(ready)).toBe(true);
});

test("who came and who left, a guest marked, and the voice agent, in words", () => {
  const ana = { who: { actor: "/members/a", name: "Ana" }, tracks: { mic: 1 } };
  const bo = { who: { actor: "/guests/b", name: "Bo", kind: "guest" }, tracks: { mic: 1 } };
  const agent = { host: ana.who, page: "a", since: 1, until: 2 };
  const before = CallLive.parse({ ...FRESH, inCall: { a: ana } });
  const after = CallLive.parse({ ...FRESH, inCall: { b: bo }, voiceAgent: agent });
  expect(callChanges(before, after)).toEqual([
    "Bo (guest) joined the call.",
    "Ana left the call.",
    "The voice agent joined the call.",
  ]);
  expect(callChanges(after, after)).toEqual([]);
  // a state not read yet says nothing
  expect(callChanges(after, undefined)).toEqual([]);
  expect(callChanges(undefined, after)).toEqual([]);
});

test("the view: this page in the call or not, every page by its row, a guest marked, the voice agent's host page and its last request", () => {
  const live = CallLive.parse({
    ...FRESH,
    since: 1,
    inCall: {
      "page-a": { who: { actor: "member:ana", name: "Ana" }, tracks: { mic: 1, camera: 2 } },
      "page-b": { who: { actor: "guest:bo", name: "Bo", kind: "guest" }, tracks: { mic: 1 } },
    },
    voiceAgent: { host: { actor: "member:ana", name: "Ana" }, page: "page-a", since: 1, until: 2 },
    delegation: { id: "del_1", status: "answered", answer: "At three." },
  });
  expect(viewOf(live, "page-b")).toEqual({
    me: { inCall: true },
    call: [
      { peer: "page-a", name: "Ana", tracks: { mic: 1, camera: 2 } },
      { peer: "page-b", name: "Bo (guest)", tracks: { mic: 1 } },
    ],
    hostPage: "page-a",
    delegation: { id: "del_1", status: "answered", answer: "At three." },
  });
  expect(viewOf(undefined, "page-c")).toEqual({
    me: { inCall: false },
    call: [],
    hostPage: null,
    delegation: null,
  });
  // a page named as a prototype's key is not in the call
  for (const page of ["constructor", "__proto__", "toString"])
    expect(viewOf(live, page)).toMatchObject({ me: { inCall: false } });
});

test("the path: a relay candidate is TURN by how the page reaches it; TCP straight to the SFU is never offered", () => {
  expect(pathOf({ candidateType: "relay", relayProtocol: "tls" })).toBe("turn-tls");
  expect(pathOf({ candidateType: "relay", url: "turns:turn.cloudflare.com:443" })).toBe("turn-tls");
  expect(pathOf({ candidateType: "host", protocol: "udp" })).toBe("udp-direct");
  expect(pathOf({ candidateType: "host", protocol: "tcp" })).toBe("tcp-direct");
  const sdp = [
    "v=0",
    "a=candidate:1 1 udp 2122260223 10.0.0.1 5000 typ host",
    "a=candidate:2 1 tcp 1500000000 10.0.0.1 9 typ host tcptype active",
  ].join("\r\n");
  expect(udpOnly(sdp).split("\r\n")).toEqual([
    "v=0",
    "a=candidate:1 1 udp 2122260223 10.0.0.1 5000 typ host",
  ]);
});

test("ICE: Cloudflare's STUN always, the TURN servers the join answered, and no URL on port 53", () => {
  const servers = iceServersOf([
    {
      urls: ["turn:turn.cloudflare.com:3478", "turn:turn.cloudflare.com:53", "stun:x"],
      username: "u",
      credential: "c",
    },
    { urls: ["turn:turn.cloudflare.com:53?transport=udp"] },
  ]);
  expect(servers).toEqual([
    { urls: "stun:stun.cloudflare.com:3478" },
    { urls: ["turn:turn.cloudflare.com:3478"], username: "u", credential: "c" },
  ]);
});

test("a saved device is found by its id, else by its label, else the browser's default", () => {
  const devices = [
    { kind: "audioinput" as const, deviceId: "default", label: "Default" },
    { kind: "audioinput" as const, deviceId: "new-id", label: "Desk mic" },
  ];
  expect(pickDevice(devices, "mic", { id: "new-id" })).toBe("new-id");
  expect(pickDevice(devices, "mic", { id: "old-id", label: "Desk mic" })).toBe("new-id");
  expect(pickDevice(devices, "mic", { id: "old-id", label: "Gone" })).toBe("");
  expect(pickDevice(devices, "mic", null)).toBe("");
});

test("repair: a bounded number of tries, stopped when the call ends, and a reason when it gives up", async () => {
  const sleep = async () => {};
  let tries = 0;
  const gaveUp = await repairLoop({
    sleep,
    waitsMs: [1, 1, 1],
    attempt: async () => {
      tries += 1;
      throw new Error(`no path ${tries}`);
    },
  });
  expect(gaveUp).toEqual({ outcome: "gave-up", tries: 3, reason: "no path 3" });
  expect(await repairLoop({ sleep, attempt: async () => {} })).toMatchObject({
    outcome: "succeeded",
    tries: 1,
  });
  expect(await repairLoop({ sleep, stale: () => true, attempt: async () => {} })).toMatchObject({
    outcome: "stopped",
    tries: 0,
  });
});

test("simulcast: three layers for a wide camera, fewer for a narrow one, and each tile the layer that fits", () => {
  expect(cameraLayers(1280).map((layer) => layer.rid)).toEqual(["f", "h", "q"]);
  expect(cameraLayers(320).map((layer) => layer.rid)).toEqual(["q"]);
  expect(layerFor(200)).toBe("q");
  expect(layerFor(400)).toBe("h");
  expect(layerFor(400, 2)).toBe("f");
});

test("captions send speech alone: a turn opens on two loud frames with what came before, and ends after 700 ms of quiet", () => {
  const detector = new TurnDetector<string>();
  const frame = (data: string, rms: number) => ({ rms, ms: 100, data });
  const quiet = ["q1", "q2", "q3", "q4"].flatMap((data) => detector.push(frame(data, 0)));
  expect(quiet).toEqual([]);
  expect(detector.push(frame("l1", 0.1))).toEqual([]);
  // the 300 ms before the voice go with it
  expect(detector.push(frame("l2", 0.1))).toEqual([
    { type: "start" },
    {
      type: "send",
      frames: ["q2", "q3", "q4", "l1", "l2"].map((data) =>
        frame(data, data.startsWith("l") ? 0.1 : 0),
      ),
    },
  ]);
  const tail = ["t1", "t2", "t3", "t4", "t5", "t6", "t7"].map((data) =>
    detector.push(frame(data, 0)),
  );
  expect(tail.slice(0, 6).every((actions) => actions.length === 1)).toBe(true);
  expect(tail[6]).toEqual([{ type: "send", frames: [frame("t7", 0)] }, { type: "commit" }]);
  // a muted microphone is a level of 0: no new turn
  expect(detector.push(frame("m", 0))).toEqual([]);
});

test("a turn is committed at 40 s flat, and the next begins at once", () => {
  const detector = new TurnDetector<number>();
  const actions = Array.from({ length: 402 }, (_, at) =>
    detector.push({ rms: 0.1, ms: 100, data: at }),
  ).flat();
  expect(actions.filter((action) => action.type !== "send")).toEqual([
    { type: "start" },
    { type: "commit" },
    { type: "start" },
  ]);
});

test("the level and the audio as the model takes it", () => {
  expect(rmsOf(new Float32Array([0.5, -0.5]))).toBe(0.5);
  expect(rmsOf(new Float32Array(0))).toBe(0);
  // -1, 0 and 1 as little-endian PCM16
  expect(pcm16Base64(new Float32Array([-1, 0, 1]))).toBe(
    btoa(String.fromCharCode(0x00, 0x80, 0, 0, 0xff, 0x7f)),
  );
});

test("a member's Mac: a live lend whose device context a Mac app writes, whose newest device event is the member's", () => {
  const stubs = [
    "itx.jonas.mac",
    "itx.zaktop.macApp",
    "itx.phoneCalls",
    "subscription:sub-1",
    "itx.old.mac",
  ];
  const devices = [
    { path: "/devices/jonas.mac", eventCount: 10, eventTypes: { "device/presence-changed": 3 } },
    { path: "/devices/zaktop.macApp", eventCount: 4, eventTypes: { "device/presence-changed": 1 } },
    // a lend that is no Mac app's: no presence
    { path: "/devices/phoneCalls", eventTypes: { "events.iterate.com/itx/created": 1 } },
    // a Mac lent before, not now: no live stub
    { path: "/devices/misha.mac", eventTypes: { "device/presence-changed": 9 } },
  ];
  expect(liveMacs(stubs, devices)).toEqual([
    { lend: "jonas.mac", path: "/devices/jonas.mac", events: 10 },
    { lend: "zaktop.macApp", path: "/devices/zaktop.macApp", events: 4 },
  ]);
  expect(liveMacs([], devices)).toEqual([]);
  const mine = { principal: { actor: "user_jonas" } };
  expect(
    macOwner([
      { type: "device/app-focused", source: { principal: { actor: "user_misha" } } },
      { type: "device/mouse-moved", source: mine },
      // the kernel's own event, after it, decides nothing
      { type: "events.iterate.com/itx/woken", source: { principal: { actor: "system" } } },
    ]),
  ).toBe("user_jonas");
  expect(macOwner([{ type: "events.iterate.com/itx/woken" }])).toBeUndefined();
});

test("what a Mac offers a call: each display and the camera that are not Off and that macOS allows", () => {
  const state = {
    things: [
      {
        kind: "screen",
        name: "Built-in Retina Display",
        sharing: "shared",
        permitted: true,
        display: 0,
      },
      { kind: "screen", name: "Studio Display", sharing: "off", permitted: true, display: 1 },
      { kind: "screen", name: "Sidecar", sharing: "ask", permitted: true, display: 2 },
      { kind: "camera", name: "FaceTime HD Camera", sharing: "ask", permitted: true },
      { kind: "microphone", name: "Microphone", sharing: "shared", permitted: true },
    ],
  };
  expect(macSources("jonas.mac", state)).toEqual([
    {
      id: "mac:jonas.mac:camera",
      lend: "jonas.mac",
      kind: "camera",
      source: "camera",
      label: "Your Mac “jonas.mac” (iterate app): FaceTime HD Camera",
    },
    {
      id: "mac:jonas.mac:screen:0",
      lend: "jonas.mac",
      kind: "screen",
      source: "screen:0",
      label: "Your Mac “jonas.mac” (iterate app): Built-in Retina Display",
    },
    {
      id: "mac:jonas.mac:screen:2",
      lend: "jonas.mac",
      kind: "screen",
      source: "screen:2",
      label: "Your Mac “jonas.mac” (iterate app): Sidecar",
    },
  ]);
  const cameraOff = {
    things: [
      { kind: "camera", name: "C", sharing: "off" },
      { kind: "camera", name: "D", sharing: "shared", permitted: false },
    ],
  };
  expect(macSources("jonas.mac", cameraOff)).toEqual([]);
  expect(macSources("jonas.mac", { error: "not running" })).toEqual([]);
  expect(lendCall("jonas.mac", "publish", { source: "camera" })).toEqual([
    "itx",
    ["cd", "/"],
    "jonas",
    "mac",
    "call",
    ["publish", { source: "camera" }],
  ]);
});

test("a Mac's page is named for its owner: in the view and in who came and left", () => {
  const mac = { who: { actor: "member:jonas", name: "Jonas" }, tracks: { screen: 3 } };
  const before = CallLive.parse({ ...FRESH, inCall: {} });
  const after = CallLive.parse({ ...FRESH, inCall: { "mac-call-jonas-mac-ab12": mac } });
  expect(callChanges(before, after)).toEqual(["Jonas's Mac joined the call."]);
  expect(viewOf(after, "sub-1").call[0]?.name).toBe("Jonas's Mac");
});
