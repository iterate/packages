// @vitest-environment jsdom
// The call in a tab: a camera pressed when this page has no sending connection says why, and no
// call outside the tab is made for it.
import { expect, test, vi } from "vitest";
import { createCall } from "./call-engine.ts";

test("Camera on, pressed before this page's sending connection is up, says why instead of nothing", async () => {
  const facet = vi.fn(async () => ({}));
  const call = createCall({ facet, page: "page-a" });
  await call.toggleCamera();
  expect(call.ui).toMatchObject({
    camera: false,
    error: "No camera: this page's connection to the call is not up. Join the call first.",
  });
  expect(facet).not.toHaveBeenCalled();
  call.dispose();
});

test("the picker offers the member's own lent Mac, and nothing without one or for another's", async () => {
  const facet = vi.fn(async () => ({}));
  const none = createCall({ facet, page: "sub-1", invoke: mindWith([]).invoke });
  await none.listDevices({ macs: true });
  expect(none.ui.devices.mac).toBeUndefined();
  none.dispose();

  const others = createCall({
    facet,
    page: "sub-1",
    invoke: mindWith([{ lend: "misha.mac", owner: "user_misha", things: THINGS }]).invoke,
  });
  await others.listDevices({ macs: true });
  expect(others.ui.devices.mac).toBeUndefined();
  others.dispose();

  const mine = createCall({
    facet,
    page: "sub-1",
    invoke: mindWith([{ lend: "jonas.mac", owner: "user_jonas", things: THINGS }]).invoke,
  });
  await mine.listDevices({ macs: true });
  expect(mine.ui.devices).toMatchObject({
    mac: {
      camera: [
        expect.objectContaining({
          id: "mac:jonas.mac:camera",
          label: "Your Mac “jonas.mac” (iterate app): FaceTime HD Camera",
        }),
      ],
      screen: [expect.objectContaining({ id: "mac:jonas.mac:screen:0" })],
      chosen: { camera: "", screen: "" },
      asking: "",
    },
  });
  mine.dispose();
  // a guest's view, which refuses every expression but the call's: no Mac, and no error
  const guest = createCall({
    facet,
    page: "sub-1",
    invoke: async () => Promise.reject(new Error("not allowed")),
  });
  await guest.listDevices({ macs: true });
  expect([guest.ui.devices.mac, guest.ui.error]).toEqual([undefined, ""]);
  guest.dispose();
  expect(facet).not.toHaveBeenCalled();
});

test("the picker opening asks the member's own Mac to prepare its connection, and no other Mac", async () => {
  const { invoke, calls } = mindWith([
    { lend: "jonas.mac", owner: "user_jonas", things: THINGS },
    { lend: "misha.mac", owner: "user_misha", things: THINGS },
  ]);
  const call = createCall({ facet: vi.fn(async () => ({})), page: "sub-1", invoke });
  await call.listDevices({ macs: true });
  const prepares = calls.filter((expression) => JSON.stringify(expression).includes('"prepare"'));
  expect(prepares).toEqual([["itx", ["cd", "/"], "jonas", "mac", "call", ["prepare", {}]]]);
  call.dispose();
});

test("a Mac's screen chosen asks its lend to publish into this call for this page; a browser choice and a Leave end it", async () => {
  const { invoke, calls } = mindWith([{ lend: "jonas.mac", owner: "user_jonas", things: THINGS }]);
  const call = createCall({ facet: vi.fn(async () => ({})), page: "sub-1", invoke });
  await call.listDevices({ macs: true });
  calls.length = 0;
  await call.chooseMac("screen", "mac:jonas.mac:screen:0");
  expect(calls).toEqual([
    [
      "itx",
      ["cd", "/"],
      "jonas",
      "mac",
      "call",
      ["publish", { context: "/agents/meet/standup", source: "screen:0", as: "sub-1" }],
    ],
  ]);
  expect(call.ui.devices.mac?.chosen.screen).toBe("mac:jonas.mac:screen:0");
  await call.chooseMac("screen", "");
  expect(calls.at(-1)).toEqual([
    "itx",
    ["cd", "/"],
    "jonas",
    "mac",
    "call",
    ["unpublish", { context: "/agents/meet/standup", source: "screen:0" }],
  ]);

  await call.chooseDevice("camera", "mac:jonas.mac:camera");
  expect(calls.at(-1)).toEqual([
    "itx",
    ["cd", "/"],
    "jonas",
    "mac",
    "call",
    ["publish", { context: "/agents/meet/standup", source: "camera", as: "sub-1" }],
  ]);
  // a browser camera chosen again: the Mac's camera stops
  await call.chooseDevice("camera", "");
  expect(calls.at(-1)).toEqual([
    "itx",
    ["cd", "/"],
    "jonas",
    "mac",
    "call",
    ["unpublish", { context: "/agents/meet/standup", source: "camera" }],
  ]);

  await call.chooseMac("camera", "mac:jonas.mac:camera");
  await call.leave();
  await vi.waitFor(() =>
    expect(calls.at(-1)).toEqual([
      "itx",
      ["cd", "/"],
      "jonas",
      "mac",
      "call",
      ["unpublish", { context: "/agents/meet/standup", source: "camera" }],
    ]),
  );
  call.dispose();
});

