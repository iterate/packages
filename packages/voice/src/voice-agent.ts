/**
 * A device's GPT-Live calls as a facet processor on the device's own context, `/voice/<device>`:
 * it holds the provider socket, forwards microphone frames in and speaker frames out, and folds
 * the transcript. The device's agent is a context of its own, `/agents/voice/<device>`
 * (worker.ts `ensureVoiceDevice` provisions both, before any press): each delegation the live
 * model raises is handed to that agent as a message (`itx.agents.get(path).message(words)`), and
 * the agent's answers, which a row on its context copies here, go back to the live model to
 * speak. A call is one activation: the device's `call-started` opens it, and the relay dials in
 * the batch that carries it.
 */
// registers `itx.agents` on InstalledAppRoots
import type {} from "iterate/agents";
import { AgentContract } from "iterate/agents/contract";
import type { IterateContextApiWith } from "iterate/api";
import { bytesToBase64 } from "iterate/lib";
import { StreamProcessorDurableObject } from "iterate/sdk";
import {
  StreamProcessor,
  defineProcessorContract,
  type ConsumedEvent,
  type ProcessEventArgs,
  type ReduceArgs,
} from "iterate/stream/processor";
import { z } from "zod";
import { MIC_QUEUE_MAX_MS, MicPacer, PCM16_BYTES_PER_MS } from "./mic-pacer.ts";

/** The device's call identity: the press mints it, and every fact and frame of the call carries it. */
const Activation = z.string().min(1).max(64);

/** How far one activation got before the live model answered, for its `call-ended`. */
const StartupSummary = z.looseObject({
  /** `call-started`'s commit to the dial, the stream's clock to the facet's. */
  pressToDialMs: z.number(),
  handshakeTookMs: z.number().optional(),
  upgradeTookMs: z.number().optional(),
  heldMs: z.number().optional(),
  trimmedMs: z.number().optional(),
});
type StartupSummary = z.infer<typeof StartupSummary>;

/** Fixed GPT-Live session configuration. */
const LIVE = {
  url: "https://api.openai.com/v1/live/sessions",
  model: "gpt-live-1",
  voice: "marin",
  rate: 16_000,
} as const;

/** The most audio one speaker frame may carry: one 100 ms GPT-Live delta, which fits the
 * device's 4,800-byte decoded chunk and 6,912-byte base64 buffer. */
const MAX_SPEAKER_PAYLOAD_BYTES = 3_200;

/** The device holds ten seconds of speaker audio; more than that queued here means an append
 * has stalled. */
const SPEAKER_OUTBOX_MAX_BYTES = 10_000 * PCM16_BYTES_PER_MS;

/** A transcript fragment this far (on the session timeline) after the same speaker's previous
 * one starts a new turn; the fragments themselves carry no turn boundaries. The two speakers may
 * overlap, so the open rows are per speaker. */
const TURN_GAP_MS = 1_200;

/** No input from the device for this long and the call is over. */
const IDLE_TIMEOUT_MS = 60_000;

/** The microphone pacer's tick (mic-pacer.ts): a frame its credit cannot cover yet waits at most
 * this long beyond it. */
const MIC_PACER_TICK_MS = 20;

/** A device sends frames from the press, never waiting for an answer, so a frame can reach the
 *  relay a moment before its own `call-started` does. Up to this much audio of an activation the
 *  relay has no call for waits for that call; past it, or once another activation's frame comes,
 *  it is not a press in flight and is dropped. */
const EARLY_FRAMES_MAX_MS = 1_000;

/** The idle stamp in the fold advances in steps of this, not per frame: the deadline is a
 * minute, so most microphone batches leave the reduced state untouched. */
const IDLE_STAMP_STEP_MS = 5_000;

/** Socket creation and `session.started` must both finish within this bound. */
const OPENING_DEADLINE_MS = 5_000;

/** An agent answer ending in this token (voice-context.md asks for it after a goodbye) arms a
 * hang-up before GPT-Live speaks the goodbye: the call ends at the first answer ending after that,
 * or after this grace when no answer arrives. The token itself is never spoken. */
const HANG_UP_TOKEN = "HANG_UP";
export const HANG_UP_GOODBYE_GRACE_MS = 8_000;

/** The floor between unprompted spoken progress notes, counted from the hand-over itself: work
 * that answers sooner is simply answered, and a long job is narrated, not ticked through. */
const SPOKEN_PROGRESS_MIN_GAP_MS = 10_000;

/** What the live model is told about the arrangement, structured the way the provider's prompting
 * guide asks (role, backchannel policy, interruption policy, a labelled delegation policy). It is
 * transparent about the backend on purpose: a model forbidden to mention it invented explanations
 * for delays. */
const LIVE_DELEGATION_POLICY = [
  "Backchannel policy: Use moderate backchannels. Acknowledge naturally without competing",
  "with the main response.",
  "Interruption policy: Stop speaking when the user interrupts. Listen to what they say.",
  "",
  "Delegation policy:",
  "Backend tools:",
  "- This project’s standard Agent processor: it can read and change the",
  "  project, look things up, run scripts, and end this call after saying goodbye.",
  "Ending the call:",
  "- Always request a NEW client delegation when the user asks to end or hang up,",
  "  or when the conversation is clearly over, even after earlier backend work completed.",
  "- Only the backend closes the call. Saying goodbye does not close it: delegate",
  "  BEFORE a goodbye, then wait for the backend's goodbye result.",
  "- Do not stop conversing merely because you acknowledged ending. If the user still",
  "  asks, respond and delegate again.",
  "Delegate to the backend when:",
  "- The person asks for information, reasoning, a lookup, a change, device control, or",
  "  ending the call. Delegate even trivial requests. When uncertain, delegate.",
  "- The person repeats or corrects a request. Every newly spoken request needs a NEW",
  "  client delegation, even if an identical request appears in prior conversation history.",
  "Do not delegate to the backend when:",
  "- It is social conversation, a brief clarifying question, or repeating a verified result.",
  "Request client delegation IMMEDIATELY, BEFORE acknowledging an action or saying",
  "you will check. Saying 'I'll check' does not start backend work. Only after delegating",
  "may you say you've handed it over. Past acknowledgments in conversation history do not",
  "mean a request in this new call has been delegated. Keep conversing while the Agent works.",
  "Do not guess results or invent progress. Say a thing is",
  "done only when the backend has reported it done for THAT request. Relay backend results",
  "faithfully, read one out in full when the person wants the details, and correct yourself",
  "plainly if one contradicts something you said. If the backend reports a failure, SAY SO",
  "— never invent an explanation for a delay or a result you have not seen.",
  "Progress policy:",
  "- The backend's progress reaches you as notes beginning 'Progress:', and they are ground truth",
  "  about what it is doing right now. When the person asks how it is going, relay the latest",
  "  one plainly ('it's checking your trolley now'); if none has arrived, say the work just started.",
  "- When a progress note arrives for you to say, it is a progress ping, not a result: a FEW",
  "  WORDS ('still checking the trolley', 'a script failed, it's having another go'). Never pad,",
  "  never re-say the previous note in new words, never speculate past what it says, and never",
  "  present it as done. If the real answer has arrived, say THAT instead.",
  "- Other words from the backend while it works are messages it chose to tell the person now:",
  "  say them.",
].join("\n");

/** A fold transcript turn: who spoke, and what the provider heard them say. */
interface TranscriptTurn {
  role: "listener" | "assistant";
  text: string;
}

/** Fold one finished turn onto the call's transcript for the live view: the newest 20 turns, each
 * cut to 600 characters. */
function foldTranscriptTurn(transcript: TranscriptTurn[], turn: TranscriptTurn): TranscriptTurn[] {
  const text = turn.text.length > 600 ? `${turn.text.slice(0, 600)}…` : turn.text;
  return [...transcript, { role: turn.role, text }].slice(-20);
}

/** Each Live context append allows 500 tokens. UTF-8 bytes are a conservative upper bound,
 * independent of language and tokenizer; split at spaces where possible. */
function* commentaryChunks(text: string): Generator<string> {
  const encoder = new TextEncoder();
  let chunk = "";
  let bytes = 0;
  for (const character of text) {
    const size = encoder.encode(character).length;
    if (bytes + size > 500) {
      const space = chunk.lastIndexOf(" ");
      const boundary = space > 0 ? space + 1 : chunk.length;
      yield chunk.slice(0, boundary);
      chunk = chunk.slice(boundary);
      bytes = encoder.encode(chunk).length;
    }
    chunk += character;
    bytes += size;
  }
  if (chunk) yield chunk;
}

