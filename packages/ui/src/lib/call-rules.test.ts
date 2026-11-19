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
  pathOf,
  pickDevice,
  repairLoop,
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

test("the view: this page in the call or not, every page by its row, a guest marked, and the voice agent's host page", () => {
  const live = CallLive.parse({
    ...FRESH,
    since: 1,
    inCall: {
      "page-a": { who: { actor: "member:ana", name: "Ana" }, tracks: { mic: 1, camera: 2 } },
      "page-b": { who: { actor: "guest:bo", name: "Bo", kind: "guest" }, tracks: { mic: 1 } },
    },
    voiceAgent: { host: { actor: "member:ana", name: "Ana" }, page: "page-a", since: 1, until: 2 },
  });
  expect(viewOf(live, "page-b")).toEqual({
    me: { inCall: true },
    call: [
      { peer: "page-a", name: "Ana", tracks: { mic: 1, camera: 2 } },
      { peer: "page-b", name: "Bo (guest)", tracks: { mic: 1 } },
    ],
    hostPage: "page-a",
  });
  expect(viewOf(undefined, "page-c")).toEqual({ me: { inCall: false }, call: [], hostPage: null });
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
