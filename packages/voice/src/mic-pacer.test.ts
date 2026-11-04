// mic-pacer.test.ts — the one queue and one pacer between a call's microphone and the live model:
// what the provider hears, in what order, and how fast. The relay's own wiring (its tick, the
// queue's overflow ending the call) is voice-agent.test.ts's.
import { expect, test } from "vitest";
import { MIC_QUEUE_MAX_MS, MicPacer } from "./mic-pacer.ts";

test.for<{
  name: string;
  /** Device frames of 50 ms queued before the provider is ready. */
  heldFrames: number;
  /** When each later device frame of 50 ms arrives, on the clock that starts with the provider. */
  arrivalsAtMs: number[];
  untilMs: number;
  heard: Partial<ReturnType<typeof summary>>;
}>([
  {
    name: "audio held through the handshake goes at once when the provider is ready, and silence follows only once the wall clock passes it",
    heldFrames: 40,
    arrivalsAtMs: [],
    untilMs: 2_500,
    heard: {
      order: ["device×40", "silence×5"],
      firstAtMs: 0,
      lastDeviceFrameAtMs: 0,
      aheadOfPaceMs: 2_000,
      widestBurstMs: 2_000,
    },
  },
  {
    name: "more than 5 s held: 5 s goes at once, the rest at 1.2× real time behind it",
    heldFrames: 116,
    arrivalsAtMs: [],
    untilMs: 1_000,
    heard: {
      order: ["device×116"],
      firstAtMs: 0,
      lastDeviceFrameAtMs: 670,
      aheadOfPaceMs: 5_000,
      widestBurstMs: 5_000,
    },
  },
  {
    name: "a device that streams in real time is heard in order, and silence fills only the gap where it stopped",
    heldFrames: 0,
    arrivalsAtMs: [...range(0, 1_000, 50), ...range(1_500, 2_000, 50)],
    untilMs: 2_000,
    heard: {
      order: ["device×20", "silence×4", "device×10", "silence×1"],
      firstAtMs: 50,
      aheadOfPaceMs: 0,
      widestBurstMs: 40,
    },
  },
  {
    name: "a second of frames that arrives at once after a stall drains at the pace, never in a burst",
    heldFrames: 0,
    arrivalsAtMs: [...range(0, 500, 50), ...Array<number>(20).fill(1_500)],
    untilMs: 4_000,
    heard: {
      order: ["device×10", "silence×9", "device×20", "silence×16"],
      lastDeviceFrameAtMs: 2_250,
      aheadOfPaceMs: 0,
      widestBurstMs: 50,
    },
  },
])("$name", ({ heldFrames, arrivalsAtMs, untilMs, heard }) => {
  const pacer = new MicPacer();
  for (let index = 0; index < heldFrames; index++) pacer.push(DEVICE_FRAME, 50);
  pacer.start(0);
  const sent: { atMs: number; pcm: string }[] = [];
  let next = 0;
  // The relay takes on each arrival and on its tick; 10 ms is finer than its tick.
  for (let atMs = 0; atMs <= untilMs; atMs += 10) {
    while (next < arrivalsAtMs.length && arrivalsAtMs[next]! <= atMs) {
      pacer.push(DEVICE_FRAME, 50);
      next++;
    }
    for (const pcm of pacer.take(atMs)) sent.push({ atMs, pcm });
  }
  expect(summary(sent)).toMatchObject(heard);
});

test("frames longer than the 100 ms cap never run past the 5 s burst plus 1.2× real time", () => {
  const pacer = new MicPacer();
  // 5.1 s held, in 300 ms frames: 5 s is not a whole number of them
  for (let index = 0; index < 17; index++) pacer.push(`frame-${index}`, 300);
  pacer.start(0);
  let sentMs = 0;
  let aheadMs = 0;
  let lastAtMs = 0;
  for (let atMs = 0; atMs <= 1_000; atMs += 10)
    for (const pcm of pacer.take(atMs))
      if (pcm.startsWith("frame-")) {
        sentMs += 300;
        aheadMs = Math.max(aheadMs, sentMs - 1.2 * atMs);
        lastAtMs = atMs;
      }
  // 16 frames at once (4.8 s), the 17th once the bucket holds a whole frame
  expect({ sentMs, aheadMs: Math.round(aheadMs), lastAtMs }).toEqual({
    sentMs: 5_100,
    aheadMs: 4_992,
    lastAtMs: 90,
  });
});

test("the queue holds 6 s of audio and refuses the frame that would take it past", () => {
  const pacer = new MicPacer();
  const accepted = Array.from({ length: MIC_QUEUE_MAX_MS / 50 + 1 }, () =>
    pacer.push(DEVICE_FRAME, 50),
  );
  expect({ refused: accepted.indexOf(false), queuedMs: pacer.queuedMs }).toEqual({
    refused: 120,
    queuedMs: 6_000,
  });
});

/** 50 ms of 16 kHz PCM16 at a level silence never has. */
const DEVICE_FRAME = Buffer.alloc(1_600, 0x11).toString("base64");

function range(fromMs: number, toMs: number, stepMs: number): number[] {
  return Array.from({ length: (toMs - fromMs) / stepMs }, (_, index) => fromMs + index * stepMs);
}

/** What the provider heard, run-length encoded, and how fast it went: `aheadOfPaceMs` is how far
 *  the audio sent by any moment ran ahead of 1.2× the time since the start (0 when it never did),
 *  `widestBurstMs` the most audio any window sent beyond 1.2× its own length. */
function summary(sent: { atMs: number; pcm: string }[]) {
  const order: string[] = [];
  let run = { kind: "", count: 0 };
  for (const { pcm } of sent) {
    const kind = pcm === DEVICE_FRAME ? "device" : "silence";
    if (kind === run.kind) run.count++;
    else {
      if (run.count > 0) order.push(`${run.kind}×${run.count}`);
      run = { kind, count: 1 };
    }
  }
  if (run.count > 0) order.push(`${run.kind}×${run.count}`);
  const ms = (pcm: string) => (pcm === DEVICE_FRAME ? 50 : 100);
  let aheadOfPaceMs = 0;
  let widestBurstMs = 0;
  let total = 0;
  for (const [index, { atMs, pcm }] of sent.entries()) {
    total += ms(pcm);
    aheadOfPaceMs = Math.max(aheadOfPaceMs, total - 1.2 * atMs);
    let window = 0;
    for (let start = index; start >= 0; start--) {
      window += ms(sent[start]!.pcm);
      // a window opens just after the send before it, so its length is the gap since then
      const openedAtMs = start > 0 ? sent[start - 1]!.atMs : 0;
      widestBurstMs = Math.max(widestBurstMs, window - 1.2 * (atMs - openedAtMs));
    }
  }
  return {
    order,
    firstAtMs: sent[0]?.atMs,
    lastDeviceFrameAtMs: sent.findLast(({ pcm }) => pcm === DEVICE_FRAME)?.atMs,
    aheadOfPaceMs: Math.round(aheadOfPaceMs),
    widestBurstMs: Math.round(widestBurstMs),
  };
}
