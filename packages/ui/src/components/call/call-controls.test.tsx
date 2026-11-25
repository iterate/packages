// @vitest-environment jsdom
// The call's controls: out of the call, one button, Start call when nobody is in it and Join call
// (with how many) when someone is; it is there before the engine, and cannot be pressed; one press
// turns the call on when there is none and joins with the microphone, and a refused microphone
// joins listening; a start that fails says why; a mind with no SFU app cannot be joined, and the
// tooltip says why; in the call, the switches and the devices in one button group, and Leave apart
// from it; a guest has no voice agent; on a phone, Start call is its icon alone; in a header, what
// went wrong stands over the page; the screen and the voice agent keep their icon, and their fill
// says on; and Share is the share icon and its word, with a tooltip.
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { CallControls, CallHeaderControls, CallHeaderWaiting } from "./call-controls.tsx";
import { ShareButton } from "./call-share.tsx";
import type { CallEngine, CallUi } from "#/lib/call-engine.ts";
import { CallLive } from "#/lib/call-rules.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const FRESH = CallLive.parse({ since: null, inCall: {}, voiceAgent: null, setup: null });

test("before the engine, Start call is there and cannot be pressed: the tooltip says why", async () => {
  using _wide = wideScreen();
  using row = await mount(<CallHeaderWaiting member />);
  expect(labels(row.element)).toEqual(["Start call"]);
  expect(named(row.element, "Start call")).toMatchObject({ textContent: "Start call" });
  expect(named(row.element, "Start call").getAttribute("aria-disabled")).toBe("true");
  expect(await tipOf(named(row.element, "Start call"))).toBe("The call is not ready yet");
});

test("out of the call there is one button: no microphone, camera, screen or voice agent", async () => {
  using row = await mount(<CallControls call={engine()} ui={IDLE} live={FRESH} member />);
  expect(labels(row.element)).toEqual(["Start call"]);
  expect(row.element.querySelector("[data-slot=button-group]")).toBe(null);
  expect(await tipOf(named(row.element, "Start call"))).toBe("Start a call");
});

test("Start call on an agent with no call: the call comes on, then the page joins with the microphone", async () => {
  const call = engine();
  const start = vi.fn(async () => void call.steps.push("start"));
  using row = await mount(
    <CallControls call={call} ui={IDLE} live={undefined} member start={start} />,
  );
  await act(async () => named(row.element, "Start call").click());
  expect(call).toMatchObject({ steps: ["start", "join"] });
  // the microphone open, and a refused one joins listening
  expect(call.join).toHaveBeenCalledExactlyOnceWith({ orListen: true });
});

test("a start that fails says why in the call's words, and joins nothing", async () => {
  const call = engine();
  using row = await mount(
    <CallControls
      call={call}
      ui={IDLE}
      live={undefined}
      member
      start={() => Promise.reject(new Error("the call's module is not in this mind's config"))}
    />,
  );
  await act(async () => named(row.element, "Start call").click());
  expect(call.fail).toHaveBeenCalledExactlyOnceWith(
    "The call could not start: the call's module is not in this mind's config",
  );
  expect(call.join).not.toHaveBeenCalled();
});

test("a join under way: the button waits, with its spinner, and says so", async () => {
  using row = await mount(
    <CallControls call={engine()} ui={{ ...IDLE, joining: true }} live={FRESH} member />,
  );
  const button = named(row.element, "Start call");
  expect([button.getAttribute("aria-disabled"), button.getAttribute("aria-busy")]).toEqual([
    "true",
    "true",
  ]);
  expect(button.querySelector("[data-slot=spinner]")).not.toBe(null);
  expect(await tipOf(button)).toBe("Starting the call…");
});

test("a mind with no SFU app cannot be joined, and the tooltip says why", async () => {
  const live = { ...FRESH, setup: { sfu: false, turn: false, voice: false } };
  const call = engine();
  using row = await mount(<CallControls call={call} ui={IDLE} live={live} member />);
  expect(named(row.element, "Start call").getAttribute("aria-disabled")).toBe("true");
  expect(await tipOf(named(row.element, "Start call"))).toBe("This mind has no call service yet");
  await act(async () => named(row.element, "Start call").click());
  expect(call.join).not.toHaveBeenCalled();
});

test("others in the call: Join call, with how many, and its tooltip says so", async () => {
  const who = { actor: "/members/b", name: "B" };
  const live = CallLive.parse({
    ...FRESH,
    inCall: { "b-page": { who, tracks: {} }, "c-page": { who, tracks: {} } },
  });
  const call = engine();
  using row = await mount(<CallControls call={call} ui={IDLE} live={live} member />);
  const join = named(row.element, "Join call: 2 people are in it");
  expect(join).toMatchObject({ textContent: "Join call2" });
  expect(await tipOf(join)).toBe("Join the call: 2 people are in it");
  await act(async () => join.click());
  expect(call.join).toHaveBeenCalledExactlyOnceWith({ orListen: true });
});

