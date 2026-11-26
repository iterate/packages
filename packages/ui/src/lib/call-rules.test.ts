// The pure rules of a call in a page: Join on a fresh call, the view the engine follows, the path a
// page takes, the ICE servers, a saved device, the repair loop, and the simulcast layers.
import { expect, test, vi } from "vitest";
import {
  browserTargets,
  CallLive,
  callChanges,
  cdpInput,
  keyEvents,
  lendMethod,
  liveChromes,
  macCallPage,
  macLabel,
  macTargets,
  modsOf,
  newestOffer,
  newestOwner,
  nextBatch,
  offerFromState,
  onMac,
  pictureRect,
  pointOn,
  publicationOf,
  cameraLayers,
  iceServersOf,
  joinable,
  layerFor,
  lineOutbox,
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
  UNSENT,
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
    offer: null,
  });
  // the voice agent offered to a page is that page's offer alone
  const offered = CallLive.parse({
    since: 1,
    inCall: {},
    voiceAgent: null,
    setup: null,
    voiceOffer: { id: "offer-1", page: "page-b", why: "take-over" },
  });
  expect(viewOf(offered, "page-b")).toMatchObject({ offer: "offer-1" });
  expect(viewOf(offered, "page-a")).toMatchObject({ offer: null });
  expect(viewOf(undefined, "page-c")).toEqual({
    me: { inCall: false },
    call: [],
    hostPage: null,
    delegation: null,
    offer: null,
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

// ── DRIVE ──
test("the newest offer on a device's context wins, and a withdrawal is an offer of nothing", () => {
  const withdrawn = { kind: "mac", lend: "jonas.mac", control: null, why: "the app quits" };
  expect(newestOffer([offerOf(OFFER, undefined, 3), { type: "device/app-focused" }])).toEqual({
    offset: 3,
    fact: OFFER,
    owner: "jonas@nustom.com",
  });
  expect(
    newestOffer([offerOf(OFFER, undefined, 3), offerOf(withdrawn, undefined, 9)])?.fact,
  ).toEqual(withdrawn);
  expect(newestOffer([{ type: "device/presence-changed", payload: {} }])).toBeUndefined();
  // a payload that is no offer is passed over
  expect(
    newestOffer([offerOf(OFFER, undefined, 3), offerOf({ lend: 1 }, undefined, 4)])?.offset,
  ).toBe(3);
});

test("a Mac is named by its owner when its lend begins with the owner's name, else by its lend", () => {
  expect(macLabel("jonas.mac", "jonas@nustom.com")).toBe("Jonas's Mac");
  expect(macLabel("zaktop.macApp", "zak@nustom.com")).toBe("zaktop");
  expect(macLabel("misha.mac", "")).toBe("misha");
});

test("the Drive menu lists each offered Mac whose lend is live, one entry for each display", () => {
  const offers = new Map([
    ["jonas.mac", { fact: OFFER as never, owner: "jonas@nustom.com" }],
    [
      "zaktop.macApp",
      {
        fact: {
          ...OFFER,
          lend: "zaktop.macApp",
          control: "shared",
          displays: [
            { display: 0, name: "Built-in", screen: "shared" },
            { display: 1, name: "LG", screen: "ask" },
          ],
        } as never,
        owner: "zak@nustom.com",
      },
    ],
    ["gone.mac", { fact: OFFER as never, owner: "" }],
    ["off.mac", { fact: { ...OFFER, control: null } as never, owner: "" }],
  ]);
  const stubs = ["itx.jonas.mac", "itx.zaktop.macApp", "itx.off.mac", "subscription:sub-1"];
  expect(macTargets(stubs, offers)).toEqual([
    {
      id: "drive:jonas.mac:0",
      kind: "mac",
      lend: "jonas.mac",
      label: "Jonas's Mac",
      display: 0,
      control: "ask",
    },
    {
      id: "drive:zaktop.macApp:0",
      kind: "mac",
      lend: "zaktop.macApp",
      label: "zaktop: Built-in",
      display: 0,
      control: "shared",
    },
    {
      id: "drive:zaktop.macApp:1",
      kind: "mac",
      lend: "zaktop.macApp",
      label: "zaktop: LG",
      display: 1,
      control: "shared",
    },
  ]);
});

test("each tab of a lent Chrome may be driven, named by its person and its title", () => {
  const chromes = liveChromes(["itx.chrome.jonas.mac2926", "itx.jonas.mac", "itx.chrome.misha.x1"]);
  expect(chromes.map((one) => one.lend)).toEqual(["chrome.jonas.mac2926", "chrome.misha.x1"]);
  const tabs = new Map<string, unknown>([
    ["chrome.jonas.mac2926", [{ id: 4, url: "https://a.example", title: "Docs" }]],
    ["chrome.misha.x1", { error: "not lent" }],
  ]);
  expect(browserTargets(chromes, tabs)).toEqual([
    {
      id: "drive:chrome.jonas.mac2926:tab:4",
      kind: "browser",
      lend: "chrome.jonas.mac2926",
      label: "Jonas's Chrome: Docs",
      tab: 4,
    },
  ]);
  const twins = liveChromes(["itx.chrome.jonas.a1", "itx.chrome.jonas.b2"]);
  expect(
    browserTargets(twins, new Map([["chrome.jonas.b2", [{ id: 1, title: "T" }]]]))[0]?.label,
  ).toBe("Jonas's Chrome (b2): T");
});

test("a Mac's screen in the call is the page the Mac app names for its publication", () => {
  expect(macCallPage("jonas.mac", "ab12cd34")).toBe("mac-call-jonas-mac-ab12cd34");
  const state = { publications: [{ publication: "p1", context: "/agents/x", source: "screen:0" }] };
  expect(publicationOf(state, "/agents/x", "screen:0")).toBe("p1");
  expect(publicationOf(state, "/agents/x", "screen:1")).toBeUndefined();
  expect(publicationOf({ error: "x" }, "/agents/x", "screen:0")).toBeUndefined();
  expect(lendMethod("jonas.mac", "control.input", { session: "s" })).toEqual([
    "itx",
    ["cd", "/"],
    "jonas",
    "mac",
    "control",
    ["input", { session: "s" }],
  ]);
  expect(lendMethod("chrome.jonas.a1", "cdp", 4, "Page.getLayoutMetrics", {})).toEqual([
    "itx",
    ["cd", "/"],
    "chrome",
    "jonas",
    "a1",
    ["cdp", 4, "Page.getLayoutMetrics", {}],
  ]);
});

test("a point over a letterboxed picture is 0–1 on the picture, clamped at its edges", () => {
  // a 16:10 screen in a 16:9 box: bars left and right
  const rect = pictureRect({ left: 0, top: 0, width: 1600, height: 900 }, 1440, 900);
  expect(rect).toEqual({ left: 80, top: 0, width: 1440, height: 900 });
  expect(pointOn(rect, 800, 450)).toEqual({ x: 0.5, y: 0.5, inside: true });
  expect(pointOn(rect, 40, 450)).toEqual({ x: 0, y: 0.5, inside: false });
  // no picture size yet: the box itself
  expect(pictureRect({ left: 1, top: 2, width: 3, height: 4 }, 0, 0)).toEqual({
    left: 1,
    top: 2,
    width: 3,
    height: 4,
  });
});

test("a driver not on a Mac presses Ctrl for Command; a Mac's driver keeps its keys", () => {
  expect(onMac("MacIntel")).toBe(true);
  expect(onMac("Win32")).toBe(false);
  const ctrlC = {
    type: "keydown" as const,
    code: "KeyC",
    key: "c",
    shiftKey: false,
    ctrlKey: true,
    altKey: false,
    metaKey: false,
  };
  expect(keyEvents(ctrlC, true)).toEqual([
    { t: "key", code: "KeyC", down: true, key: "c", mods: ["meta"] },
  ]);
  expect(keyEvents(ctrlC, false)).toEqual([
    { t: "key", code: "KeyC", down: true, key: "c", mods: ["ctrl"] },
  ]);
  // the Control key itself is the Command key
  expect(keyEvents({ ...ctrlC, code: "ControlLeft", key: "Control" }, true)[0]).toMatchObject({
    code: "MetaLeft",
  });
  expect(modsOf({ shiftKey: true, ctrlKey: false, altKey: true, metaKey: true }, true)).toEqual([
    "shift",
    "alt",
    "ctrl",
  ]);
  // a printable character with no shortcut key is text, in the driver's own layout, once
  const ue = { ...ctrlC, code: "BracketLeft", key: "ü", ctrlKey: false };
  expect(keyEvents(ue, true)).toEqual([{ t: "text", text: "ü" }]);
  expect(keyEvents({ ...ue, type: "keyup" }, true)).toEqual([]);
  expect(keyEvents({ ...ue, code: "Enter", key: "Enter" }, true)).toEqual([
    { t: "key", code: "Enter", down: true, key: "Enter" },
  ]);
  expect(keyEvents({ ...ue, isComposing: true }, true)).toEqual([]);
});

test("one batch in flight: moves in a row are the last, text in a row is one", () => {
  expect(
    nextBatch([
      { t: "move", x: 0.1, y: 0.1 },
      { t: "move", x: 0.2, y: 0.2 },
      { t: "down", x: 0.2, y: 0.2, button: 0 },
      { t: "text", text: "a" },
      { t: "text", text: "b" },
      { t: "move", x: 0.3, y: 0.3 },
    ]),
  ).toEqual([
    { t: "move", x: 0.2, y: 0.2 },
    { t: "down", x: 0.2, y: 0.2, button: 0 },
    { t: "text", text: "ab" },
    { t: "move", x: 0.3, y: 0.3 },
  ]);
});

test("a Chrome tab's input is CDP's Input.dispatch* at the tab's CSS pixels; a move while held drags", () => {
  const held = { button: null as 0 | 1 | 2 | null, x: 0, y: 0 };
  const viewport = { width: 1000, height: 500 };
  expect(cdpInput({ t: "down", x: 0.5, y: 0.5, button: 0, clicks: 2 }, viewport, held)).toEqual([
    [
      "Input.dispatchMouseEvent",
      { type: "mousePressed", x: 500, y: 250, button: "left", clickCount: 2, modifiers: 0 },
    ],
  ]);
  expect(cdpInput({ t: "move", x: 0.6, y: 0.5 }, viewport, held)[0]?.[1]).toMatchObject({
    type: "mouseMoved",
    x: 600,
    button: "left",
    buttons: 1,
  });
  cdpInput({ t: "up", x: 0.6, y: 0.5, button: 0 }, viewport, held);
  expect(cdpInput({ t: "scroll", dx: 0, dy: 120 }, viewport, held)).toEqual([
    ["Input.dispatchMouseEvent", { type: "mouseWheel", x: 600, y: 250, deltaX: 0, deltaY: 120 }],
  ]);
  expect(cdpInput({ t: "text", text: "hi" }, viewport, held)).toEqual([
    ["Input.insertText", { text: "hi" }],
  ]);
  expect(
    cdpInput({ t: "key", code: "Enter", down: true, key: "Enter", mods: ["meta"] }, viewport, held),
  ).toEqual([
    [
      "Input.dispatchKeyEvent",
      { type: "rawKeyDown", code: "Enter", key: "Enter", windowsVirtualKeyCode: 13, modifiers: 4 },
    ],
  ]);
});

test("a Mac whose fact is far back in its log is read from its own state: Control and each display not Off", () => {
  const things = [
    { kind: "screen", name: "Built-in", sharing: "shared", permitted: true, display: 0 },
    { kind: "screen", name: "LG", sharing: "off", permitted: true, display: 1 },
    { kind: "control", name: "Control this Mac", sharing: "ask", permitted: true },
  ];
  expect(offerFromState("jonas.mac", { things })).toEqual({
    kind: "mac",
    lend: "jonas.mac",
    control: "ask",
    displays: [{ display: 0, name: "Built-in", screen: "shared" }],
  });
  const off = things.map((thing) =>
    thing.kind === "control" ? { ...thing, sharing: "off" } : thing,
  );
  expect(offerFromState("jonas.mac", { things: off })?.control).toBeNull();
  expect(offerFromState("jonas.mac", { error: "x" })).toBeUndefined();
  expect(
    newestOwner([offerOf(OFFER, "zak@nustom.com"), { type: "events.iterate.com/itx/woken" }]),
  ).toBe("zak@nustom.com");
});

test("lines that the call did not take wait on the page and reach it later: each once, in order, with the time it was heard", async () => {
  using call = callThatTakes();
  const { room, outbox } = call;
  const start = Date.now();
  outbox.add({ id: "a", at: Date.now() });
  await outbox.flush();
  expect([room.taken, room.told]).toEqual([[{ id: "a", at: start }], []]);
  // the call stops answering: the lines said meanwhile wait, and the page is told how many
  room.down = true;
  outbox.add({ id: "b", at: Date.now() });
  await vi.advanceTimersByTimeAsync(500);
  outbox.add({ id: "c", at: Date.now() });
  outbox.add({ id: "d", at: Date.now() });
  expect(room.told.at(-1)).toEqual({ unsaved: 3, lost: 0, saved: 0 });
  // a new line makes no try of its own: the tries follow the waits
  await vi.advanceTimersByTimeAsync(600 + 2_000 + 4_000);
  expect([room.tries, outbox.waiting]).toEqual([["a", "b", "b", "b", "b"], 3]);
  // it answers again: every line that waited, oldest first, with its own time
  room.down = false;
  await vi.advanceTimersByTimeAsync(8_000);
  expect(room).toMatchObject({
    taken: [
      { id: "a", at: start },
      { id: "b", at: start },
      { id: "c", at: start + 500 },
      { id: "d", at: start + 500 },
    ],
  });
  expect(room.told.at(-1)).toEqual({ unsaved: 0, lost: 0, saved: 3 });
  // and nothing is sent again afterwards
  const tries = room.tries.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect([room.tries.length, outbox.waiting]).toEqual([tries, 0]);
});

test("a try with no answer counts as failed, and the line that had landed is not taken twice", async () => {
  using call = callThatTakes();
  const { room } = call;
  let hang = true;
  const outbox = lineOutbox<{ id: string; at: number }>({
    send: (line) => {
      room.tries.push(line.id);
      if (!room.taken.some((one) => one.id === line.id)) room.taken.push(line);
      // the call took the line, and its answer never came
      return hang ? new Promise(() => {}) : Promise.resolve();
    },
    ready: () => true,
    onChange: (change) => room.told.push(change),
  });
  outbox.add({ id: "a", at: Date.now() });
  await vi.advanceTimersByTimeAsync(UNSENT.answerMs);
  expect(room.told.at(-1)).toMatchObject({ unsaved: 1 });
  hang = false;
  await vi.advanceTimersByTimeAsync(1_000);
  expect([room.tries, room.taken.length, outbox.waiting]).toEqual([["a", "a"], 1, 0]);
  expect(room.told.at(-1)).toEqual({ unsaved: 0, lost: 0, saved: 1 });
});

test("a page out of the call tries nothing by itself, and sends what waits when it is in again", async () => {
  using call = callThatTakes();
  const { room, outbox } = call;
  room.down = true;
  outbox.add({ id: "a", at: Date.now() });
  await outbox.flush();
  room.in = false;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(room).toMatchObject({ tries: ["a"] });
  // the join's own flush
  room.in = true;
  room.down = false;
  await outbox.flush();
  expect(room.taken.map((line) => line.id)).toEqual(["a"]);
});

test("what waits is bounded, each outbox holds its own lines, and a line of the voice agent is dropped at its first failure", async () => {
  using call = callThatTakes();
  const { room, outbox } = call;
  room.down = true;
  outbox.add({ id: "voice", at: Date.now(), ai: true });
  await outbox.flush();
  expect([outbox.waiting, room.told]).toEqual([0, []]);
  // more than the bound: the oldest goes, and the page is told
  outbox.add({ id: "line-0", at: Date.now() });
  await outbox.flush();
  for (let n = 1; n <= UNSENT.lines; n++) outbox.add({ id: `line-${n}`, at: Date.now() });
  expect([outbox.waiting, room.told.at(-1)]).toEqual([
    UNSENT.lines,
    { unsaved: UNSENT.lines, lost: 1, saved: 0 },
  ]);
  // a line older than the bound is given up, never sent late
  room.in = false;
  await vi.advanceTimersByTimeAsync(UNSENT.ageMs + 1);
  room.in = true;
  room.down = false;
  room.tries.length = 0;
  await outbox.flush();
  expect([room.tries, outbox.waiting]).toEqual([[], 0]);
  expect(room.told.at(-1)).toEqual({ unsaved: 0, lost: UNSENT.lines, saved: 0 });
  // another page's outbox, or another call's, got none of them
  const other = callThatTakes(Date.now());
  other.outbox.add({ id: "theirs", at: Date.now() });
  await other.outbox.flush();
  expect(other.room.taken.map((line) => line.id)).toEqual(["theirs"]);
});

const offerOf = (payload: object, email = "jonas@nustom.com", offset = 7) => ({
  type: "device/control-configured",
  offset,
  payload,
  source: { principal: { actor: "user_j", email } },
});
const OFFER = {
  kind: "mac",
  lend: "jonas.mac",
  control: "ask",
  displays: [{ display: 0, name: "Built-in Retina Display", screen: "shared" }],
};

/** A call that takes lines, or refuses them while `down`: what it took, each try, and what the
 *  page was told. */
function callThatTakes(start = Date.parse("2026-11-26T10:48:00Z")) {
  vi.useFakeTimers({ now: start });
  const room = {
    down: false,
    in: true,
    taken: [] as { id: string; at: number }[],
    tries: [] as string[],
    told: [] as { unsaved: number; lost: number; saved: number }[],
  };
  const outbox = lineOutbox<{ id: string; at: number; ai?: true }>({
    send: async (line) => {
      room.tries.push(line.id);
      if (room.down) throw new Error("the call did not answer");
      // the call takes an id once
      if (!room.taken.some((one) => one.id === line.id)) room.taken.push(line);
    },
    ready: () => room.in,
    expendable: (line) => Boolean(line.ai),
    onChange: (change) => room.told.push(change),
  });
  return { room, outbox, [Symbol.dispose]: () => void vi.useRealTimers() };
}
