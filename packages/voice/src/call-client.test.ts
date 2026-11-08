// call-client.test.ts — `connectVoiceDevice` over a fake project root: provisioning and the one
// subscription, the press, what the subscription hands each call, the microphone's appends, the
// keepalive, the opening deadline, words given to the voice, a move to a new link and the hang-up.
// The relay's side of the call is voice-agent.ts's
// (voice-agent.test.ts, worker.test.ts).
import { expect, test, vi } from "vitest";
import type { StreamPage } from "iterate/api";
import { codedError } from "iterate/lib";
import {
  connectVoiceDevice,
  VOICE_CALL_KEEPALIVE_MS,
  VOICE_CALL_OPENING_DEADLINE_MS,
  type VoiceCallFact,
} from "./call-client.ts";
import { PCM16_BYTES_PER_MS } from "./mic-pacer.ts";

test("a device provisions itself and subscribes once to its relay's context; each call is one append of call-started, and frames follow it at once", async () => {
  const root = project();
  const device = await connectVoiceDevice(root, { client: "cli" });
  const first = device.call(handlers());
  first.sendMicFrame("frame-0");
  await first.pressed;
  await first.hangUp("done");
  const second = device.call(handlers());

  expect(device).toMatchObject({ path: "/voice/cli", agentPath: "/agents/voice/cli" });
  expect(root).toMatchObject({
    provisioned: [{ client: "cli" }],
    cdPaths: ["/voice/cli"],
    subscriptions: [
      {
        name: expect.stringMatching(/^cli-[0-9a-f]{8}$/),
        consumes: [
          "events.iterate.com/voice-agent/speaker-frame",
          "events.iterate.com/agent/web-message-sent",
          "events.iterate.com/voice-agent/call-started",
          "events.iterate.com/voice-agent/conversation-accepted",
          "events.iterate.com/voice-agent/call-ended",
          "events.iterate.com/voice-agent/audio-trimmed",
          "events.iterate.com/voice-agent/utterance-transcribed",
          "events.iterate.com/voice-agent/answer-transcribed",
          "events.iterate.com/voice-agent/provider-error-reported",
          "events.iterate.com/voice-agent/provider-disconnected",
        ],
        disposed: false,
      },
    ],
  });
  expect(root.append.mock.calls.map(([event]) => event)).toMatchObject([
    {
      type: "events.iterate.com/voice-agent/call-started",
      idempotencyKey: `voice-agent/call:${first.activation}`,
      payload: { activation: first.activation },
    },
    // the frame, without waiting for the press's answer
    { type: "events.iterate.com/voice-agent/mic-frame", payload: { activation: first.activation } },
    {
      type: "events.iterate.com/voice-agent/call-ended",
      payload: { activation: first.activation },
    },
    {
      type: "events.iterate.com/voice-agent/call-started",
      payload: { activation: second.activation },
    },
  ]);
  expect(first.activation).toMatch(/^[0-9a-f]{32}$/);
  expect(second).not.toMatchObject({ activation: first.activation });
  device.close();
  expect(root.subscriptions).toMatchObject([{ disposed: true }]);
});

test("the subscription hands each call its own frames and facts, and the agent's messages while it lasts; the client times the press to acceptance and to first audio", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const root = project();
  const device = await connectVoiceDevice(root, { client: "cli" });
  const heard = handlers();
  const call = device.call(heard);
  const pcm = btoa(String.fromCharCode(...new Uint8Array(3_200))); // 100 ms of PCM16
  vi.advanceTimersByTime(900);
  root.deliver([
    accepted(call.activation),
    accepted("another-call"),
    { type: "events.iterate.com/agent/web-message-sent", payload: { message: "Four." } },
    { type: "events.iterate.com/agent/paused", payload: {} },
  ]);
  vi.advanceTimersByTime(300);
  root.deliver([
    frame(call.activation, { pcm, clearSpeakerBufferBeforeFrame: true }),
    frame("another-call", { pcm }),
    frame(call.activation, { pcm: "", lastFrameOfAnswer: true }),
    {
      type: "events.iterate.com/voice-agent/answer-transcribed",
      payload: { activation: call.activation, text: "Four." },
    },
    { type: "events.iterate.com/voice-agent/answer-transcribed", payload: { text: "Lost." } },
  ]);
  vi.useRealTimers();

  expect(heard).toMatchObject({
    frames: [
      { pcm, clearSpeakerBufferBeforeFrame: true },
      { pcm: "", lastFrameOfAnswer: true },
    ],
    facts: [
      {
        type: "events.iterate.com/voice-agent/conversation-accepted",
        payload: { activation: call.activation, handshakeTookMs: 812 },
      },
      { type: "events.iterate.com/agent/web-message-sent", payload: { message: "Four." } },
      { type: "events.iterate.com/voice-agent/answer-transcribed", payload: { text: "Four." } },
    ],
  });
  expect(call.stats).toMatchObject({
    spkChunksReceived: 1,
    spkMsReceived: 100,
    handshakeMs: 812,
    pressToAcceptedMs: 900,
    pressToFirstAudioMs: 1_200,
  });
  await call.hangUp("done");
});

