// call-client.ts — a device's calls as a client makes them. `connectVoiceDevice` provisions the
// device (`itx.voice.ensureVoiceDevice`) and subscribes ONCE to its relay's context; each `call()` is
// then the press, ONE append of `call-started` under a new activation, after which microphone
// frames go up at once as ephemeral `mic-frame` appends, never waiting for an answer. Frames that
// come while the link is slow wait, and go together in the next free append, one event each. A
// `keepalive` every 20 s says the caller is still there through a quiet stretch, and hanging up appends
// `call-ended`. The subscription routes each frame and fact to its call by activation. A client whose
// link to the project can drop (a phone bridge under `iterate provide`) carries its device to the
// new link with `moveTo`.
// packages/voice-app's page runs it with the browser's worklets and
// packages/agents-app/scripts/voice-call.ts from Node with WAV files; Kit's firmware speaks the same
// calls in C (iterate/kit's firmware/components/voice/src/voice_loop.c).
import { z } from "zod";
import type { IterateContextApi } from "iterate/api";
import { errorCode } from "iterate/lib";
import type { VoiceApi } from "./api.ts";
import { PCM16_BYTES_PER_MS } from "./mic-pacer.ts";

/** How often a live call says `keepalive`: the relay reaps a call after 60 s without device input,
 *  and a caller who listens quietly sends none. */
export const VOICE_CALL_KEEPALIVE_MS = 20_000;

/** A call the relay has neither accepted nor ended this long after the press ends here, saying
 *  so: the relay's own opening deadline is 5 s from its dial. */
export const VOICE_CALL_OPENING_DEADLINE_MS = 5_000;

/** At most this many microphone appends in flight at once. The frames that come while all of them
 *  are out wait, and go together in the next one to free: a relay that is waking takes about a second
 *  over its first appends, and dropping frames then cut off the start of what was said. */
const MIC_APPENDS_IN_FLIGHT = 5;

/** The most microphone audio one append carries. */
const MIC_APPEND_MAX_MS = 1_000;

/** The most microphone audio this client holds, in flight or waiting. Enough for a relay that is
 *  waking, and far under the 6 s the relay holds before it ends a call (mic-pacer.ts
 *  `MIC_QUEUE_MAX_MS`): a link that stalls mid-call and recovers sends at most this at once, so it
 *  cannot end the call. Past it a frame is dropped. */
const MIC_HELD_MAX_MS = 2_000;

/** A move reads at most this many pages of 200 events from the gap: a link is down for seconds,
 *  and a call writes a few events a second. */
const MOVE_GAP_PAGES = 10;

/** How long hanging up waits for a `call-ended` to come back through the subscription before it
 *  ends it. The subscription delivers in log order, so once the echo is here every speaker frame
 *  the relay wrote before the end has reached `onSpeakerFrame`. */
const HANG_UP_ECHO_MS = 2_000;

/** One chunk of the answer as the relay wrote it: 16 kHz mono PCM16, base64 (empty on a frame that
 *  only marks the answer's end). */
export type VoiceCallSpeakerFrame = {
  pcm: string;
  /** Throw away everything queued, then play this frame. */
  clearSpeakerBufferBeforeFrame?: boolean;
  /** Nothing more is coming for this answer. */
  lastFrameOfAnswer?: boolean;
};

const SpeakerFrame = z.object({
  type: z.literal("events.iterate.com/voice-agent/speaker-frame"),
  payload: z.looseObject({
    activation: z.string(),
    pcm: z.string(),
    clearSpeakerBufferBeforeFrame: z.boolean().optional(),
    lastFrameOfAnswer: z.boolean().optional(),
  }),
});

/** A call's facts, as much of each payload as a caller reads (voice-agent.ts's contract writes
 *  them; their other fields pass through). Each names its call's activation. */
const CallFact = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("events.iterate.com/voice-agent/call-started"),
    payload: z.looseObject({ activation: z.string() }),
  }),
  z.object({
    type: z.literal("events.iterate.com/voice-agent/conversation-accepted"),
    payload: z.looseObject({
      activation: z.string(),
      pressToDialMs: z.number(),
      handshakeTookMs: z.number(),
      upgradeTookMs: z.number(),
      heldMs: z.number(),
    }),
  }),
  z.object({
    type: z.literal("events.iterate.com/voice-agent/call-ended"),
    payload: z.looseObject({ activation: z.string(), reason: z.string() }),
  }),
  z.object({
    type: z.literal("events.iterate.com/voice-agent/audio-trimmed"),
    payload: z.looseObject({ activation: z.string(), ms: z.number() }),
  }),
  z.object({
    type: z.literal("events.iterate.com/voice-agent/utterance-transcribed"),
    payload: z.looseObject({ activation: z.string(), text: z.string() }),
  }),
  z.object({
    type: z.literal("events.iterate.com/voice-agent/answer-transcribed"),
    payload: z.looseObject({ activation: z.string(), text: z.string() }),
  }),
  z.object({
    type: z.literal("events.iterate.com/voice-agent/provider-error-reported"),
    payload: z.looseObject({ activation: z.string(), message: z.string() }),
  }),
  z.object({
    type: z.literal("events.iterate.com/voice-agent/provider-disconnected"),
    payload: z.looseObject({ activation: z.string(), reason: z.string() }),
  }),
]);

