// @vitest-environment jsdom
// The lobby before a call: who is in the call in one sentence, nothing opened until a press (or a
// press that opened the lobby), Join muted hands over a muted microphone, and a lobby that closes
// with no join stops what it opened.
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { CallLobby, whoIsIn, type LobbyMedia } from "./call-lobby.tsx";
import { CallLive } from "#/lib/call-rules.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

test("who is in the call, in one sentence: a person on two pages once, a guest marked, the voice agent", () => {
  expect(whoIsIn(undefined, false)).toBe("Looking for who is in the call…");
  expect(whoIsIn(live({}), false)).toBe("Nobody is in the call yet.");
  expect(whoIsIn(undefined, true)).toBe("Nobody is in the call yet: you start it.");
  expect(whoIsIn(live({ p1: { name: "Ada" }, p2: { name: "Ada" } }), false)).toBe(
    "In the call now: Ada.",
  );
  expect(
    whoIsIn(live({ p1: { name: "Ada" }, p2: { name: "Grace", guest: true } }, true), false),
  ).toBe("In the call now: Ada, Grace (guest) and the voice agent.");
});

test("a lobby opened by a link opens nothing; one opened by a press opens the microphone, and Join muted hands it over muted", async () => {
  using media = fakeMedia();
  const joined: LobbyMedia[] = [];
  {
    using lobby = await mount(
      <CallLobby live={live({})} action="join" onJoin={(one) => joined.push(one)} />,
    );
    await act(async () => {});
    expect(media).toMatchObject({ opened: [] });
    expect(lobby.text()).not.toContain("Join muted");
  }
  using lobby = await mount(
    <CallLobby live={live({})} action="join" micAtStart onJoin={(one) => joined.push(one)} />,
  );
  await act(() => vi.waitFor(() => expect(lobby.button("Join muted")).toBeTruthy()));
  await act(async () => lobby.button("Join muted").click());
  expect(joined).toHaveLength(1);
  expect(joined[0]).toMatchObject({ camera: null });
  const track = joined[0]!.mic!.getAudioTracks()[0]!;
  // the call owns it now: muted, and not stopped by the lobby
  expect(track).toMatchObject({ enabled: false, readyState: "live" });
});

test("a lobby that closes with no join stops the microphone and the camera it opened", async () => {
  using media = fakeMedia();
  const lobby = await mount(<CallLobby live={live({})} action="start" onJoin={() => {}} />);
  await act(async () => lobby.button("Turn the microphone on").click());
  await act(async () => lobby.button("Turn the camera on").click());
  await act(() => vi.waitFor(() => expect(media.opened).toHaveLength(2)));
  expect(lobby.button("Start the call")).toBeTruthy();
  lobby[Symbol.dispose]();
  expect(media.opened.map((track) => track.readyState)).toEqual(["ended", "ended"]);
});

test("a camera the browser refuses is said in words, and Join stays", async () => {
  using _media = fakeMedia({ refuse: "NotAllowedError" });
  using lobby = await mount(<CallLobby live={live({})} action="join" onJoin={() => {}} />);
  await act(async () => lobby.button("Turn the camera on").click());
  await act(() =>
    vi.waitFor(() =>
      expect(lobby.element.querySelector("[role=alert]")?.textContent).toBe(
        "The browser did not give this page the camera. Allow it for this site to be seen; you can still join without it.",
      ),
    ),
  );
  expect(lobby.button("Join now")).toBeTruthy();
});

function live(inCall: Record<string, { name: string; guest?: true }>, voiceAgent = false) {
  return CallLive.parse({
    since: 1,
    inCall: Object.fromEntries(
      Object.entries(inCall).map(([page, { name, guest }]) => [
        page,
        { who: { actor: name, name, ...(guest && { kind: "guest" }) }, tracks: {} },
      ]),
    ),
    voiceAgent: voiceAgent
      ? { host: { actor: "a", name: "a" }, page: "p1", since: 1, until: 2 }
      : null,
    setup: null,
  });
}

function fakeMedia({ refuse }: { refuse?: string } = {}) {
  const opened: { kind: string; enabled: boolean; readyState: string; stop(): void }[] = [];
  const before = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: async (constraints: { audio?: object }) => {
        if (refuse) throw Object.assign(new Error("refused"), { name: refuse });
        const track = {
          kind: constraints.audio ? "audio" : "video",
          enabled: true,
          readyState: "live",
          stop() {
            track.readyState = "ended";
          },
        };
        opened.push(track);
        const tracks = [track];
        return {
          getAudioTracks: () => tracks.filter((one) => one.kind === "audio"),
          getVideoTracks: () => tracks.filter((one) => one.kind === "video"),
          getTracks: () => tracks,
        };
      },
      enumerateDevices: async () => [],
      addEventListener() {},
      removeEventListener() {},
    },
  });
  return {
    opened,
    [Symbol.dispose]: () => {
      globalThis.localStorage?.clear();
      if (before) Object.defineProperty(navigator, "mediaDevices", before);
      else Reflect.deleteProperty(navigator, "mediaDevices");
    },
  };
}

async function mount(node: ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(async () => root.render(node));
  const element = host;
  return {
    element,
    text: () => element.textContent || "",
    button(text: string) {
      const found = [...element.querySelectorAll("button")].find(
        (one) => one.title === text || one.textContent?.trim() === text,
      );
      if (!found) throw new Error(`no button "${text}"`);
      return found;
    },
    [Symbol.dispose]: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}
