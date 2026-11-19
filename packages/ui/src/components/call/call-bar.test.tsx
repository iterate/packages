// @vitest-environment jsdom
// The call's bar: a start that fails says why in the call's words, a start under way and the
// words outlive the bar, Join waits on nothing on a fresh call, a mind with no SFU app cannot be
// joined, only a member can add a voice agent, each switch keeps one name while aria-pressed says
// its state, and the focus stays on the one main button from Join to Leave.
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { CallBar } from "./call-bar.tsx";
import type { CallEngine, CallUi } from "#/lib/call-engine.ts";
import { CallLive } from "#/lib/call-rules.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const FRESH = CallLive.parse({ since: null, inCall: {}, voiceAgent: null, setup: null });

test("a start that fails says why in the call's words", async () => {
  const call = engine();
  using bar = await mount(
    <CallBar
      call={call}
      ui={IDLE}
      live={undefined}
      member
      start={() => Promise.reject(new Error("the call's module is not in this mind's config"))}
    />,
  );
  await act(async () => button(bar.element, "Start a call").click());
  expect(call.fail).toHaveBeenCalledExactlyOnceWith(
    "The call could not start: the call's module is not in this mind's config",
  );
});

test("a start under way is the host's: a bar drawn again says Starting…, and takes no press", async () => {
  using bar = await mount(<CallBar call={engine()} ui={IDLE} live={undefined} member starting />);
  expect(button(bar.element, "Starting…").getAttribute("aria-disabled")).toBe("true");
});

test("in the call, the bar draws before the call's live state has come", async () => {
  using bar = await mount(
    <CallBar call={engine()} ui={{ ...IDLE, joined: true }} live={undefined} member />,
  );
  expect(button(bar.element, "Leave")).toMatchObject({ title: "Leave the call" });
});

test("what went wrong is the engine's, in one element under the buttons", async () => {
  const ui = {
    ...IDLE,
    joined: true,
    error: "Receiving: no path to Cloudflare.",
    aiRefusal: { message: "no key", noKey: true as const },
  };
  using bar = await mount(<CallBar call={engine()} ui={ui} live={FRESH} member />);
  const words = bar.element.querySelectorAll("[data-slot=call-bar-words]");
  expect(words).toHaveLength(1);
  expect([...words[0]!.querySelectorAll('[role="alert"]')].map((one) => one.textContent)).toEqual([
    "Receiving: no path to Cloudflare.",
    "This mind has no OpenAI key for the voice agent yet. iterate Cloud gives one with its credit, or save your own as /secrets/openai. The Voice app asks for it once voice is on.",
  ]);
});

test("the focus stays on the main button from Join to Leave and back", async () => {
  const call = engine();
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const draw = (ui: CallUi) =>
    act(async () => root.render(<CallBar call={call} ui={ui} live={FRESH} member />));
  try {
    await draw(IDLE);
    button(host, "Join").focus();
    await draw({ ...IDLE, joining: true });
    await draw({ ...IDLE, joined: true });
    expect(document.activeElement).toMatchObject({ title: "Leave the call" });
    await draw(IDLE);
    expect(document.activeElement).toMatchObject({ title: "Join the call" });
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});

test("Join can be pressed on a fresh call, before its setup is read, and joins", async () => {
  const call = engine();
  using bar = await mount(<CallBar call={call} ui={IDLE} live={FRESH} member={false} />);
  const join = button(bar.element, "Join");
  expect(join).toMatchObject({ disabled: false });
  await act(async () => join.click());
  expect(call.join).toHaveBeenCalledOnce();
});

test("a mind with no SFU app cannot be joined", async () => {
  const live = { ...FRESH, setup: { sfu: false, turn: false, voice: false } };
  using bar = await mount(<CallBar call={engine()} ui={IDLE} live={live} member />);
  expect(button(bar.element, "Join")).toMatchObject({ disabled: true });
});

test("in the call, a member can add a voice agent and a guest cannot", async () => {
  const ui = { ...IDLE, joined: true };
  const labels = (element: HTMLElement) =>
    [...element.querySelectorAll("button")].map((one) => one.title);
  {
    using bar = await mount(<CallBar call={engine()} ui={ui} live={FRESH} member />);
    expect(labels(bar.element)).toEqual([
      "Mute",
      "Share video",
      "Share the screen",
      "Devices",
      "Add a voice agent",
      "Leave the call",
    ]);
  }
  {
    using bar = await mount(<CallBar call={engine()} ui={ui} live={FRESH} member={false} />);
    expect(labels(bar.element)).not.toContain("Add a voice agent");
  }
});

test("each switch keeps one name, and says whether it is on by aria-pressed alone", async () => {
  const switches = async (ui: CallUi, live: CallLive) => {
    using bar = await mount(<CallBar call={engine()} ui={ui} live={live} member />);
    return [...bar.element.querySelectorAll("button[aria-pressed]")].map((one) => [
      one.getAttribute("aria-label"),
      one.getAttribute("aria-pressed"),
    ]);
  };
  const joined = { ...IDLE, joined: true };
  expect(await switches(joined, FRESH)).toEqual([
    ["Microphone", "true"],
    ["Camera", "false"],
    ["Share screen", "false"],
    ["Voice agent", "false"],
  ]);
  const agent = { host: { actor: "/members/a", name: "Ana" }, page: "a-page", since: 1, until: 2 };
  expect(
    await switches(
      { ...joined, muted: true, camera: true, screen: true },
      CallLive.parse({ ...FRESH, voiceAgent: agent }),
    ),
  ).toEqual([
    ["Microphone", "false"],
    ["Camera", "true"],
    ["Share screen", "true"],
    ["Voice agent", "true"],
  ]);
});

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
  aiRefusal: null,
  devices: {
    mic: [],
    camera: [],
    speaker: [],
    chosen: { mic: "", camera: "", speaker: "" },
    speakerSupported: true,
  },
  videos: [],
};
// the cast: the bar calls only these of the engine's methods
const engine = () =>
  ({
    join: vi.fn(async () => {}),
    aiInvite: vi.fn(async () => {}),
    fail: vi.fn(),
  }) as unknown as CallEngine;

function button(element: HTMLElement, text: string) {
  const found = [...element.querySelectorAll("button")].find((one) =>
    one.textContent?.includes(text),
  );
  if (!found) throw new Error(`no button "${text}"`);
  return found;
}

async function mount(node: ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    element: host.firstElementChild as HTMLElement, // CallBar renders one div
    [Symbol.dispose]: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}