/** What the client reads of any delivered event to hand each durable one on once: its offset, and
 *  whether it is ephemeral. */
const StoredEvent = z.looseObject({ offset: z.number(), ephemeral: z.boolean().optional() });

/** The device's agent's messages, which a row on its context copies to the relay's: they name no
 *  call, so each goes to the calls in progress. */
const AgentMessage = z.object({
  type: z.literal("events.iterate.com/agent/web-message-sent"),
  payload: z.looseObject({ message: z.string(), llmRequestOffset: z.number().optional() }),
});

export type VoiceCallFact = z.infer<typeof CallFact> | z.infer<typeof AgentMessage>;

/** What this client saw of the call, counted here because the relay cannot see the last hop. */
export type VoiceCallStats = {
  micFramesSent: number;
  /** Frames offered with `MIC_HELD_MAX_MS` of audio already in flight or waiting, a link too slow
   *  for the call, and frames still waiting when the call ended. */
  micFramesDropped: number;
  /** Frames whose append failed. */
  micFramesFailed: number;
  spkChunksReceived: number;
  spkMsReceived: number;
  handshakeMs: number | null;
  /** The press to `conversation-accepted`, on this client's clock. */
  pressToAcceptedMs: number | null;
  /** The press to the answer's first audio, on this client's clock. */
  pressToFirstAudioMs: number | null;
};

/** One call: its press is already on its way when `call()` returns. */
export type VoiceCall = {
  activation: string;
  stats: VoiceCallStats;
  /** Settles once the press has landed; rejects with why it was refused. */
  pressed: Promise<void>;
  /** Send one microphone frame (16 kHz mono PCM16, base64) without waiting for it, at once or with
   *  the next free append; false when `MIC_HELD_MAX_MS` of audio is already held and the frame was
   *  dropped, or the call is over. */
  sendMicFrame(pcm: string): boolean;
  /** Give the voice words to say in this call, such as a phone bridge's opening line
   *  (`voice-agent/words-given`), appended once the press has landed: said at once, or once the
   *  session starts. */
  speak(text: string): Promise<void>;
  /** Stop the microphone and the keepalive, send what waits and wait for it, append `call-ended`
   *  with `reason` unless the call is already over, and wait (at most 2 s) for the answer's last
   *  frames to arrive. */
  hangUp(reason: string): Promise<void>;
};

export type VoiceDevice<Context> = {
  /** The relay's context on the device's current link: what a live-state view subscribes to. */
  readonly itx: Context;
  /** The relay's context path, `/voice/<client>`. */
  path: string;
  /** The device's agent, `/agents/voice/<client>`, which answers every call's delegations. */
  agentPath: string;
  /** The press. `onSpeakerFrame` gets this call's answer frames, `onFact` its facts and the
   *  agent's messages while it lasts, both in log order. */
  call(handlers: {
    onSpeakerFrame(frame: VoiceCallSpeakerFrame): void;
    onFact(fact: VoiceCallFact): void;
  }): VoiceCall;
  /** The link the device rode on is gone (`iterate provide` reconnected): carry it to `project`,
   *  the new link's root. Calls in progress send their frames and keepalives there; a new
   *  subscription starts, and the log after the last fact delivered is read, so a `call-ended` or a
   *  transcript that landed in the gap still arrives. The answer's audio from the gap is lost: it is
   *  ephemeral. */
  moveTo(project: { cd(path: string): Context }): Promise<void>;
  /** End the subscription; a call in progress is not hung up. */
  close(): void;
};

/** A call's own part of the subscription: what it hands its frames and facts to. */
type CallRoute = {
  speakerFrame(frame: VoiceCallSpeakerFrame): void;
  fact(fact: VoiceCallFact): void;
};

/** Provision `client` on `project` (a root whose `itx.voice` is installed) and subscribe to its
 *  relay's context. `client` names the device: a Kit board's `itx.clients` name, or the
 *  installation id a browser or the CLI keeps. Resolves once both have answered. */
export async function connectVoiceDevice<
  Context extends Pick<IterateContextApi, "subscribe" | "append" | "appendOffsets" | "readEvents">,