/* Audio crosses this file as base64 strings: the device, the stream and GPT-Live all speak
 * 16 kHz PCM16, so a frame is never re-encoded, only measured. */

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Decoded byte length of a base64 string, without decoding it. */
function base64ByteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor(base64.length / 4) * 3 - padding;
}

/** All-zero bytes encode to nothing but `A`s (plus padding). */
const ALL_ZERO_BASE64 = /^A+=*$/;

/** The loudest sample in a base64 PCM16 delta. Exact digital silence, the idle stream's whole
 * content, is recognised off the string; anything else decodes once and scans. */
function peakOfBase64Pcm16(base64: string): number {
  if (base64 === "" || ALL_ZERO_BASE64.test(base64)) return 0;
  const bytes = base64ToBytes(base64);
  let peak = 0;
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const sample = ((bytes[index]! | (bytes[index + 1]! << 8)) << 16) >> 16;
    const magnitude = sample < 0 ? -sample : sample;
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}

/** Everything that outlives the Durable Object holding the socket. No queues, no byte counts, no
 * "is speaking" flag: reduced state that depends on a buffer no restart can replay is a lie. */
const VoiceState = z.object({
  /** The device's agent, which provisioning names: every hand-over goes there. */
  agentPath: z.string().nullable().default(null),
  /** The current call's newest finished turns, for the live view; a new call starts empty. */
  transcript: z
    .array(z.strictObject({ role: z.enum(["listener", "assistant"]), text: z.string() }))
    .default([]),
  call: z
    .object({
      activation: Activation,
      /** When the stream committed the device's most recent input (a mic frame or a keepalive).
       * The device's input only: the agent's own speech leaves no durable event. */
      lastDeviceInputAtStreamMs: z.number(),
    })
    .nullable()
    .default(null),
  /** How the last call ended, for the live view a browser renders after hanging up. */
  lastEnd: z.object({ activation: Activation, reason: z.string() }).nullable().default(null),
});

/** What a client renders live (`itx.facets.get('voice-agent').liveSnapshot()` seeds it, the
 * `itx/live-state-changed` deltas keep it current): the fold plus the two runtime facts a page wants. */
export type VoiceLiveView = {
  /** No call; a call whose provider dial is not ready; a live call; the last call's aftermath. */
  phase: "idle" | "dialing" | "live" | "ended";
  activation: string | null;
  /** The provider is speaking right now (the answer's frames are going to the device). */
  answering: boolean;
  transcript: TranscriptTurn[];
  lastEnd: { activation: string; reason: string } | null;
};

const VoiceAgentContract = defineProcessorContract({
  slug: "voice-agent",
  version: "3.0.0",
  description:
    "Runs a device's GPT-Live calls on the device's own context, relaying audio both ways as it arrives and the live model's delegations to the device's agent.",
  stateSchema: VoiceState,
  events: {
    "events.iterate.com/voice-agent/device-provisioned": {
      description:
        "The device has its two contexts: this one, the relay's, and its agent's, which every hand-over goes to.",
      payloadSchema: z.looseObject({ agentPath: z.string().startsWith("/") }),
    },
    /* The device's half of a call is the press, audio, a heartbeat and the hang-up. */
    "events.iterate.com/voice-agent/call-started": {
      description:
        "The press: the device's one append that opens a call under a new activation. The relay dials in the batch that carries it.",
      payloadSchema: z.looseObject({ activation: Activation }),
    },
    "events.iterate.com/voice-agent/keepalive": {
      description:
        "The client's call UI is alive, said every ~20s: feeds the idle deadline so a caller " +
        "who waits quietly is not reaped at 60s of mic silence.",
      ephemeral: true,
      payloadSchema: z.looseObject({ activation: Activation }),
    },
    "events.iterate.com/voice-agent/mic-frame": {
      description: "One capture chunk of the call named by its activation.",
      ephemeral: true,
      payloadSchema: z.looseObject({
        activation: Activation,
        /** 16 kHz mono PCM16, base64. */
        pcm: z.string(),
      }),
    },
    "events.iterate.com/voice-agent/conversation-accepted": {
      description: "The provider started the session; the call is live.",
      payloadSchema: z.looseObject({
        activation: Activation,
        /** `call-started`'s commit to the dial, the stream's clock to the facet's. */
        pressToDialMs: z.number(),
        /** Facet clock: dial to usable. */
        handshakeTookMs: z.number(),
        /** Facet clock: dial to the provider's 101, the egress and upgrade share of the handshake. */
        upgradeTookMs: z.number(),
        /** Microphone audio queued during the handshake, in ms: up to 5 s goes at once, the rest
         *  at the pacer's pace. */
        heldMs: z.number(),
      }),
    },
    "events.iterate.com/voice-agent/audio-trimmed": {
      description:
        "More microphone audio arrived than the relay queues for the provider; the call ends " +
        "and this much audio never reached the live model.",
      payloadSchema: z.looseObject({ activation: Activation, ms: z.number() }),
    },
    "events.iterate.com/voice-agent/call-ended": {
      description:
        "The call is over; the device appends it too (the hang-up button). The relay's own says how far the call got.",
      payloadSchema: z.looseObject({
        activation: Activation,
        reason: z.string(),
        startup: StartupSummary.optional(),
      }),
    },
    "events.iterate.com/voice-agent/provider-error-reported": {
      description: "The provider reported an error, verbatim.",
      payloadSchema: z.looseObject({ activation: Activation, message: z.string() }),
    },
    "events.iterate.com/voice-agent/provider-disconnected": {
      description: "The provider's session or socket closed under a live call.",
      payloadSchema: z.looseObject({ activation: Activation, reason: z.string() }),
    },
    /* The durable transcript: one event per finished turn per side, grouped from the provider's
     * timeline fragments. The fold keeps the call's newest turns for the live view. */
    "events.iterate.com/voice-agent/utterance-transcribed": {
      description: "The provider's transcription of one finished listener turn.",
      payloadSchema: z.looseObject({
        activation: Activation,
        text: z.string(),
        key: z.string().optional(),
      }),
    },
    "events.iterate.com/voice-agent/answer-transcribed": {
      description:
        "The provider's own transcript of one finished spoken answer — what was said, not " +
        "necessarily what was heard: the listener may have talked over it.",
      payloadSchema: z.looseObject({
        activation: Activation,
        text: z.string(),
        key: z.string().optional(),
      }),
    },
    "events.iterate.com/voice-agent/speaker-frame": {
      description: "One chunk of the answer, forwarded as it arrived.",
      ephemeral: true,
      payloadSchema: z.looseObject({
        activation: Activation,
        /** 16 kHz mono PCM16, base64. Empty on a frame whose only job is the end marker. */
        pcm: z.string(),
        /** Throw away everything queued, then play this frame. */
        clearSpeakerBufferBeforeFrame: z.boolean().optional(),
        /** Nothing more is coming for this answer. */
        lastFrameOfAnswer: z.boolean().optional(),
      }),
    },
    "events.iterate.com/voice-agent/script-failed": {
      description:
        "A script of the device's agent failed: the agent's context copies its own report of the failure (the `context-added` that begins \"Your script failed\") here, which the voice must be able to say.",
      payloadSchema: z.looseObject({ report: z.string() }),
    },
    "events.iterate.com/voice-agent/words-typed": {
      description:
        "Words a caller typed into the call instead of saying them (voice-call.ts `--say`): the relay hands them to the agent as a hand-over of this call.",
      payloadSchema: z.looseObject({ activation: Activation, text: z.string().min(1) }),
    },
    "events.iterate.com/voice-agent/words-given": {
      description:
        "Words a caller's device gives the voice to say in this call, such as a phone bridge's opening line: the relay passes them to the live model to say at once, as the agent's own words go, once the session has started.",
      payloadSchema: z.looseObject({ activation: Activation, text: z.string().min(1) }),
    },
  },
  /* The device's agent owns its events, and a row on its context copies the ones a call needs
   * here: its messages are what the live model speaks. */
  processorDeps: [AgentContract],
  consumes: [
    "events.iterate.com/agent/summary-updated",
    "events.iterate.com/agent/web-message-sent",
    "events.iterate.com/agent/paused",
    "events.iterate.com/voice-agent/script-failed",
    "events.iterate.com/voice-agent/words-typed",
    "events.iterate.com/voice-agent/words-given",
    "events.iterate.com/voice-agent/device-provisioned",
    "events.iterate.com/voice-agent/call-started",
    "events.iterate.com/voice-agent/call-ended",
    /* Consumed so the fold sees its own appends and the live view survives an eviction. */
    "events.iterate.com/voice-agent/utterance-transcribed",
    "events.iterate.com/voice-agent/answer-transcribed",
    /* Ephemeral: named here because `"*"` never matches an ephemeral event. */
    "events.iterate.com/voice-agent/mic-frame",
    "events.iterate.com/voice-agent/keepalive",
  ],
  emits: [
    "events.iterate.com/voice-agent/conversation-accepted",
    "events.iterate.com/voice-agent/audio-trimmed",
    "events.iterate.com/voice-agent/call-ended",
    "events.iterate.com/voice-agent/provider-error-reported",
    "events.iterate.com/voice-agent/provider-disconnected",
    "events.iterate.com/voice-agent/utterance-transcribed",
    "events.iterate.com/voice-agent/answer-transcribed",
    "events.iterate.com/voice-agent/speaker-frame",
  ],
});