test("a Mac that refuses (its owner has it Off) says why, and the picker keeps the browser's", async () => {
  const { invoke } = mindWith([{ lend: "jonas.mac", owner: "user_jonas", things: THINGS }]);
  const refusing = vi.fn(async (expression: unknown) => {
    if (JSON.stringify(expression).includes('"publish"'))
      throw new Error(
        "The Mac's owner has the display “Built-in Retina Display” off in the iterate panel: a call cannot have it.",
      );
    return invoke(expression);
  });
  const call = createCall({ facet: vi.fn(async () => ({})), page: "sub-1", invoke: refusing });
  await call.listDevices({ macs: true });
  await call.chooseMac("screen", "mac:jonas.mac:screen:0");
  expect(call.ui).toMatchObject({
    error:
      "Your Mac did not send its screen: The Mac's owner has the display “Built-in Retina Display” off in the iterate panel: a call cannot have it.",
  });
  expect(call.ui.devices.mac?.chosen.screen).toBe("");
  call.dispose();
});

test("Drive lists a Mac its fact offers, for any member; a drive starts its session, shows its screen and sends batches", async () => {
  const calls: unknown[] = [];
  const offer = {
    kind: "mac",
    lend: "jonas.mac",
    control: "shared",
    displays: [{ display: 0, name: "Built-in Retina Display", screen: "shared" }],
  };
  const invoke = vi.fn(async (expression: unknown) => {
    calls.push(expression);
    const text = JSON.stringify(expression);
    if (text === '["itx",["whoami"]]') return { path: "/agents/meet/standup" };
    if (text.includes('"rpcStubs"')) return ["subscription:sub-1", "itx.jonas.mac"];
    if (text.includes('"contexts"'))
      return [
        {
          path: "/devices/jonas.mac",
          eventCount: 40,
          eventTypes: { "device/control-configured": 1 },
        },
        { path: "/devices/old.mac", eventCount: 3, eventTypes: { "device/presence-changed": 1 } },
      ];
    if (text.includes(`"readEvents",${Number.MAX_SAFE_INTEGER}`))
      return { events: [], scannedThroughOffset: 40, atHead: true };
    if (text.includes('"readEvents"'))
      return {
        atHead: true,
        scannedThroughOffset: 40,
        events: [
          {
            type: "device/control-configured",
            offset: 38,
            payload: offer,
            source: { principal: { actor: "user_jonas", email: "jonas@nustom.com" } },
          },
        ],
      };
    if (text.includes('["start",')) return { session: "s1", display: { id: 1 } };
    if (text.endsWith('["state"]]')) return { publications: [] };
    if (text.includes('["publish",'))
      return {
        publications: [{ publication: "p1", context: "/agents/meet/standup", source: "screen:0" }],
      };
    if (text.includes('["input",')) return { applied: 1, paused: false };
    if (text.includes('["end",') || text.includes('["unpublish",')) return {};
    throw new Error(`no rule matches ${text}`);
  });
  const call = createCall({ facet: vi.fn(async () => ({})), page: "sub-1", invoke });
  await call.listDrives();
  expect(call.ui).toMatchObject({
    drive: {
      targets: [{ id: "drive:jonas.mac:0", label: "Jonas's Mac" }],
      asking: "",
      driving: null,
    },
  });
  // only the context whose types hold the fact is read: its head, then its newest 200 offsets
  expect(calls.filter((one) => JSON.stringify(one).includes("readEvents"))).toEqual([
    ["itx", ["cd", "/devices/jonas.mac"], ["readEvents", Number.MAX_SAFE_INTEGER, 1]],
    ["itx", ["cd", "/devices/jonas.mac"], ["readEvents", 0, 40]],
  ]);
  calls.length = 0;
  await call.drive("drive:jonas.mac:0");
  const lend = ["itx", ["cd", "/"], "jonas", "mac"];
  expect(calls).toEqual([
    [...lend, "control", ["start", { display: 0, by: "A member" }]],
    [...lend, "call", ["state"]],
    [
      ...lend,
      "call",
      ["publish", { context: "/agents/meet/standup", source: "screen:0", as: "sub-1" }],
    ],
  ]);
  expect(call.ui.drive?.driving).toMatchObject({
    id: "drive:jonas.mac:0",
    label: "Jonas's Mac",
    track: "mac-call-jonas-mac-p1:screen",
    direct: false,
  });
  calls.length = 0;
  call.driveInput([
    { t: "move", x: 0.1, y: 0.1 },
    { t: "move", x: 0.2, y: 0.2 },
  ]);
  call.driveInput([{ t: "move", x: 0.3, y: 0.3 }]);
  await vi.waitFor(() => expect(calls).toHaveLength(2));
  // the first batch goes at once; what came while it was on its way goes as the next one
  expect(calls).toEqual([
    [...lend, "control", ["input", { session: "s1", events: [{ t: "move", x: 0.2, y: 0.2 }] }]],
    [...lend, "control", ["input", { session: "s1", events: [{ t: "move", x: 0.3, y: 0.3 }] }]],
  ]);
  calls.length = 0;
  await call.stopDrive();
  expect(calls).toEqual([
    [...lend, "control", ["end", { session: "s1" }]],
    [...lend, "call", ["unpublish", { publication: "p1" }]],
  ]);
  expect(call.ui.drive?.driving).toBeNull();
  call.dispose();

  // a guest's view refuses the reads: no menu
  const guest = createCall({
    facet: vi.fn(async () => ({})),
    page: "sub-1",
    invoke: async () => Promise.reject(new Error("not allowed")),
  });
  await guest.listDrives();
  expect([guest.ui.drive, guest.ui.error]).toEqual([undefined, ""]);
  guest.dispose();
});