>(
  project: { voice: Pick<VoiceApi, "ensureVoiceDevice">; cd(path: string): Context },
  options: { client: string; screen?: string },
): Promise<VoiceDevice<Context>> {
  const { path, agentPath } = await project.voice.ensureVoiceDevice({
    client: options.client,
    screen: options.screen,
  });
  let itx = project.cd(path);
  const calls = new Map<string, CallRoute>();
  /** The offset of the last durable event delivered: a moved device reads the log after it. An
   *  ephemeral event's offset is not counted: a new incarnation of the context numbers its next
   *  durable events from the last durable one, so they can reuse an ephemeral frame's offset. */
  let lastOffset: number | undefined;
  /** While `moveTo` reads the gap, what the new subscription delivers waits here. */
  let held: unknown[] | null = null;
  let closed = false;
  /** Events, in log order, to their calls: each durable one once, though a move reads it from the
   *  log and the new subscription may deliver it too. */
  const deliver = (events: unknown[]) => {
    for (const event of events) {
      const stored = StoredEvent.safeParse(event);
      if (stored.success && !stored.data.ephemeral) {
        const { offset } = stored.data;
        if (lastOffset !== undefined && offset <= lastOffset) continue;
        lastOffset = offset;
      }
      route(event);
    }
  };
  /** A live-callback subscription starts from now: it ignores `afterOffset`. */
  const subscribeOn = (context: Context) =>
    context.subscribe({
      name: `${options.client}-${randomHex(4)}`,
      consumes: [
        "events.iterate.com/voice-agent/speaker-frame",
        AgentMessage.shape.type.value,
        ...CallFact.options.map((fact) => fact.shape.type.value),
      ],
      target: (events) => {
        if (held) held.push(...events);
        else deliver(events);
      },
    });
  /** One delivered event to its call; the agent's messages to every call in progress. */
  function route(event: unknown): void {
    const frame = SpeakerFrame.safeParse(event);
    if (frame.success) {
      calls.get(frame.data.payload.activation)?.speakerFrame(frame.data.payload);
      return;
    }
    const message = AgentMessage.safeParse(event);
    if (message.success) {
      for (const call of calls.values()) call.fact(message.data);
      return;
    }
    const fact = CallFact.safeParse(event);
    if (fact.success) calls.get(fact.data.payload.activation)?.fact(fact.data);
  }
  let subscription = await subscribeOn(itx);

  // A FRAME'S ANSWER IS ITS OFFSET ALONE (`appendOffsets`): the frame does not travel back down the
  // device's link. A platform without the verb refuses it as no match; the frames then go as
  // `append`s.
  let framesAsAppends = false;
  const appendFrames = async (events: Parameters<IterateContextApi["append"]>) => {
    if (!framesAsAppends)
      try {
        return await itx.appendOffsets(...events);
      } catch (error) {
        if (errorCode(error) !== "NO_ITX_EXPRESSION_MATCH") throw error;
        framesAsAppends = true;
      }
    return await itx.append(...events);
  };

  return {
    get itx() {
      return itx;
    },
    path,
    agentPath,
    call({ onSpeakerFrame, onFact }) {
      const activation = randomHex(16);
      const pressedAt = Date.now();
      const stats: VoiceCallStats = {
        micFramesSent: 0,
        micFramesDropped: 0,
        micFramesFailed: 0,
        spkChunksReceived: 0,
        spkMsReceived: 0,
        handshakeMs: null,
        pressToAcceptedMs: null,
        pressToFirstAudioMs: null,
      };
      const ended = Promise.withResolvers<void>();
      let open = true;
      let over = false;
      const inFlight = new Set<Promise<unknown>>();
      /** Frames waiting for a free append, oldest first, and the audio they and the appends in
       *  flight hold. */
      const waiting: { pcm: string; ms: number }[] = [];
      let waitingMs = 0;
      let inFlightMs = 0;
      /** Each free append takes what waits, oldest first, up to `MIC_APPEND_MAX_MS`; once the call
       *  is over, nothing waiting is worth sending. */
      const sendWaiting = () => {
        if (over) {
          stats.micFramesDropped += waiting.length;
          waiting.length = 0;
          waitingMs = 0;
        }
        while (waiting.length > 0 && inFlight.size < MIC_APPENDS_IN_FLIGHT) {
          const batch = [waiting.shift()!];
          let batchMs = batch[0]!.ms;
          while (waiting.length > 0 && batchMs + waiting[0]!.ms <= MIC_APPEND_MAX_MS) {
            const frame = waiting.shift()!;
            batch.push(frame);
            batchMs += frame.ms;
          }
          waitingMs -= batchMs;
          inFlightMs += batchMs;
          stats.micFramesSent += batch.length;
          const sent = appendFrames(
            batch.map(({ pcm }) => ({
              type: "events.iterate.com/voice-agent/mic-frame",
              ephemeral: true,
              payload: { activation, pcm },
            })),
          )
            .catch(() => {
              stats.micFramesFailed += batch.length;
            })
            .finally(() => {
              inFlight.delete(sent);
              inFlightMs -= batchMs;
              sendWaiting();
            });
          inFlight.add(sent);
        }
      };
      const end = (reason: string) =>
        itx
          .append({
            type: "events.iterate.com/voice-agent/call-ended",
            payload: { activation, reason },
          })
          .then(
            () => true,
            () => false,
          );
      const openingDeadline = setTimeout(() => {
        if (stats.pressToAcceptedMs === null && !over)
          void end(
            `the relay did not accept the call within ${VOICE_CALL_OPENING_DEADLINE_MS}ms of the press`,
          );
      }, VOICE_CALL_OPENING_DEADLINE_MS);
      const keepalive = setInterval(() => {
        void itx
          .append({
            type: "events.iterate.com/voice-agent/keepalive",
            ephemeral: true,
            payload: { activation },
          })
          .catch(() => undefined);
      }, VOICE_CALL_KEEPALIVE_MS);
      const stop = () => {
        open = false;
        clearTimeout(openingDeadline);
        clearInterval(keepalive);
      };
      calls.set(activation, {
        speakerFrame(frame) {
          if (frame.pcm) {
            stats.pressToFirstAudioMs ??= Date.now() - pressedAt;
            stats.spkChunksReceived += 1;
            stats.spkMsReceived += pcmMs(frame.pcm);
          }
          onSpeakerFrame(frame);
        },
        fact(fact) {
          if (fact.type === "events.iterate.com/voice-agent/conversation-accepted") {
            stats.handshakeMs = fact.payload.handshakeTookMs;
            stats.pressToAcceptedMs = Date.now() - pressedAt;
            clearTimeout(openingDeadline);
          }
          onFact(fact);
          if (fact.type === "events.iterate.com/voice-agent/call-ended") {
            over = true;
            stop();
            calls.delete(activation);
            ended.resolve();
          }
        },
      });
      // THE PRESS: one append, and the frames follow it at once.
      const pressed = itx
        .append({
          type: "events.iterate.com/voice-agent/call-started",
          idempotencyKey: `voice-agent/call:${activation}`,
          payload: { activation },
        })
        .then(() => undefined);
      // a refused press is a call that never was: nothing still waiting goes after it
      pressed.catch(() => {
        over = true;
        stop();
        calls.delete(activation);
        sendWaiting();
      });
      return {
        activation,
        stats,
        pressed,
        sendMicFrame(pcm) {
          if (!open) return false;
          const ms = pcmMs(pcm);
          if (waitingMs + inFlightMs + ms > MIC_HELD_MAX_MS) {
            stats.micFramesDropped += 1;
            return false;
          }
          waiting.push({ pcm, ms });
          waitingMs += ms;
          sendWaiting();
          return true;
        },
        async speak(text) {
          // after the press, so the relay reads the words with their call open
          await pressed;
          await itx.append({
            type: "events.iterate.com/voice-agent/words-given",
            payload: { activation, text },
          });
        },
        async hangUp(reason) {
          stop();
          // each append that ends sends what waits: the last words before a hang-up count too
          while (inFlight.size > 0) await Promise.all(inFlight);
          if (!over && (await end(reason))) {
            let timer: ReturnType<typeof setTimeout> | undefined;
            await Promise.race([
              ended.promise,
              new Promise((resolve) => (timer = setTimeout(resolve, HANG_UP_ECHO_MS))),
            ]);
            clearTimeout(timer);
          }
          calls.delete(activation);
        },
      };
    },
    async moveTo(next) {
      try {
        subscription[Symbol.dispose]();
      } catch {
        // the old link is gone, and its subscription with it
      }
      itx = next.cd(path);
      held = [];
      try {
        const moved = await subscribeOn(itx);
        if (closed) {
          moved[Symbol.dispose]();
          return;
        }
        subscription = moved;
        // What committed while the link was down is in the log, after the last durable offset this
        // device delivered; MOVE_GAP_PAGES bounds the read.
        if (lastOffset === undefined) return;
        let after = lastOffset;
        for (let page = 0; page < MOVE_GAP_PAGES; page++) {
          const read = await itx.readEvents(after, 200);
          deliver(read.events);
          if (read.atHead) return;
          after = read.scannedThroughOffset;
        }
      } finally {
        const waiting = held;
        held = null;
        deliver(waiting);
      }
    },
    close() {
      closed = true;
      calls.clear();
      try {
        subscription[Symbol.dispose]();
      } catch {
        // the session may already be gone
      }
    },
  };
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** How much audio base64 PCM16 holds: 3 bytes in every 4 characters, `PCM16_BYTES_PER_MS` a ms. */
function pcmMs(pcm: string): number {
  return Math.floor((pcm.replace(/=+$/, "").length * 3) / 4) / PCM16_BYTES_PER_MS;
}