type VoiceAgentContract = typeof VoiceAgentContract;

type VoiceState = z.infer<typeof VoiceState>;

/** One run of speech on the provider's continuous output stream. Replaced wholesale at the onset
 * of speech, so no field can be forgotten in a reset. */
interface Answer {
  /** "speaking": deltas go to the device (pauses shorter than the tail bound included);
   * "settled": between answers, idle silence is dropped. */
  phase: "speaking" | "settled";
  /** Silence received since the last speech in this answer, in audio ms. */
  trailingSilenceMs: number;
}

const freshAnswer = (): Answer => ({ phase: "settled", trailingSilenceMs: 0 });

/** One speaker's open transcript row: fragments not yet closed by a gap. */
interface TurnBuffer {
  text: string;
  /** Session timeline, both ends. */
  startTimelineMs: number;
  endTimelineMs: number;
}

/** Everything whose lifetime is one provider dial. Created before the awaited dial (`socket`
 * stays null while it is in flight, which is what lets the mic path queue during the handshake)
 * and dropped whole when the dial fails, its socket closes, or the call is hung up. */
interface Dial {
  readonly activation: string;
  /** The device's agent, where this call's hand-overs go. */
  readonly agentPath: string;
  /** This dial's own identity, for keys that must not collide with an earlier dial of the same
   * call. */
  readonly dialId: string;
  /** The provider's socket, or null while the dial is in flight. */
  socket: WebSocket | null;
  /** True once `session.started` arrived and audio may flow. */
  ready: boolean;
  /** Facet clock when the provider's 101 came back. */
  socketReadyAtFacetMs: number;
  /** Everything the provider hears: the device's frames from the press on, held until the
   * session starts, and the silence between them. */
  mic: MicPacer;
  /** Frames awaiting hand-over to the stream, oldest first: the delta's own base64, or an empty
   * frame carrying the end marker. Ordinarily one frame for the duration of one append. */
  speakerOutbox: { pcm: string; lastFrameOfAnswer?: true }[];
  /** Decoded PCM bytes presently queued; markers cost nothing. */
  speakerOutboxBytes: number;
  /** Once the outbox overflows, later deltas are ignored while the terminal is appended. */
  speakerOutboxOverflowed: boolean;
  /** One sender per live dial, started with its first output, waiting while the outbox is empty. */
  sending: boolean;
  /** Wakes the sender waiting on an empty outbox; null while it is sending or gone. */
  wakeSender: (() => void) | null;
  /** Facet clock at the last speaker frame handed over: the "this end is busy" reading the idle
   * deadline uses. */
  lastSpeakerFrameAtFacetMs: number;
  /** The next frame out tells the device to empty its speaker first. True from the moment the
   * dial is decided: the device may still hold frames from the incarnation that died. */
  clearSpeakerBufferBeforeNextFrame: boolean;
  /** The backend decided the call is over, with this reason; the call ends once the goodbye's end
   * marker has gone out (or the grace runs out). Runtime only: evicted, the idle deadline backstops. */
  hangUpReason: string | null;
  /** Facet clock when the hang-up was decided. */
  hangUpArmedAtFacetMs: number;
  /** An acknowledgement already playing at the decision is not the goodbye. */
  answerBeforeHangUp: Answer | null;
  /** Turns closed since the last hand-over: the words the next one carries to the agent, which
   *  keeps every earlier hand-over in its own conversation. */
  turnsForAgent: TranscriptTurn[];
  /** No hand-over of this call has gone yet: the first one tells the agent a new call began. */
  firstHandOver: boolean;
  /** `words-given` that arrived before the session started: said once it does. */
  wordsBeforeReady: { text: string; offset: number }[];
  /** Each hand-over, oldest first: the live model's delegation id and the offset of the
   *  `agent/context-added` that carried it. An answer speaks for the newest one its request read. */
  delegations: { delegationId: string | null; offset: number }[];
  /** A hand-over the agent has not answered yet: progress is spoken only while one is. */
  awaitingAnswer: boolean;
  /** The last status passed on, so a repeat is not news. */
  lastProgress: string | null;
  /** When the person was last told something unprompted (a hand-over counts), on the facet clock. */
  lastSpokenProgressAtFacetMs: number;
  /** The answer in flight. */
  answer: Answer;
  /** The furthest point on the provider's session timeline seen so far: transcript `end_ms` and
   * the running total of output audio. Output audio arrives every 100 ms whether or not anything
   * is said, so transcript rows close against it without any timer. */
  timelineMs: number;
  /** The two open transcript rows, one per speaker; both may be open at once. */
  turns: { user: TurnBuffer | null; assistant: TurnBuffer | null };
}

const freshDial = (activation: string, agentPath: string): Dial => ({
  activation,
  agentPath,
  dialId: crypto.randomUUID(),
  socket: null,
  ready: false,
  socketReadyAtFacetMs: 0,
  mic: new MicPacer(),
  speakerOutbox: [],
  speakerOutboxBytes: 0,
  speakerOutboxOverflowed: false,
  sending: false,
  wakeSender: null,
  lastSpeakerFrameAtFacetMs: 0,
  clearSpeakerBufferBeforeNextFrame: true,
  hangUpReason: null,
  hangUpArmedAtFacetMs: 0,
  answerBeforeHangUp: null,
  turnsForAgent: [],
  firstHandOver: true,
  wordsBeforeReady: [],
  delegations: [],
  awaitingAnswer: false,
  lastProgress: null,
  lastSpokenProgressAtFacetMs: 0,
  answer: freshAnswer(),
  timelineMs: 0,
  turns: { user: null, assistant: null },
});

/** What the host injects; every wait and every clock in this file comes from here. */
type VoiceAgentDeps = {
  projectContext: () => Promise<string>;
  nowAtFacetMs(): number;
  /** The only way this processor waits, injected so tests can use a fake clock. */
  sleep(ms: number): Promise<void>;
  dialProvider(): Promise<WebSocket>;
  /** Hand words to the device's agent through the agents app
   *  (`itx.agents.get(path).message(words)`), answered with the `context-added` it appended. */
  messageAgent(path: string, words: string): Promise<{ offset: number }>;
  /** The project's live model, read when the session is prepared: the facet class's `liveModel`. */
  liveModel?: () => string | undefined;
  /** The project's voice for the live model, read when the session is prepared: the facet class's `liveVoice`. */
  liveVoice?: () => string | undefined;
  /** The project's instructions for the live model, read when the session is prepared: the facet class's `liveInstructions`. */
  liveInstructions?: () => LiveInstructions | undefined;
};

/** What a project's `liveInstructions` answers: the instructions the live model gets, from the
 *  device's agent path and the default (the delegation policy and the project). */
export type LiveInstructions = (call: {
  path: string;
  instructions: string;
}) => string | Promise<string>;

type VoiceArgs = ProcessEventArgs<VoiceState, ConsumedEvent<VoiceAgentContract>>;

