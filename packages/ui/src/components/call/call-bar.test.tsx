// @vitest-environment jsdom
// The call's bar: a start that fails says why in words, Join waits on nothing on a fresh call, a
// mind with no SFU app cannot be joined, and only a member can add a voice agent.
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { CallBar } from "./call-bar.tsx";
import type { CallEngine, CallUi } from "#/lib/call-engine.ts";
import { CallLive } from "#/lib/call-rules.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const FRESH = CallLive.parse({ since: null, inCall: {}, voiceAgent: null, setup: null });

test("a start that fails says why in words where the bar is", async () => {
  using bar = await mount(
    <CallBar
      call={null}
      ui={IDLE}
      live={undefined}
      member
      start={() => Promise.reject(new Error("the call's module is not in this mind's config"))}
    />,
  );
  await act(async () => button(bar.element, "Start a call").click());
  expect(bar.element.querySelector('[role="alert"]')?.textContent).toBe(
    "The call could not start: the call's module is not in this mind's config",
  );
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
const engine = () =>
  ({ join: vi.fn(async () => {}), aiInvite: vi.fn(async () => {}) }) as unknown as CallEngine;

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