test("microphone frames are ephemeral appends, five in flight at most: those that come meanwhile wait, and go together and in order in the next free append", async () => {
  const root = project();
  const call = (await connectVoiceDevice(root, { client: "cli" })).call(handlers());
  await call.pressed;
  const held = Promise.withResolvers<void>();
  root.append.mockImplementation(async () => {
    await held.promise;
    return [];
  });
  // a relay that is waking answers its first appends slowly: nothing is lost meanwhile
  const sent = Array.from({ length: 8 }, (_, index) => call.sendMicFrame(`frame-${index}`));
  expect(sent).toEqual([true, true, true, true, true, true, true, true]);
  expect(root.append).toHaveBeenCalledTimes(6);
  held.reject(new Error("the link dropped"));
  await vi.waitFor(() => expect(call.stats).toMatchObject({ micFramesFailed: 8 }));

  expect(root.append.mock.calls[1]).toEqual([micFrame(call.activation, "frame-0")]);
  expect(root.append.mock.calls[6]).toEqual(
    ["frame-5", "frame-6", "frame-7"].map((pcm) => micFrame(call.activation, pcm)),
  );
  expect(call.stats).toMatchObject({ micFramesSent: 8, micFramesDropped: 0, micFramesFailed: 8 });
});

test("a frame is dropped once 2 s of audio is held, in flight or waiting: a link that recovers then cannot overflow the relay's 6 s queue and end the call", async () => {
  const root = project();
  const call = (await connectVoiceDevice(root, { client: "cli" })).call(handlers());
  await call.pressed;
  root.append.mockImplementation(() => new Promise<never[]>(() => undefined));
  const half = Buffer.alloc(PCM16_BYTES_PER_MS * 500).toString("base64");
  const sent = Array.from({ length: 6 }, () => call.sendMicFrame(half));
  // four halves in flight are 2 s, so the fifth waits for nothing: it is dropped, as is the sixth
  expect(sent).toEqual([true, true, true, true, false, false]);
  expect(call.stats).toMatchObject({ micFramesSent: 4, micFramesDropped: 2 });
});