export class VoiceAgentProcessor extends StreamProcessor<
  VoiceState,
  ConsumedEvent<VoiceAgentContract>
> {
  readonly contract = VoiceAgentContract;

  private readonly deps: VoiceAgentDeps;

  constructor(deps: VoiceAgentDeps) {
    super();
    this.deps = deps;
  }

  /** The engine's `append` and fire-and-forget helper as handed over by the latest delivery.
   * Provider messages arrive outside any delivery and use these. */
  #append!: VoiceArgs["append"];
  #background!: VoiceArgs["runInBackground"];

  /** The dial this incarnation runs, or null. Created synchronously the moment a dial is decided,
   * so two deliveries cannot open two sockets, and null again when it fails, its socket closes or
   * the call is hung up. Every closure the dial spawns fences itself with `this.#dial !== dial`. */
  #dial: Dial | null = null;
  /** The fold's `lastDeviceInputAtStreamMs`, mirrored for the idle tick that runs between
   * deliveries and cannot read the fold. */
  #lastDeviceInputAtStreamMsMirror = 0;
  /** The activation whose terminal event is travelling through the log. */
  #endingActivation: string | null = null;
  /** How far the newest activation got: what its relay-written `call-ended` reports. */
  #startup: { activation: string; summary: StartupSummary } | null = null;
  /** The live model's session, prepared once per incarnation as soon as the device is known, so a
   *  dial sends it the moment the provider answers; null again after a failure. */
  #session: Promise<Record<string, unknown>> | null = null;
  /** Frames of an activation with no call yet, oldest first (`EARLY_FRAMES_MAX_MS`). */
  #earlyFrames: { activation: string; frames: { pcm: string; ms: number }[]; ms: number } | null =
    null;

  reduce({ state, event }: ReduceArgs<VoiceState, ConsumedEvent<VoiceAgentContract>>) {
    const committedAtStreamMs = Date.parse(event.createdAt);
    switch (event.type) {
      case "events.iterate.com/voice-agent/device-provisioned":
        return { ...state, agentPath: event.payload.agentPath };

      case "events.iterate.com/voice-agent/call-started": {
        /* A repeated press is the call it already opened, or one already over. A new activation
         * replaces a live call, which processEvent ends. Opening a call is the device's first
         * input, so the deadline starts here. */
        const { activation } = event.payload;
        if (state.call?.activation === activation || state.lastEnd?.activation === activation)
          return state;
        return {
          ...state,
          transcript: [],
          call: { activation, lastDeviceInputAtStreamMs: committedAtStreamMs },
          lastEnd: null,
        };
      }

      case "events.iterate.com/voice-agent/mic-frame":
      case "events.iterate.com/voice-agent/keepalive": {
        /* Their bodies never reach the fold, but their commit stamps are durable, and folding the
         * newest is what makes the idle deadline outlive an eviction. `max` so a redelivered batch
         * cannot walk it backwards. Another call's input is not this call's. */
        const { call } = state;
        if (call?.activation !== event.payload.activation) return state;
        if (committedAtStreamMs - call.lastDeviceInputAtStreamMs < IDLE_STAMP_STEP_MS) return state;
        return {
          ...state,
          call: {
            ...call,
            lastDeviceInputAtStreamMs: Math.max(
              call.lastDeviceInputAtStreamMs,
              committedAtStreamMs,
            ),
          },
        };
      }

      case "events.iterate.com/voice-agent/call-ended":
        return state.call?.activation === event.payload.activation
          ? {
              ...state,
              call: null,
              lastEnd: { activation: event.payload.activation, reason: event.payload.reason },
            }
          : state;

      /* A call's last turns may land just after its end: the live view shows its aftermath. */
      case "events.iterate.com/voice-agent/utterance-transcribed":
        if (event.payload.text === "" || !this.#isShownCall(state, event.payload.activation))
          return state;
        return {
          ...state,
          transcript: foldTranscriptTurn(state.transcript, {
            role: "listener",
            text: event.payload.text,
          }),
        };

      case "events.iterate.com/voice-agent/answer-transcribed":
        if (event.payload.text === "" || !this.#isShownCall(state, event.payload.activation))
          return state;
        return {
          ...state,
          transcript: foldTranscriptTurn(state.transcript, {
            role: "assistant",
            text: event.payload.text,
          }),
        };

      default:
        return state;
    }
  }

  /** The call the live view shows: the live one, or else the last one to end. */
  #isShownCall(state: VoiceState, activation: string): boolean {
    return (state.call?.activation || state.lastEnd?.activation) === activation;
  }

  /** The engine publishes this after every batch — twenty microphone batches a second during a
   * call, so the runtime facts (dial ready, answer speaking) reach the page within a frame. */
  projectLiveState(state: VoiceState): VoiceLiveView {
    const dial = this.#dial;
    const view: VoiceLiveView = {
      phase: state.call
        ? dial?.activation === state.call.activation && dial.ready
          ? "live"
          : "dialing"
        : state.lastEnd
          ? "ended"
          : "idle",
      activation: state.call?.activation || null,
      answering: Boolean(dial?.ready) && dial?.answer.phase === "speaking",
      transcript: state.transcript,
      lastEnd: state.lastEnd,
    };
    /* The view of the last batch when nothing in it moved: the engine's `LiveState.set` then skips
     * its JSON diff of the transcript, which it otherwise ran on every microphone batch. The
     * reduce replaces the transcript and `lastEnd`, never mutates them, so the same object is the
     * same value. */
    const last = this.#lastLiveView;
    if (
      last &&
      last.phase === view.phase &&
      last.activation === view.activation &&
      last.answering === view.answering &&
      last.transcript === view.transcript &&
      last.lastEnd === view.lastEnd
    )
      return last;
    return (this.#lastLiveView = view);
  }
  #lastLiveView: VoiceLiveView | undefined;

  processEvent(args: VoiceArgs): undefined {
    const { state, event, delivery } = args;
    this.#append = args.append;
    this.#background = args.runInBackground;
    if (state.call) this.#lastDeviceInputAtStreamMsMirror = state.call.lastDeviceInputAtStreamMs;
    /* Provisioning wakes the relay, so the session is ready before the first press. */
    if (state.agentPath) void this.#prepareSession(state.agentPath);

    /* The press is the one event that dials, in the batch that carries it, awaiting nothing but
     * the provider. Only the live event dials: a crash inside that batch re-delivers it and
     * re-dials, which is right; past its checkpoint the durable call without its event is the
     * interruption recorded below. */
    if (
      event?.type === "events.iterate.com/voice-agent/call-started" &&
      state.call?.activation === event.payload.activation &&
      this.#dial?.activation !== event.payload.activation
    ) {
      const { activation } = event.payload;
      /* One call per device: a live one is let go first, and its end is written once the new one
       * holds the dial, so nothing that end sets off finds the device without a call. */
      const superseded = this.#dial;
      if (superseded) this.#hangUp();
      if (state.agentPath)
        this.#openProviderConnection(activation, Date.parse(event.createdAt), state.agentPath);
      else
        args.blockProcessorWhile(() =>
          this.#end(
            activation,
            "this device is not provisioned: itx.voice.ensureVoiceDevice({ client }) provisions it",
          ),
        );
      if (superseded)
        this.#background(() =>
          this.#end(superseded.activation, "a new call started on this device"),
        );
    }

    /* A provider session is volatile; its durable record cannot revive it. A call whose end is
     * already being written (an unprovisioned press, say) keeps that end's reason. */
    const owedCall = delivery.caughtUp ? state.call : null;
    if (
      owedCall &&
      this.#dial?.activation !== owedCall.activation &&
      this.#endingActivation !== owedCall.activation
    ) {
      args.blockProcessorWhile(() =>
        this.#end(owedCall.activation, "the voice session was interrupted"),
      );
    }

    if (event === null) return;

    switch (event.type) {
      /* What the device's agent says reaches a call only once the call has handed it something:
       * before that it belongs to an earlier call. A dial dies with its incarnation, so a
       * redelivered agent event with no dial is not forwarded either. */
      case "events.iterate.com/agent/summary-updated": {
        /* A script's status: progress, for the newest hand-over. A title or a wait is not news. */
        const dial = this.#dialWithHandOvers();
        const { activity } = event.payload;
        if (!dial || !activity || activity === dial.lastProgress) return;
        dial.lastProgress = activity;
        this.#relayProgress(dial, activity, event.offset);
        return;
      }

      case "events.iterate.com/voice-agent/script-failed": {
        /* A failed script is progress the voice must be able to say, never paper over. */
        const dial = this.#dialWithHandOvers();
        if (!dial) return;
        this.#relayProgress(
          dial,
          `a script failed${event.payload.report.replace(/^Your script failed/, "").replace(/\s+/g, " ")}`,
          event.offset,
        );
        return;
      }

      case "events.iterate.com/voice-agent/words-typed": {
        const dial = this.#dial;
        if (dial?.activation !== event.payload.activation) return;
        this.#handOver(dial, `Person (typed): ${event.payload.text}`, null);
        return;
      }

      case "events.iterate.com/voice-agent/words-given": {
        /* The device's own words for this call, which it names: no earlier call's, so they need
         * no hand-over first. */
        const dial = this.#dial;
        if (dial?.activation !== event.payload.activation) return;
        const words = { text: event.payload.text, offset: event.offset };
        if (dial.ready) this.#sayGivenWords(dial, words);
        else dial.wordsBeforeReady.push(words);
        return;
      }

      case "events.iterate.com/agent/web-message-sent": {
        /* An answer to one of the agent's model requests is spoken, unless it was written beside a
         * script: those words can guess at a result the script has not produced yet. */
        const dial = this.#dialWithHandOvers();
        const { message, llmRequestOffset, besideScript } = event.payload;
        if (!dial || besideScript) return;
        if (!llmRequestOffset) {
          /* Words a script sent while it ran (`sendMessage`): the agent chose to tell the person
           * now, so they are spoken — and count as the latest thing the person was told. */
          dial.lastSpokenProgressAtFacetMs = this.deps.nowAtFacetMs();
          this.#sendToLiveModel(dial, {
            kind: "commentary",
            delegationId: dial.delegations.at(-1)?.delegationId ?? null,
            content: message,
            offset: event.offset,
          });
          return;
        }
        /* The request read every context item before its own offset, so its answer is for the
         * newest hand-over among them; a request that read none of this call's is an earlier
         * call's, and its words (a goodbye included) are not for this one. */
        const delegation = dial.delegations.findLast((row) => row.offset < llmRequestOffset);
        if (!delegation) return;
        dial.awaitingAnswer = false;
        if (message.includes(HANG_UP_TOKEN)) {
          dial.hangUpReason = "the Agent hung up";
          dial.hangUpArmedAtFacetMs = this.deps.nowAtFacetMs();
          dial.answerBeforeHangUp = dial.answer;
          this.#background(async () => {
            await this.deps.sleep(HANG_UP_GOODBYE_GRACE_MS);
            if (this.#dial !== dial || dial.answer.phase === "speaking") return;
            await this.#settleHangUp(dial);
          });
        }
        this.#sendToLiveModel(dial, {
          kind: "commentary",
          delegationId: delegation.delegationId,
          content: message.replace(HANG_UP_TOKEN, "").trim(),
          offset: event.offset,
        });
        return;
      }

      case "events.iterate.com/agent/paused": {
        /* The agent takes no more turns until the person's next words resume it: say so, rather
         * than leave the voice waiting on an answer that is not coming. */
        const dial = this.#dialWithHandOvers();
        if (!dial) return;
        dial.awaitingAnswer = false;
        this.#sendToLiveModel(dial, {
          kind: "commentary",
          delegationId: dial.delegations.at(-1)?.delegationId ?? null,
          content: `The agent stopped working on the request: ${event.payload.reason}`,
          offset: event.offset,
        });
        return;
      }

      case "events.iterate.com/voice-agent/mic-frame": {
        /* The frame stays the device's own base64 string all the way to the wire. */
        const micB64 = event.payload.pcm;
        /* An empty frame is a client bug, not audio: the provider rejects it. */
        if (micB64 === "") return;
        const micMs = base64ByteLength(micB64) / PCM16_BYTES_PER_MS;
        const dial = this.#dial;
        if (dial?.activation !== event.payload.activation) {
          this.#holdEarlyFrame(event.payload.activation, micB64, micMs);
          return;
        }
        if (dial.mic.push(micB64, micMs)) {
          /* A frame the pacer has credit for goes now; the tick sends the rest. */
          if (dial.ready) this.#sendDueMicAudio(dial);
          return;
        }
        const trimmedMs = dial.mic.queuedMs + micMs;
        if (this.#startup?.activation === dial.activation)
          this.#startup.summary.trimmedMs = trimmedMs;
        this.#hangUp();
        this.#background(() =>
          this.#end(
            dial.activation,
            `more than ${MIC_QUEUE_MAX_MS}ms of microphone audio queued for the provider`,
            [
              {
                type: "events.iterate.com/voice-agent/audio-trimmed",
                idempotencyKey: this.idempotencyKey(`trimmed:${dial.activation}`),
                payload: { activation: dial.activation, ms: trimmedMs },
              },
            ],
          ),
        );
        return;
      }

      case "events.iterate.com/voice-agent/call-ended": {
        /* The device's own obituary (the hang-up button) reaches the dial only here; without this
         * arm a dead provider socket would squat `#dial` until the idle tick. */
        const dial = this.#dial;
        if (dial && dial.activation === event.payload.activation) {
          this.#flushTurns(dial, true);
          this.#hangUp();
        }
        return;
      }

      default:
        return;
    }
  }

  /** Open a provider connection for this call, now. `pressedAtStreamMs` is when the stream
   *  committed its `call-started`. */
  #openProviderConnection(activation: string, pressedAtStreamMs: number, agentPath: string): void {
    if (this.#dial !== null) return;
    /* Created before the awaited dial, so a second caller finds `#dial` taken and the mic path
     * queues for the whole handshake. */
    const dial = freshDial(activation, agentPath);
    this.#dial = dial;
    const early = this.#earlyFrames;
    this.#earlyFrames = null;
    if (early?.activation === activation)
      for (const frame of early.frames) dial.mic.push(frame.pcm, frame.ms);
    const dialStartedAtFacetMs = this.deps.nowAtFacetMs();
    this.#startup = {
      activation,
      summary: { pressToDialMs: dialStartedAtFacetMs - pressedAtStreamMs },
    };
    const session = this.#prepareSession(agentPath);
    this.#background(async () => {
      await this.deps.sleep(OPENING_DEADLINE_MS);
      if (this.#dial !== dial || dial.ready) return;
      this.#releaseDial(dial);
      try {
        dial.socket?.close();
      } catch {
        /* Already gone. */
      }
      await this.#end(
        activation,
        `the provider did not become ready within ${OPENING_DEADLINE_MS}ms`,
      );
    });
    this.#background(async () => {
      /* A dial can reject (DNS, TLS) or be refused (no upgrade); both end the call. */
      let socket: WebSocket;
      try {
        socket = await this.deps.dialProvider();
      } catch (error) {
        if (this.#dial !== dial) return;
        this.#releaseDial(dial);
        await this.#end(activation, `the provider dial failed: ${String(error).slice(0, 200)}`);
        return;
      }
      if (this.#dial !== dial) {
        /* Hung up while dialling: adopting the socket would resurrect a buried conversation. */
        try {
          socket.close();
        } catch {
          /* Already gone. */
        }
        return;
      }
      dial.socket = socket;
      dial.socketReadyAtFacetMs = this.deps.nowAtFacetMs();

      /* The provider's messages are handled here, not appended to the stream: ephemeral delivery
       * coalesces and would put a stream round trip in front of every word. */
      socket.addEventListener("message", (message: MessageEvent) => {
        /* A superseded socket is still a talking socket; the fence is the dial's identity. */
        if (this.#dial !== dial) return;
        if (typeof message.data !== "string") return;
        let live: Record<string, unknown>;
        try {
          live = JSON.parse(message.data) as Record<string, unknown>;
        } catch {
          return;
        }
        const type = String(live.type ?? "");
        const receivedAtFacetMs = this.deps.nowAtFacetMs();
        this.#onLiveEvent(dial, live, type, receivedAtFacetMs, dialStartedAtFacetMs);
        /* Every message moves the session timeline, and a transcript row TURN_GAP_MS behind it
         * is a finished turn. */
        this.#flushTurns(dial, false);
      });

      socket.addEventListener("close", (event: CloseEvent) => {
        if (this.#dial !== dial) return;
        this.#releaseDial(dial);
        this.#flushTurns(dial, true);
        this.#providerClosed(
          activation,
          `the provider's socket closed (${String(event.code)}${event.reason ? ` ${event.reason}` : ""})`,
        );
      });

      /* `session.start` is the first message, carrying the model, the audio format, the voice
       * and the policy; there is no `session.created` to wait for. */
      await this.#startSession(dial, session);
    });

    /* The idle countdown arms the moment the dial is decided, so a dial that never resolves is
     * still buried. A self-rescheduling tick chain rather than one long-lived closure, which the
     * facet keepalive's busy-refire detector would take for a wedge. */
    const idleTick = async (): Promise<void> => {
      await this.deps.sleep(5_000);
      if (this.#dial !== dial) return;
      const nowAtFacetMs = this.deps.nowAtFacetMs();
      /* Idle since the last thing that happened at either end: a listener hearing out a long
       * answer sends nothing, so this end's speaker frames count too. */
      const lastActivityAtFacetMs = Math.max(
        this.#lastDeviceInputAtStreamMsMirror,
        dial.lastSpeakerFrameAtFacetMs,
      );
      if (nowAtFacetMs - lastActivityAtFacetMs < IDLE_TIMEOUT_MS) {
        this.#background(idleTick);
        return;
      }
      await this.#end(activation, `no input from the device for ${IDLE_TIMEOUT_MS / 1000}s`);
    };
    this.#background(idleTick);
  }

  /** Start client delegation with the session prepared before the press. A session that could
   *  not be prepared ends the call, saying why. */
  async #startSession(dial: Dial, session: Promise<Record<string, unknown>>): Promise<void> {
    let prepared: Record<string, unknown>;
    try {
      prepared = await session;
    } catch (error) {
      if (this.#dial !== dial) return;
      this.#hangUp();
      await this.#end(
        dial.activation,
        `the live model's session could not be prepared: ${String(error).slice(0, 200)}`,
      );
      return;
    }
    if (this.#dial !== dial || !dial.socket) return;
    dial.socket.send(
      JSON.stringify({
        type: "session.start",
        event_id: `start_${dial.dialId}`,
        session: prepared,
      }),
    );
  }

  /** The session every call of this incarnation starts with, built once: the model, the voice and
   *  the instructions, the default or what the project's `liveInstructions` makes of them. */
  #prepareSession(agentPath: string): Promise<Record<string, unknown>> {
    if (this.#session) return this.#session;
    const session = (async () => {
      const instructions =
        LIVE_DELEGATION_POLICY +
        `\nCURRENT PROJECT: ${await this.deps.projectContext()}. Ingress refers to this project website.`;
      const hook = this.deps.liveInstructions?.();
      return {
        model: this.deps.liveModel?.() ?? LIVE.model,
        instructions: hook ? await hook({ path: agentPath, instructions }) : instructions,
        audio: {
          format: { type: "audio/pcm", rate: LIVE.rate },
          output: { voice: this.deps.liveVoice?.() ?? LIVE.voice },
        },
        delegation: { type: "client" },
      };
    })();
    /* A failure is the next call's to retry; the dial that awaits it reports it. */
    session.catch(() => {
      if (this.#session === session) this.#session = null;
    });
    return (this.#session = session);
  }

  /** The provider's message switch. Every arm returns. */
  #onLiveEvent(
    dial: Dial,
    live: Record<string, unknown>,
    type: string,
    receivedAtFacetMs: number,
    dialStartedAtFacetMs: number,
  ): void {
    const { activation } = dial;
    switch (type) {
      case "session.started": {
        /* Usable. What the handshake held goes: up to 5 s at once, the rest at the pace. */
        dial.ready = true;
        const startup = {
          pressToDialMs:
            this.#startup?.activation === activation ? this.#startup.summary.pressToDialMs : 0,
          handshakeTookMs: receivedAtFacetMs - dialStartedAtFacetMs,
          upgradeTookMs: dial.socketReadyAtFacetMs - dialStartedAtFacetMs,
          heldMs: dial.mic.queuedMs,
        };
        this.#startup = { activation, summary: startup };
        dial.mic.start(receivedAtFacetMs);
        this.#startMicPacer(dial);
        for (const words of dial.wordsBeforeReady.splice(0)) this.#sayGivenWords(dial, words);
        this.#background(() =>
          this.#append({
            type: "events.iterate.com/voice-agent/conversation-accepted",
            idempotencyKey: this.idempotencyKey(`accepted:${activation}:${dial.dialId}`),
            payload: { activation, ...startup },
          }),
        );
        return;
      }

      case "session.output_audio.delta": {
        if (typeof live.delta !== "string") return;
        this.#onOutputAudio(dial, live.delta, receivedAtFacetMs);
        return;
      }

      case "session.input_transcript.delta":
      case "session.output_transcript.delta": {
        if (typeof live.delta !== "string") return;
        const speaker = type === "session.input_transcript.delta" ? "user" : "assistant";
        const startTimelineMs = typeof live.start_ms === "number" ? live.start_ms : dial.timelineMs;
        const endTimelineMs = typeof live.end_ms === "number" ? live.end_ms : startTimelineMs;
        dial.timelineMs = Math.max(dial.timelineMs, endTimelineMs);
        const open = dial.turns[speaker];
        if (open && startTimelineMs - open.endTimelineMs >= TURN_GAP_MS) {
          /* A fragment landing well after the row's last: the row was a finished turn. */
          this.#closeTurn(dial, speaker);
        }
        const row = dial.turns[speaker];
        if (!row) {
          dial.turns[speaker] = { text: live.delta, startTimelineMs, endTimelineMs };
        } else {
          row.text += live.delta;
          row.endTimelineMs = Math.max(row.endTimelineMs, endTimelineMs);
        }
        return;
      }

      case "session.delegation.created": {
        const parsed = z
          .object({
            delegation: z.object({ id: z.string().min(1).max(128), target: z.literal("client") }),
          })
          .safeParse(live);
        if (!parsed.success) return;
        this.#delegate(dial, parsed.data.delegation.id);
        return;
      }

      case "session.closed": {
        this.#flushTurns(dial, true);
        this.#releaseDial(dial);
        this.#providerClosed(
          activation,
          `the provider closed the session (${String(live.reason ?? "unknown")})`,
        );
        return;
      }

      case "error":
        this.#background(() =>
          this.#append({
            type: "events.iterate.com/voice-agent/provider-error-reported",
            payload: {
              activation,
              message: JSON.stringify(live.error ?? live).slice(0, 2_000),
            },
          }),
        );
        return;

      default:
        /* Acknowledgements and usage updates need no action. */
        return;
    }
  }

  /** One 100 ms delta of the provider's continuous output stream. The stream never stops, so
   * "is the voice speaking" is read off the audio: idle silence is dropped, speech opens an
   * answer and goes straight to the device, silence inside an answer rides along until the tail
   * bound ends the answer and `lastFrameOfAnswer` follows the last frame out. */
  #onOutputAudio(dial: Dial, delta: string, receivedAtFacetMs: number): void {
    const deltaMs = base64ByteLength(delta) / PCM16_BYTES_PER_MS;
    dial.timelineMs += deltaMs;
    /* Idle deltas are exact digital zero and speech onsets peak in the thousands. */
    const speaking = peakOfBase64Pcm16(delta) >= 100;

    if (dial.answer.phase === "settled") {
      if (!speaking) return;
      dial.answer = { phase: "speaking", trailingSilenceMs: 0 };
    } else if (speaking) {
      dial.answer.trailingSilenceMs = 0;
    } else {
      dial.answer.trailingSilenceMs += deltaMs;
      /* 700 ms of silence after speech ends the answer: the provider has no end-of-answer event
       * and pauses inside an answer are shorter. */
      if (dial.answer.trailingSilenceMs >= 700) {
        this.#endAnswer(dial, receivedAtFacetMs);
        return;
      }
    }

    /* The delta goes out as the base64 it arrived as; a larger delta than the device's frame
     * ceiling (no provider sends one today) is decoded and cut, because the device silently drops
     * an oversize frame. */
    if (base64ByteLength(delta) <= MAX_SPEAKER_PAYLOAD_BYTES) {
      this.#sendSpeakerFrame(dial, delta, receivedAtFacetMs);
      return;
    }
    const pcm16 = base64ToBytes(delta);
    for (let cut = 0; cut < pcm16.length; cut += MAX_SPEAKER_PAYLOAD_BYTES) {
      this.#sendSpeakerFrame(
        dial,
        bytesToBase64(pcm16.subarray(cut, Math.min(cut + MAX_SPEAKER_PAYLOAD_BYTES, pcm16.length))),
        receivedAtFacetMs,
      );
    }
  }

  #sendSpeakerFrame(dial: Dial, pcm: string, nowAtFacetMs: number): void {
    if (dial.speakerOutboxOverflowed) return;
    const pcmBytes = base64ByteLength(pcm);
    if (dial.speakerOutboxBytes + pcmBytes > SPEAKER_OUTBOX_MAX_BYTES) {
      dial.speakerOutboxOverflowed = true;
      this.#background(() =>
        this.#end(
          dial.activation,
          "the device speaker append stalled with more than ten seconds of queued audio",
        ),
      );
      return;
    }
    dial.lastSpeakerFrameAtFacetMs = nowAtFacetMs;
    dial.speakerOutbox.push({ pcm });
    dial.speakerOutboxBytes += pcmBytes;
    this.#startSpeakerSender(dial);
  }

  /** The answer ended: the marker goes out behind the last frame, and a hang-up armed before this
   * answer ended is now settleable. */
  #endAnswer(dial: Dial, nowAtFacetMs: number): void {
    const endedAnswer = dial.answer;
    dial.answer = freshAnswer();
    dial.speakerOutbox.push({ pcm: "", lastFrameOfAnswer: true });
    this.#startSpeakerSender(dial);
    if (
      dial.hangUpReason &&
      (endedAnswer !== dial.answerBeforeHangUp ||
        nowAtFacetMs - dial.hangUpArmedAtFacetMs >= HANG_UP_GOODBYE_GRACE_MS)
    ) {
      this.#background(async () => {
        /* The device prefills 400 ms and delivery adds a few hundred; a second preserves the
         * goodbye's tail. */
        await this.deps.sleep(1_000);
        await this.#settleHangUp(dial);
      });
    }
  }

  /** End the call the backend asked to end, unless the dial is already gone. Idempotent. */
  async #settleHangUp(dial: Dial): Promise<void> {
    if (this.#dial !== dial || !dial.hangUpReason) return;
    const reason = dial.hangUpReason;
    dial.hangUpReason = null;
    await this.#end(dial.activation, reason);
  }

  /** Send queued speaker frames in order for the lifetime of the dial, one frame per append (a
   * client push carries every event folded behind it, and the ESP32's inbox slot holds 16 KiB).
   * A rejected append ends the call: lost audio, a lost clear or a lost end marker cannot be
   * recovered by continuing with the next frame. */
  #startSpeakerSender(dial: Dial): void {
    if (dial.sending) {
      dial.wakeSender?.();
      return;
    }
    dial.sending = true;
    this.#background(async () => {
      try {
        while (this.#dial === dial) {
          const frame = dial.speakerOutbox.shift();
          if (!frame) {
            /* One background registration per dial: the sender waits for the next frame, or for
             * `#releaseDial` to end it. */
            await new Promise<void>((resolve) => {
              dial.wakeSender = resolve;
            });
            dial.wakeSender = null;
            continue;
          }
          dial.speakerOutboxBytes -= base64ByteLength(frame.pcm);
          const clearFirst = dial.clearSpeakerBufferBeforeNextFrame;
          dial.clearSpeakerBufferBeforeNextFrame = false;
          try {
            await this.#append({
              type: "events.iterate.com/voice-agent/speaker-frame",
              /* The engine's append stamps provenance, not the catalog's ephemeral marker, and a
               * persisted frame is a row. */
              ephemeral: true,
              payload: {
                activation: dial.activation,
                pcm: frame.pcm,
                ...(clearFirst && { clearSpeakerBufferBeforeFrame: true }),
                ...(frame.lastFrameOfAnswer && { lastFrameOfAnswer: true }),
              },
            });
          } catch {
            await this.#end(dial.activation, "the device speaker frame could not be appended");
            return;
          }
        }
      } finally {
        dial.sending = false;
        dial.wakeSender = null;
      }
    });
  }

  #flushTurns(dial: Dial, force: boolean): void {
    for (const speaker of ["user", "assistant"] as const) {
      const row = dial.turns[speaker];
      if (!row) continue;
      if (force || dial.timelineMs - row.endTimelineMs >= TURN_GAP_MS) {
        this.#closeTurn(dial, speaker);
      }
    }
  }

  /** One finished turn leaves one durable event carrying its words, keyed on the dial and the
   * row's start so a redelivered close cannot write a turn twice. */
  #closeTurn(dial: Dial, speaker: "user" | "assistant"): void {
    const row = dial.turns[speaker];
    dial.turns[speaker] = null;
    if (!row) return;
    const text = row.text.replace(/\s+/g, " ").trim();
    if (text === "") return;
    const turn = {
      role: speaker === "user" ? ("listener" as const) : ("assistant" as const),
      text,
    };
    dial.turnsForAgent.push(turn);
    const key = `live-turn:${dial.dialId}:${speaker}:${String(row.startTimelineMs)}`;
    const transcriptKey = `voice-agent/transcript:${dial.dialId}:${speaker}:${String(row.startTimelineMs)}`;
    this.#background(() =>
      speaker === "user"
        ? this.#append({
            type: "events.iterate.com/voice-agent/utterance-transcribed",
            idempotencyKey: this.idempotencyKey(key),
            payload: { activation: dial.activation, text, key: transcriptKey },
          })
        : this.#append({
            type: "events.iterate.com/voice-agent/answer-transcribed",
            idempotencyKey: this.idempotencyKey(key),
            payload: { activation: dial.activation, text, key: transcriptKey },
          }),
    );
  }

  /** Keep a frame that came before its call (`EARLY_FRAMES_MAX_MS`). */
  #holdEarlyFrame(activation: string, pcm: string, ms: number): void {
    if (this.#earlyFrames?.activation !== activation)
      this.#earlyFrames = { activation, frames: [], ms: 0 };
    const early = this.#earlyFrames;
    if (early.ms + ms > EARLY_FRAMES_MAX_MS) return;
    early.frames.push({ pcm, ms });
    early.ms += ms;
  }

  /** The pacer's one loop for the dial's lifetime: what the device sent, then silence for the gaps. */
  #startMicPacer(dial: Dial): void {
    this.#background(async () => {
      while (this.#dial === dial) {
        this.#sendDueMicAudio(dial);
        await this.deps.sleep(MIC_PACER_TICK_MS);
      }
    });
  }

  #sendDueMicAudio(dial: Dial): void {
    const { socket } = dial;
    if (!socket) return;
    for (const pcm of dial.mic.take(this.deps.nowAtFacetMs())) this.#sendMicAudio(socket, pcm);
  }

  #sendMicAudio(socket: WebSocket, b64: string): void {
    const padded = b64.length % 4 === 0 ? b64 : b64 + "=".repeat(4 - (b64.length % 4));
    socket.send(JSON.stringify({ type: "session.input_audio.append", audio: padded }));
  }

  /** A provider close ends the uncertain session; it is never replayed. */
  #providerClosed(activation: string, reason: string): void {
    if (this.#endingActivation === activation) return;
    this.#background(async () => {
      await this.#end(activation, reason);
      await this.#append({
        type: "events.iterate.com/voice-agent/provider-disconnected",
        payload: { activation, reason },
      });
    });
  }

  /** End the call once, with `reason`; `facts` that explain the end go in the same append. */
  async #end(
    activation: string,
    reason: string,
    facts: Parameters<VoiceArgs["append"]> = [],
  ): Promise<void> {
    if (this.#endingActivation === activation) return;
    this.#endingActivation = activation;
    const dial = this.#dial;
    if (dial?.activation === activation) {
      this.#flushTurns(dial, true);
      this.#hangUp();
    }
    const startup = this.#startup?.activation === activation ? this.#startup.summary : undefined;
    try {
      await this.#append(...facts, {
        type: "events.iterate.com/voice-agent/call-ended",
        idempotencyKey: this.idempotencyKey(`ended:${activation}`),
        payload: { activation, reason, startup },
      });
    } catch (error) {
      if (this.#endingActivation === activation) this.#endingActivation = null;
      throw error;
    }
  }

  /** The live model handed a request to the backend: hand the words said since the last hand-over
   * to the agent on this context, as one message, and tell the voice it may keep talking. The open
   * rows are closed first: they are usually the request itself. */
  #delegate(dial: Dial, delegationId: string): void {
    this.#flushTurns(dial, true);
    const said = dial.turnsForAgent
      .map((turn) => `${turn.role === "listener" ? "Person" : "Voice"}: ${turn.text}`)
      .join("\n");
    dial.turnsForAgent = [];
    this.#handOver(
      dial,
      said || "The voice handed the request over again; nothing new was said.",
      delegationId,
    );
  }

  /** Words for the agent, as one message of this call: the live model's delegation, or words typed
   *  into the call (no delegation id). The first of a call says a new call began (voice-context.md
   *  says what the line means). */
  #handOver(dial: Dial, said: string, delegationId: string | null): void {
    const words = [dial.firstHandOver && "New call.", said].filter(Boolean).join("\n");
    dial.firstHandOver = false;
    this.#background(async () => {
      try {
        const { offset } = await this.deps.messageAgent(dial.agentPath, words);
        if (this.#dial !== dial) return;
        /* Kept in offset order: two hand-overs in flight at once may answer out of order. */
        dial.delegations = [...dial.delegations, { delegationId, offset }].sort(
          (a, b) => a.offset - b.offset,
        );
        // the hand-over's acknowledgement is the last thing the person was told
        dial.awaitingAnswer = true;
        dial.lastSpokenProgressAtFacetMs = this.deps.nowAtFacetMs();
        /* Typed words were never the live model's delegation, so there is none to acknowledge. */
        if (!delegationId) return;
        this.#sendControl(dial, {
          type: "session.thinking.append",
          delegation_id: delegationId,
          content: "The request was handed to the backend; the conversation may continue.",
        });
      } catch (error) {
        if (this.#dial !== dial) return;
        await this.#end(
          dial.activation,
          `the delegation could not be handed to the agent: ${String(error).slice(0, 200)}`,
        );
      }
    });
  }

  /** The live dial, once this call has handed the agent something: what the agent says before
   *  that is about an earlier call. */
  #dialWithHandOvers(): Dial | null {
    const dial = this.#dial;
    return dial && dial.delegations.length > 0 ? dial : null;
  }

  /** Progress for the newest hand-over: said aloud when the person is waiting on an answer, nothing
   * is playing, they are not mid-sentence and nothing was said unprompted for the minimum gap;
   * otherwise a quiet note the voice relays when asked. */
  #relayProgress(dial: Dial, progress: string, offset: number): void {
    const now = this.deps.nowAtFacetMs();
    const speak =
      dial.awaitingAnswer &&
      dial.answer.phase === "settled" &&
      !dial.turns.user &&
      now - dial.lastSpokenProgressAtFacetMs >= SPOKEN_PROGRESS_MIN_GAP_MS;
    if (speak) dial.lastSpokenProgressAtFacetMs = now;
    this.#sendToLiveModel(dial, {
      kind: speak ? "commentary" : "thinking",
      delegationId: dial.delegations.at(-1)?.delegationId ?? null,
      content: `Progress: ${progress}`,
      offset,
    });
  }

  /** `words-given`: said aloud, and the latest thing the person was told. */
  #sayGivenWords(dial: Dial, words: { text: string; offset: number }): void {
    dial.lastSpokenProgressAtFacetMs = this.deps.nowAtFacetMs();
    this.#sendToLiveModel(dial, {
      kind: "commentary",
      delegationId: dial.delegations.at(-1)?.delegationId ?? null,
      content: words.text,
      offset: words.offset,
    });
  }

  /** Words from the agent for the live model: `commentary` to paraphrase aloud, `thinking` to use
   * quietly, in `commentaryChunks` under one delegation id. */
  #sendToLiveModel(
    dial: Dial,
    update: {
      kind: "thinking" | "commentary";
      delegationId: string | null;
      content: string;
      /** The agent event it came from, which names each chunk. */
      offset: number;
    },
  ): void {
    let chunkIndex = 0;
    for (const content of commentaryChunks(update.content)) {
      this.#sendControl(dial, {
        type: `session.${update.kind}.append`,
        event_id: `agent_${update.offset}_${chunkIndex++}`,
        delegation_id: update.delegationId,
        content,
      });
    }
  }

  #sendControl(dial: Dial, message: Record<string, unknown>): void {
    if (!dial.socket) return;
    dial.socket.send(JSON.stringify(message));
  }

  /** Let go of the dial if it is still this incarnation's, waking its speaker sender so the sender
   * sees the dial is gone and returns instead of waiting on an outbox nothing fills any more. */
  #releaseDial(dial: Dial): void {
    if (this.#dial !== dial) return;
    this.#dial = null;
    dial.wakeSender?.();
  }

  /** Let the dial and everything hanging off it go. Safe to call twice. The provider is asked to
   * close first (`session.close` is what makes it finalize usage) and the socket is closed behind
   * it without waiting. */
  #hangUp(): void {
    const dial = this.#dial;
    if (dial) this.#releaseDial(dial);
    try {
      if (dial?.ready && dial.socket) {
        dial.socket.send(JSON.stringify({ type: "session.close" }));
      }
    } catch {
      /* Already gone. */
    }
    try {
      dial?.socket?.close();
    } catch {
      /* Already gone. */
    }
  }
}

