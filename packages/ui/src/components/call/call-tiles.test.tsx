// @vitest-environment jsdom
// The call's tiles: a screen reader hears who comes into the call and who leaves it from one polite
// region that stays, and a tile's button keeps one name while aria-pressed says whether it is large.
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { CallTiles } from "./call-tiles.tsx";
import type { CallEngine, CallUi, CallVideo } from "#/lib/call-engine.ts";
import { CallLive } from "#/lib/call-rules.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const FRESH = { since: 1, inCall: {}, voiceAgent: null, setup: null };
const ANA = { who: { actor: "/members/a", name: "Ana" }, tracks: { mic: 1 } };

test("who comes into the call and who leaves it is said in one polite region that stays", async () => {
  const ui = { joined: true, videos: [] as CallVideo[] } as CallUi;
  const draw = (live: object) => (
    <CallTiles call={engine()} ui={ui} live={CallLive.parse(live)} member />
  );
  using page = await mount(draw(FRESH));
  const region = page.host.querySelector("[aria-live=polite]");
  await page.render(draw({ ...FRESH, inCall: { a: ANA } }));
  expect(region?.textContent).toBe("Ana joined the call.");
  await page.render(draw(FRESH));
  expect(page.host.querySelector("[aria-live=polite]")).toBe(region);
  expect(region?.textContent).toBe("Ana left the call.");
});

test("a live state that did not come says nothing: nobody left, and nobody joins again", async () => {
  const ui = { joined: true, videos: [] as CallVideo[] } as CallUi;
  const draw = (live: object | undefined) => (
    <CallTiles call={engine()} ui={ui} live={live && CallLive.parse(live)} member />
  );
  using page = await mount(draw({ ...FRESH, inCall: { a: ANA } }));
  await page.render(draw(undefined));
  await page.render(draw({ ...FRESH, inCall: { a: ANA } }));
  expect(page.host.querySelector("[aria-live=polite]")?.textContent).toBe("");
});

test("a tile's button keeps one name, and says by aria-pressed whether it is large", async () => {
  // jsdom plays no media
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const video = { key: "k", name: "Ana", kind: "camera", local: true } as CallVideo;
  const ui = { joined: true, videos: [video] } as CallUi;
  using page = await mount(<CallTiles call={engine()} ui={ui} live={undefined} member />);
  const tile = page.host.querySelector("figure button")!;
  const state = () => [tile.getAttribute("aria-label"), tile.getAttribute("aria-pressed")];
  expect(state()).toEqual(["Ana's camera, large", "false"]);
  await act(async () => (tile as HTMLButtonElement).click());
  expect(state()).toEqual(["Ana's camera, large", "true"]);
});

// the cast: the tiles call only `tileWidth` and `dismiss` of the engine
const engine = () => ({ tileWidth() {}, dismiss() {} }) as unknown as CallEngine;

async function mount(node: ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const render = (next: ReactNode) => act(async () => root.render(next));
  await render(node);
  return {
    host,
    render,
    [Symbol.dispose]: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}