test("a press the relay refused sends none of the frames still waiting, though the appends ahead of them settle", async () => {
  const root = project();
  const press = Promise.withResolvers<never[]>();
  const frames = Promise.withResolvers<never[]>();
  root.append.mockImplementation(async (...events) =>
    events[0]?.type === "events.iterate.com/voice-agent/call-started"
      ? press.promise
      : frames.promise,
  );
  const call = (await connectVoiceDevice(root, { client: "cli" })).call(handlers());
  for (let index = 0; index < 8; index++) call.sendMicFrame(`frame-${index}`);
  expect(root.append).toHaveBeenCalledTimes(6);
  press.reject(new Error("refused"));
  await call.pressed.catch(() => undefined);
  frames.resolve([]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(root.append).toHaveBeenCalledTimes(6);
  expect(call.sendMicFrame("after the refusal")).toBe(false);
  // the three that waited count as dropped, so no frame goes uncounted
  expect(call.stats).toMatchObject({ micFramesSent: 5, micFramesDropped: 3 });
});

test("hanging up sends what still waits before call-ended: the last words before a hang-up count too", async () => {
  const root = project();
  const call = (await connectVoiceDevice(root, { client: "cli" })).call(handlers());
  await call.pressed;
  const log = root.append.getMockImplementation()!;
  const gate = Promise.withResolvers<void>();
  root.append.mockImplementation(async (...events) => {
    if (events[0]?.type === "events.iterate.com/voice-agent/mic-frame") await gate.promise;
    return log(...events);
  });
  for (let index = 0; index < 7; index++) call.sendMicFrame(`frame-${index}`);
  const hungUp = call.hangUp("hung up");
  gate.resolve();
  await hungUp;
  expect(root.append.mock.calls.slice(-2)).toEqual([
    [micFrame(call.activation, "frame-5"), micFrame(call.activation, "frame-6")],
    [
      {
        type: "events.iterate.com/voice-agent/call-ended",
        payload: { activation: call.activation, reason: "hung up" },
      },
    ],
  ]);
});

test("a frame's answer is its offset alone (appendOffsets); a platform without the verb refuses it as no match, and the frames go as appends from then on", async () => {
  const root = project();
  const call = (await connectVoiceDevice(root, { client: "cli" })).call(handlers());
  call.sendMicFrame("frame-0");
  await vi.waitFor(() => expect(root.appendOffsets).toHaveBeenCalledTimes(1));
  root.appendOffsets.mockImplementation(async () => {
    throw codedError("NO_ITX_EXPRESSION_MATCH", 'no rewrite rule matches "itx.appendOffsets"');
  });
  call.sendMicFrame("frame-1");
  await vi.waitFor(() => expect(root.appendedTypes()).toHaveLength(3));
  call.sendMicFrame("frame-2");
  await vi.waitFor(() => expect(root.appendedTypes()).toHaveLength(4));
  expect(call.stats).toMatchObject({ micFramesSent: 3, micFramesFailed: 0 });
  // the first refusal settles it: frame-2 goes as an append without asking the verb again
  expect(root.appendOffsets).toHaveBeenCalledTimes(2);
  await call.hangUp("done");
});

test("a live call says keepalive every VOICE_CALL_KEEPALIVE_MS; hanging up waits for the frames in flight, appends call-ended and stops once it comes back", async () => {
  vi.useFakeTimers();
  const root = project();
  const heard = handlers();
  const call = (await connectVoiceDevice(root, { client: "cli" })).call(heard);
  root.deliver([accepted(call.activation)]);
  await vi.advanceTimersByTimeAsync(VOICE_CALL_KEEPALIVE_MS * 2);
  expect(root.append.mock.calls.slice(1).map(([event]) => event)).toEqual([
    {
      type: "events.iterate.com/voice-agent/keepalive",
      ephemeral: true,
      payload: { activation: call.activation },
    },
    {
      type: "events.iterate.com/voice-agent/keepalive",
      ephemeral: true,
      payload: { activation: call.activation },
    },
  ]);

  const held = Promise.withResolvers<never[]>();
  root.append.mockImplementationOnce(() => held.promise);
  call.sendMicFrame("last-words");
  const hungUp = call.hangUp("hung up");
  await vi.advanceTimersByTimeAsync(0);
  // the terminal waits for the frame still in flight
  expect(root.appendedTypes().at(-1)).toBe("events.iterate.com/voice-agent/mic-frame");
  held.resolve([]);
  await hungUp;
  await vi.advanceTimersByTimeAsync(VOICE_CALL_KEEPALIVE_MS * 2);
  vi.useRealTimers();

  expect(root.append.mock.calls.slice(4)).toEqual([
    [
      {
        type: "events.iterate.com/voice-agent/call-ended",
        payload: { activation: call.activation, reason: "hung up" },
      },
    ],
  ]);
  expect(heard.facts.at(-1)).toMatchObject({
    type: "events.iterate.com/voice-agent/call-ended",
    payload: { reason: "hung up" },
  });
  expect(call.sendMicFrame("after the end")).toBe(false);
});

test("hanging up waits for call-ended to come back with the answer's last frames, and gives up after a bounded wait when it does not", async () => {
  vi.useFakeTimers();
  const root = project();
  const heard = handlers();
  const call = (await connectVoiceDevice(root, { client: "cli" })).call(heard);
  await call.pressed;
  root.append.mockImplementationOnce(async () => []); // this call-ended never comes back
  const hungUp = call.hangUp("done");
  await vi.advanceTimersByTimeAsync(0);
  root.deliver([frame(call.activation, { pcm: "", lastFrameOfAnswer: true })]);
  await vi.advanceTimersByTimeAsync(5_000);
  await hungUp;
  root.deliver([frame(call.activation, { pcm: "", lastFrameOfAnswer: true })]);
  vi.useRealTimers();

  // the frame after the hang-up belongs to no call
  expect(heard).toMatchObject({ frames: [{ pcm: "", lastFrameOfAnswer: true }] });
});

test("a call the relay neither accepts nor ends within 5 s of the press ends, saying so, and takes no more frames", async () => {
  vi.useFakeTimers();
  const root = project();
  const heard = handlers();
  const call = (await connectVoiceDevice(root, { client: "cli" })).call(heard);
  await vi.advanceTimersByTimeAsync(VOICE_CALL_OPENING_DEADLINE_MS);
  vi.useRealTimers();

  expect(heard.facts).toMatchObject([
    {
      type: "events.iterate.com/voice-agent/call-ended",
      payload: {
        activation: call.activation,
        reason: "the relay did not accept the call within 5000ms of the press",
      },
    },
  ]);
  expect(call.sendMicFrame("too late")).toBe(false);
});

/** A project root whose `itx.voice` provisions devices, and the relay's context the device opens:
 *  records what was provisioned, the paths, subscriptions and appends; `deliver` plays rows to the
 *  subscription. */
test("a device whose link dropped moves to the new one: its call's frames and words go there, the facts that committed in the gap are read from the log once, and an ephemeral frame's offset hides no later fact", async () => {
  const before = project();
  const device = await connectVoiceDevice(before, { client: "phone-447700900001" });
  const heard = handlers();
  const call = device.call(heard);
  before.deliver([
    { ...accepted(call.activation), offset: 7 },
    // an ephemeral frame's offset, which the context's next incarnation may give a durable event
    { ...frame(call.activation, { pcm: "", lastFrameOfAnswer: true }), ephemeral: true, offset: 9 },
  ]);
  const after = project();
  // committed while the link was down (7, 8) and just after the new subscription began (9): a
  // callback subscription starts from now, so the log is where 8 is
  const answer = {
    type: "events.iterate.com/voice-agent/answer-transcribed",
    payload: { activation: call.activation, text: "Good evening." },
    offset: 9,
  };
  after.log.push(
    { ...accepted(call.activation), offset: 7 },
    {
      type: "events.iterate.com/voice-agent/utterance-transcribed",
      payload: { activation: call.activation, text: "Hello?" },
      offset: 8,
    },
    answer,
  );
  await device.moveTo(after);
  call.sendMicFrame("frame-after-move");
  await call.speak("I do apologise, the line dropped for a moment.");
  // the new subscription delivers 9 too: handed on once
  after.deliver([answer]);
  expect({
    before: { subscriptions: before.subscriptions, appended: before.appendedTypes() },
    after: {
      // copied before the check below asks the fake for the context
      cdPaths: [...after.cdPaths],
      readAfter: after.readEvents.mock.calls.map(([afterOffset]) => afterOffset),
      subscriptions: after.subscriptions,
      appended: after.append.mock.calls.map(([event]) => event),
    },
    facts: heard.facts.map((fact) => fact.type),
    itxIsTheNewLink: device.itx === after.cd("/voice/phone-447700900001"),
  }).toMatchObject({
    before: {
      subscriptions: [{ disposed: true }],
      appended: ["events.iterate.com/voice-agent/call-started"],
    },
    after: {
      cdPaths: ["/voice/phone-447700900001"],
      readAfter: [7],
      subscriptions: [{ disposed: false }],
      appended: [
        {
          type: "events.iterate.com/voice-agent/mic-frame",
          payload: { activation: call.activation },
        },
        {
          type: "events.iterate.com/voice-agent/words-given",
          payload: {
            activation: call.activation,
            text: "I do apologise, the line dropped for a moment.",
          },
        },
      ],
    },
    facts: [
      "events.iterate.com/voice-agent/conversation-accepted",
      "events.iterate.com/voice-agent/utterance-transcribed",
      "events.iterate.com/voice-agent/answer-transcribed",
    ],
    itxIsTheNewLink: true,
  });
});

test("a device closed while it moves keeps no subscription on the new link", async () => {
  const before = project();
  const device = await connectVoiceDevice(before, { client: "cli" });
  const after = project();
  const moving = device.moveTo(after);
  device.close();
  await moving;
  expect(after.subscriptions).toMatchObject([{ disposed: true }]);
});

function project() {
  const provisioned: { client: string; screen?: string }[] = [];
  const cdPaths: string[] = [];
  const subscriptions: {
    name?: string;
    consumes?: string[];
    afterOffset?: number;
    target: (events: unknown[]) => void;
    disposed: boolean;
  }[] = [];
  // The log hands a call's terminal back to the subscription, as the real one does.
  const append = vi.fn(async (...events: { type: string }[]): Promise<never[]> => {
    const ended = events.filter(
      (event) => event.type === "events.iterate.com/voice-agent/call-ended",
    );
    for (const subscription of subscriptions)
      if (ended.length > 0 && !subscription.disposed) subscription.target(ended);
    return [];
  });
  const ensureVoiceDevice = vi.fn(async (options: { client: string; screen?: string }) => {
    provisioned.push(options);
    return { path: `/voice/${options.client}`, agentPath: `/agents/voice/${options.client}` };
  });
  /** What `readEvents` reads: the log as the test sets it. */
  const log: { offset: number; type: string; payload: unknown }[] = [];
  const readEvents = vi.fn(async (afterOffset = 0): Promise<StreamPage> => ({
    // the test's events carry what the client reads of them, not a stored event's every field
    events: log.filter((event) => event.offset > afterOffset) as unknown as StreamPage["events"],
    scannedThroughOffset: Math.max(afterOffset, ...log.map((event) => event.offset)),
    atHead: true,
  }));
  const context = {
    append,
    readEvents,
    // the frames' verb, recorded with the rest: the offsets alone come back
    appendOffsets: vi.fn(async (...events: { type: string }[]) =>
      (await append(...events)).map((_, index) => index),
    ),
    subscribe: async (input: {
      name?: string;
      consumes?: string[];
      afterOffset?: number;
      target: unknown;
    }): Promise<{ [Symbol.dispose](): void }> => {
      // the client hands a function target; the SDK's type also admits an expression
      const subscription = {
        name: input.name,
        consumes: input.consumes,
        afterOffset: input.afterOffset,
        target: input.target as (events: unknown[]) => void,
        disposed: false,
      };
      subscriptions.push(subscription);
      return { [Symbol.dispose]: () => void (subscription.disposed = true) };
    },
  };
  return {
    voice: { ensureVoiceDevice },
    cd(path: string) {
      cdPaths.push(path);
      return context;
    },
    provisioned,
    cdPaths,
    subscriptions,
    append,
    appendOffsets: context.appendOffsets,
    log,
    readEvents,
    appendedTypes: () => append.mock.calls.map(([event]) => event?.type),
    deliver: (events: unknown[]) => subscriptions[0]?.target(events),
  };
}

function handlers() {
  const frames: unknown[] = [];
  const facts: VoiceCallFact[] = [];
  return {
    frames,
    facts,
    onSpeakerFrame: (speakerFrame: unknown) => void frames.push(speakerFrame),
    onFact: (fact: VoiceCallFact) => void facts.push(fact),
  };
}

function frame(activation: string, payload: Record<string, unknown>) {
  return {
    type: "events.iterate.com/voice-agent/speaker-frame",
    payload: { activation, ...payload },
  };
}

function accepted(activation: string) {
  return {
    type: "events.iterate.com/voice-agent/conversation-accepted",
    payload: { activation, pressToDialMs: 40, handshakeTookMs: 812, upgradeTookMs: 240, heldMs: 0 },
  };
}

function micFrame(activation: string, pcm: string) {
  return {
    type: "events.iterate.com/voice-agent/mic-frame",
    ephemeral: true,
    payload: { activation, pcm },
  };
}