/** Open the provider's WebSocket. No query parameters (the model rides `session.start`), and the
 * bearer is the platform's `getSecret` grammar, substituted at egress so the key never enters this
 * isolate. */
async function dialProviderSocket(): Promise<WebSocket> {
  const response = await fetch(LIVE.url, {
    headers: { Upgrade: "websocket", Authorization: 'Bearer getSecret("/secrets/openai")' },
  });
  const socket = response.webSocket;
  if (!socket) {
    // Provider error bodies can echo credential fragments; only the status belongs in the log.
    throw new Error(`Voice provider upgrade returned HTTP ${response.status}`);
  }
  socket.binaryType = "arraybuffer"; // before accept(): the current default is Blob
  socket.accept();
  return socket;
}

/** The class the loader hosts: `facets.get("voice-agent", { source, className: "VoiceAgentDurableObject" })`. */
export class VoiceAgentDurableObject extends StreamProcessorDurableObject<VoiceState> {
  /** The live model (a GPT-Live model id), which a config repo's `voice.ts` may set, for one that
   *  is newer than the default. None: "gpt-live-1". */
  static liveModel: string | undefined;

  /** The live model's voice (a GPT-Live voice name), which a config repo's `voice.ts` may set.
   *  None: "marin". */
  static liveVoice: string | undefined;