test("the devices: a Screen picker and the Mac's camera only with a member's lent Mac, and a choice asks the engine", async () => {
  const joined = { ...IDLE, joined: true };
  const pickers = async (ui: CallUi) => {
    const call = engine();
    using row = await mount(<CallControls call={call} ui={ui} live={FRESH} member />);
    await act(async () => named(row.element, "Devices").click());
    const selects = await act(() =>
      vi.waitFor(() => {
        const found = [...document.querySelectorAll("label")].filter((one) =>
          one.querySelector("select"),
        );
        if (!found.length) throw new Error("no pickers");
        return found;
      }),
    );
    const seen = selects.map((one) => [
      one.firstChild?.textContent,
      [...one.querySelectorAll("option")].map((option) => option.textContent),
    ]);
    const screen = selects
      .find((one) => one.firstChild?.textContent === "Screen")
      ?.querySelector("select");
    if (screen)
      await act(async () => {
        screen.value = "mac:jonas.mac:screen:0";
        screen.dispatchEvent(new Event("change", { bubbles: true }));
      });
    await act(async () =>
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    return { seen, call };
  };
  const without = await pickers(joined);
  expect(without.seen.map(([label]) => label)).toEqual(["Microphone", "Camera", "Speaker"]);
  const mac = {
    camera: [
      {
        id: "mac:jonas.mac:camera",
        label: "Your Mac “jonas.mac” (iterate app): FaceTime HD Camera",
      },
    ],
    screen: [
      {
        id: "mac:jonas.mac:screen:0",
        label: "Your Mac “jonas.mac” (iterate app): Built-in Retina Display",
      },
    ],
    chosen: { camera: "", screen: "" },
    asking: "",
  };
  const withMac = await pickers({ ...joined, devices: { ...joined.devices, mac } });
  expect(withMac).toMatchObject({
    seen: [
      ["Microphone", []],
      ["Camera", ["Your Mac “jonas.mac” (iterate app): FaceTime HD Camera"]],
      ["Speaker", []],
      [
        "Screen",
        ["Shared from this browser", "Your Mac “jonas.mac” (iterate app): Built-in Retina Display"],
      ],
    ],
  });
  expect(withMac.call.chooseMac).toHaveBeenCalledExactlyOnceWith(
    "screen",
    "mac:jonas.mac:screen:0",
  );
});

test("in the call: the switches and the devices in one group, Leave apart from it, and a guest has no voice agent", async () => {
  const ui = { ...IDLE, joined: true };
  {
    using row = await mount(<CallControls call={engine()} ui={ui} live={FRESH} member />);
    expect(labels(row.element)).toEqual([
      "Microphone",
      "Camera",
      "Voice agent",
      "Devices",
      "Leave the call",
    ]);
    const group = row.element.querySelector("[data-slot=button-group]")!;
    expect([group.getAttribute("role"), labels(group)]).toEqual([
      "group",
      ["Microphone", "Camera", "Voice agent", "Devices"],
    ]);
    expect(await tipOf(named(row.element, "Microphone"))).toBe("Mute");
    expect(await tipOf(named(row.element, "Voice agent"))).toBe("Add a voice agent");
  }
  {
    using row = await mount(<CallControls call={engine()} ui={ui} live={FRESH} member={false} />);
    expect(labels(row.element)).not.toContain("Voice agent");
  }
});

test("Start call's press moves the focus to the microphone once the page is in, and Leave's back to Start call", async () => {
  using _wide = wideScreen();
  const call = engine({ joins: true });
  using row = await mount(<CallControls call={call} ui={IDLE} live={FRESH} member />);
  await act(async () => named(row.element, "Start call").click());
  await act(async () =>
    row.render(<CallControls call={call} ui={{ ...IDLE, joined: true }} live={FRESH} member />),
  );
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Microphone");
  await act(async () => named(row.element, "Leave the call").click());
  await act(async () => row.render(<CallControls call={call} ui={IDLE} live={FRESH} member />));
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Start call");
});

test("on a phone: Start call is its icon alone, and in the call the controls are behind one button", async () => {
  using _narrow = narrowScreen();
  {
    using row = await mount(<CallHeaderControls call={engine()} ui={IDLE} live={FRESH} member />);
    expect(labels(row.element)).toEqual(["Start call"]);
    // the word is drawn from `md` up alone
    expect(named(row.element, "Start call").querySelector("span")?.className).toContain(
      "hidden md:inline",
    );
  }
  {
    const ui = { ...IDLE, joined: true };
    using row = await mount(<CallHeaderControls call={engine()} ui={ui} live={FRESH} member />);
    expect(labels(row.element)).toEqual(["Call: you are in it"]);
  }
});

test("in a header on a wide screen, what went wrong stands over the page: the header's row does not grow", async () => {
  using _wide = wideScreen();
  const ui = { ...IDLE, joined: true, error: "The microphone was refused" };
  using row = await mount(<CallHeaderControls call={engine()} ui={ui} live={FRESH} member />);
  const bar = row.element.querySelector("[data-slot=call-bar]")!;
  expect(bar.querySelector("[data-slot=call-bar-words]")?.textContent).toContain(
    "The microphone was refused",
  );
  expect(bar.className).toContain("*:data-[slot=call-bar-words]:absolute");
  expect(bar.className).toContain("*:data-[slot=call-bar-words]:top-full");
});

test("the screen and the voice agent keep their icon: their fill says they are on", async () => {
  using _share = screenShare();
  const ui = { ...IDLE, joined: true, screen: true };
  const here = {
    ...FRESH,
    voiceAgent: { host: { actor: "a", name: "Jonas" }, page: "p", since: 0, until: 1 },
  };
  using row = await mount(<CallControls call={engine()} ui={ui} live={here} member />);
  for (const [label, icon] of [
    ["Share screen", "lucide-monitor-up"],
    ["Voice agent", "lucide-bot"],
  ]) {
    const button = named(row.element, label);
    expect([
      button.getAttribute("aria-pressed"),
      button.querySelector("svg")?.getAttribute("class"),
    ]).toEqual(["true", expect.stringMatching(new RegExp(`\\b${icon}(\\s|$)`))]);
  }
  expect(await tipOf(named(row.element, "Voice agent"))).toBe("Send the voice agent away");
});

test("Share: the share icon and its word, named for a screen reader, with a tooltip", async () => {
  using row = await mount(<ShareButton />);
  const share = named(row.element, "Share this agent");
  expect(share).toMatchObject({ textContent: "Share" });
  expect(share.querySelector("svg")?.getAttribute("class")).toContain("lucide-share");
  expect(share.querySelector("svg")?.getAttribute("class")).not.toContain("lucide-share-2");
  expect(await tipOf(share)).toBe("Share this agent");
});

/** A browser that can share a screen (jsdom cannot): the row draws Share screen. */
function screenShare() {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getDisplayMedia: () => Promise.reject(new Error("not in a test")) },
  });
  return { [Symbol.dispose]: () => void Reflect.deleteProperty(navigator, "mediaDevices") };
}

