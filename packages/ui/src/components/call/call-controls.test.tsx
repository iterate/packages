// @vitest-environment jsdom
// The call's icon row: its buttons are there before the engine, and cannot be pressed; one press
// before the join turns the call on when there is none and joins, then does what the button says;
// a start that fails says why; a mind with no SFU app cannot be joined, and the tooltip says why;
// the live dot says others are in the call; in the call, the devices (in the button group) and Leave
// (apart from it) come; a guest has no
// voice agent; and Share is the share icon and its word, with a tooltip.
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { CallControls, CallHeaderWaiting } from "./call-controls.tsx";
import { ShareButton } from "./call-share.tsx";
import type { CallEngine, CallUi } from "#/lib/call-engine.ts";
import { CallLive } from "#/lib/call-rules.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const FRESH = CallLive.parse({ since: null, inCall: {}, voiceAgent: null, setup: null });

test("before the engine, the same buttons are there and cannot be pressed: the tooltip says why", async () => {
  using _wide = wideScreen();
  using row = await mount(<CallHeaderWaiting member />);
  expect(switches(row.element)).toEqual([
    ["Microphone", "false", "true"],
    ["Camera", "false", "true"],
    ["Voice agent", "false", "true"],
  ]);
  expect(await tipOf(named(row.element, "Microphone"))).toBe("The call is not ready yet");
});

test("a press of the microphone on an agent with no call: the call comes on, then the page joins with the microphone", async () => {
  const call = engine();
  const start = vi.fn(async () => void call.steps.push("start"));
  using row = await mount(
    <CallControls call={call} ui={IDLE} live={undefined} member start={start} />,
  );
  expect(await tipOf(named(row.element, "Microphone"))).toBe("Start a call");
  await act(async () => named(row.element, "Microphone").click());
  expect(call).toMatchObject({ steps: ["start", "join"] });
  expect(call.join).toHaveBeenCalledExactlyOnceWith({ listenOnly: false });
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
  await act(async () => named(row.element, "Microphone").click());
  expect(call.fail).toHaveBeenCalledExactlyOnceWith(
    "The call could not start: the call's module is not in this mind's config",
  );
  expect(call.join).not.toHaveBeenCalled();
});

test("the camera joins listening and sends its picture from the press; the voice agent joins, then is invited", async () => {
  {
    const call = engine();
    using row = await mount(<CallControls call={call} ui={IDLE} live={FRESH} member />);
    await act(async () => named(row.element, "Camera").click());
    expect(call).toMatchObject({ steps: ["join", "camera"] });
    expect(call.join).toHaveBeenCalledExactlyOnceWith({ listenOnly: true });
  }
  {
    const call = engine({ joins: true });
    using row = await mount(<CallControls call={call} ui={IDLE} live={FRESH} member />);
    await act(async () => named(row.element, "Voice agent").click());
    expect(call).toMatchObject({ steps: ["join", "voice"] });
  }
});

test("a mind with no SFU app cannot be joined, and the tooltip says why", async () => {
  const live = { ...FRESH, setup: { sfu: false, turn: false, voice: false } };
  const call = engine();
  using row = await mount(<CallControls call={call} ui={IDLE} live={live} member />);
  expect(named(row.element, "Microphone").getAttribute("aria-disabled")).toBe("true");
  expect(await tipOf(named(row.element, "Microphone"))).toBe("This mind has no call service yet");
  await act(async () => named(row.element, "Microphone").click());
  expect(call.join).not.toHaveBeenCalled();
});

test("others in the call: a live dot on the microphone, and its tooltip says so", async () => {
  const who = { actor: "/members/b", name: "B" };
  const live = CallLive.parse({ ...FRESH, inCall: { "b-page": { who, since: 1, tracks: {} } } });
  using row = await mount(<CallControls call={engine()} ui={IDLE} live={live} member />);
  // the dot is in the microphone's own button, so the group's rounded ends stay its buttons'
  expect(named(row.element, "Microphone").querySelector("[data-slot=call-live-dot]")).not.toBe(
    null,
  );
  expect(await tipOf(named(row.element, "Microphone"))).toBe("Join the call: others are in it");
});

test("in the call: the devices and Leave come, and a guest has no voice agent", async () => {
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
    // one button group holds the switches and the devices; Leave stands apart from it
    const group = row.element.querySelector("[data-slot=button-group]")!;
    expect([group.getAttribute("role"), labels(group)]).toEqual([
      "group",
      ["Microphone", "Camera", "Voice agent", "Devices"],
    ]);
    expect(await tipOf(named(row.element, "Microphone"))).toBe("Mute");
  }
  {
    using row = await mount(<CallControls call={engine()} ui={ui} live={FRESH} member={false} />);
    expect(labels(row.element)).not.toContain("Voice agent");
  }
});

test("Share: the share icon and its word, named for a screen reader, with a tooltip", async () => {
  using row = await mount(<ShareButton />);
  const share = named(row.element, "Share this agent");
  expect(share).toMatchObject({ textContent: "Share" });
  expect(share.querySelector("svg")?.getAttribute("class")).toContain("lucide-share");
  expect(share.querySelector("svg")?.getAttribute("class")).not.toContain("lucide-share-2");
  expect(await tipOf(share)).toBe("Share this agent");
});

/** A wide screen: the header draws the row, not its button. */
function wideScreen() {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
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

/** An engine of the methods the row calls; each call is kept in `steps`. `joins`: a join takes the
 *  page in. */
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
    toggleCamera: vi.fn(async () => void steps.push("camera")),
    toggleScreen: vi.fn(async () => void steps.push("screen")),
    aiInvite: vi.fn(async () => void steps.push("voice")),
    fail: vi.fn(),
    dismiss: vi.fn(),
  };
  // the cast: the row calls only these of the engine's methods
  return call as unknown as CallEngine & typeof call;
}

/** Each switch's name, whether it is on, and whether it can be pressed. */
function switches(element: Element) {
  return [...element.querySelectorAll("button[aria-pressed]")].map((one) => [
    one.getAttribute("aria-label"),
    one.getAttribute("aria-pressed"),
    one.getAttribute("aria-disabled"),
  ]);
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
    [Symbol.dispose]: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}