  /** The live model's instructions, which a config repo's `voice.ts` may change: it gets the
   *  device's agent path and the default instructions and answers the ones to use. None: the default. */
  static liveInstructions: LiveInstructions | undefined;

  /** `itx.whoami()`, read once per incarnation: the session every call starts with names the
   *  project. */
  #whoami?: { projectId: string; path: string };
  async #identity() {
    if (this.#whoami) return this.#whoami;
    using itx = this.getItx();
    return (this.#whoami = await itx.whoami());
  }

  processor = new VoiceAgentProcessor({
    nowAtFacetMs: () => Date.now(),
    /* A bare setTimeout is safe because every wait happens inside a background closure the host
     * keeps alive. */
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    dialProvider: dialProviderSocket,
    projectContext: async () => JSON.stringify(await this.#identity()),
    liveModel: () => VoiceAgentDurableObject.liveModel,
    liveVoice: () => VoiceAgentDurableObject.liveVoice,
    liveInstructions: () => VoiceAgentDurableObject.liveInstructions,
    messageAgent: async (path, words) => {
      // `itx.agents` is the collection of the context that provisioned the device, which this
      // context reaches through the parent link provisioning wrote (worker.ts
      // `ensureVoiceDevice`); the scope's own type names no installed app. For a device the
      // project provisioned it is the root's, so the agent reads the words as a person's.
      using itx = this.getItx() as IterateContextApiWith<"agents"> & Disposable;
      return await itx.agents.get(path).message(words);
    },
  });
}