/** A wide screen: the header draws the row, not its button. */
function wideScreen() {
  return screenOf(false);
}

/** A phone's screen: in the call, the header draws one button for the controls. */
function narrowScreen() {
  return screenOf(true);
}

function screenOf(narrow: boolean) {
  vi.stubGlobal("matchMedia", () => ({
    matches: narrow,
    addEventListener() {},
    removeEventListener() {},
  }));
  return { [Symbol.dispose]: () => vi.unstubAllGlobals() };
}

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

/** An engine of the methods the controls call; each call is kept in `steps`. `joins`: a join takes
 *  the page in. */
function engine({ joins = false } = {}) {
  const steps: string[] = [];
  const ui = { ...IDLE };
  const call = {
    steps,
    epoch: 0,
    get ui() {
      return ui;
    },
    join: vi.fn(async (_options: object) => {
      steps.push("join");
      if (joins) ui.joined = true;
    }),
    leave: vi.fn(async () => void steps.push("leave")),
    toggleMute: vi.fn(async () => void steps.push("mute")),
    toggleCamera: vi.fn(async () => void steps.push("camera")),
    toggleScreen: vi.fn(async () => void steps.push("screen")),
    aiInvite: vi.fn(async () => void steps.push("voice")),
    listDevices: vi.fn(async () => {}),
    chooseDevice: vi.fn(async () => {}),
    chooseMac: vi.fn(async () => {}),
    fail: vi.fn(),
    dismiss: vi.fn(),
  };
  // the cast: the row calls only these of the engine's methods
  return call as unknown as CallEngine & typeof call;
}

function labels(element: Element) {
  return [...element.querySelectorAll("button")].map((one) => one.getAttribute("aria-label"));
}

function named(element: Element, label: string) {
  const found = element.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!found) throw new Error(`no button "${label}"`);
  return found;
}

/** The tooltip a pointer over `button` opens. */
async function tipOf(button: HTMLElement) {
  await act(async () => {
    button.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    button.focus();
  });
  const tip = await act(() =>
    vi.waitFor(() => {
      const found = document.querySelector("[data-slot=tooltip-content]");
      if (!found) throw new Error("no tooltip");
      return found;
    }),
  );
  const text = tip.textContent;
  await act(async () => {
    button.blur();
    button.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    button.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
  });
  await act(() =>
    vi.waitFor(() => {
      if (document.querySelector("[data-slot=tooltip-content]")) throw new Error("tooltip open");
    }),
  );
  return text;
}

async function mount(node: ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    element: host,
    render: (next: ReactNode) => root.render(next),
    [Symbol.dispose]: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}