/** A mind with `macs` lent now, each `{ lend, owner, things }`, as a member's context answers. */
function mindWith(macs: { lend: string; owner: string; things: unknown[] }[], me = "user_jonas") {
  const calls: unknown[] = [];
  const invoke = vi.fn(async (expression: unknown) => {
    calls.push(expression);
    const text = JSON.stringify(expression);
    if (text === '["itx",["whoami"]]')
      return { path: "/agents/meet/standup", principal: { actor: me } };
    if (text.includes('"rpcStubs"'))
      return ["subscription:sub-1", ...macs.map((mac) => `itx.${mac.lend}`)];
    if (text.includes('"contexts"'))
      return macs.map((mac) => ({
        path: `/devices/${mac.lend}`,
        eventCount: 50,
        eventTypes: { "device/presence-changed": 2 },
      }));
    const mac = macs.find((one) => text.includes(`["cd","/devices/${one.lend}"]`));
    if (mac && text.includes("readEvents"))
      return {
        events: [{ type: "device/app-focused", source: { principal: { actor: mac.owner } } }],
      };
    const lent = macs.find((one) =>
      text.startsWith(
        `["itx",["cd","/"],${one.lend
          .split(".")
          .map((part) => JSON.stringify(part))
          .join(",")}`,
      ),
    );
    if (lent && text.endsWith('["state"]]')) return { things: lent.things };
    if (lent && text.includes('"call"')) return { publications: [] };
    throw new Error(`no rule matches ${text}`);
  });
  return { invoke, calls };
}
const THINGS = [
  {
    kind: "screen",
    name: "Built-in Retina Display",
    sharing: "shared",
    permitted: true,
    display: 0,
  },
  { kind: "camera", name: "FaceTime HD Camera", sharing: "ask", permitted: true },
];
