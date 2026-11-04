// mic-pacer.ts — everything the live model hears goes through ONE queue and ONE pacer: the device's
// microphone frames, oldest first, and the digital silence that covers the gaps between them.
// GPT-Live refuses input faster than 1.2× real time beyond a burst of 5 s
// (`input_audio_rate_limit_exceeded`), and its session timeline runs on input audio, so a provider
// that hears nothing stops answering mid-word.
// The pacer is a token bucket on the facet clock; voice-agent.ts owns the clock and the socket.
import { bytesToBase64 } from "iterate/lib";

/** 16 kHz mono PCM16: two bytes per sample, sixteen samples per millisecond. */
export const PCM16_BYTES_PER_MS = 32;

/** The pacer sends at most this multiple of real time, so a backlog drains without a burst. */
const PACE = 1.2;

/** The most credit the pacer saves up while it runs, in audio ms (one frame, when a frame is
 *  longer). */
const CREDIT_CAP_MS = 100;

/** The most held audio that goes to the provider at once when it gets ready, so a person's first
 *  words reach it as soon as it listens. GPT-Live's own limit: on 4 November 2026 it took 5 s at
 *  once with the rest at 1.2×, and refused 5.7 s at once. */
const HELD_BURST_MAX_MS = 5_000;

/** The most microphone audio the queue holds: the relay's 5 s opening deadline, plus a second for
 *  the frames a device sent before the dial began. Past it the call ends, because a request with
 *  its start cut off tells the model a different one. */
export const MIC_QUEUE_MAX_MS = 6_000;

/** The silence that fills a gap, one frame at a time. */
const SILENCE_MS = 100;
const SILENCE_FRAME_B64 = bytesToBase64(new Uint8Array(SILENCE_MS * PCM16_BYTES_PER_MS));

/** One call's microphone path to the provider. Frames queue from the press; nothing leaves until
 *  `start`, then what was held goes at once up to `HELD_BURST_MAX_MS`, and the rest at most
 *  `PACE` times real time. */
export class MicPacer {
  readonly #frames: { pcm: string; ms: number }[] = [];
  #queuedMs = 0;
  /** Facet clock at `start`; null while the provider is not ready and the queue only holds. */
  #startedAtMs: number | null = null;
  #creditMs = 0;
  #refilledAtMs = 0;
  /** Audio sent since `start`, device frames and silence: the provider's session timeline. */
  #sentMs = 0;

  /** Audio queued and not yet sent, in ms. */
  get queuedMs(): number {
    return this.#queuedMs;
  }

  /** Queue one device frame of `ms` audio. False, queueing nothing, when it would take the queue
   *  past `MIC_QUEUE_MAX_MS`. */
  push(pcm: string, ms: number): boolean {
    if (this.#queuedMs + ms > MIC_QUEUE_MAX_MS) return false;
    this.#frames.push({ pcm, ms });
    this.#queuedMs += ms;
    return true;
  }

  /** The provider is ready. The pacer's clock starts at `nowMs` with credit for what the queue
   *  holds, up to `HELD_BURST_MAX_MS`: that much goes at once, and the rest drains at the pace. */
  start(nowMs: number): void {
    this.#startedAtMs = nowMs;
    this.#refilledAtMs = nowMs;
    this.#creditMs = Math.min(this.#queuedMs, HELD_BURST_MAX_MS);
  }

  /** What may go to the provider at `nowMs`, in order: queued frames while the credit lasts, then,
   *  only when nothing is queued and the provider's timeline has fallen a whole silence frame
   *  behind the wall clock, one silence frame. */
  take(nowMs: number): string[] {
    if (this.#startedAtMs === null) return [];
    /* The burst credit from `start` is above the cap until it is spent; the cap limits only what
     * the pacer saves up after it. A frame goes only on credit it has, never borrowed, so what was
     * sent never runs ahead of the burst plus 1.2× the time since `start`; the bucket therefore
     * holds one whole frame when the next frame is longer than the cap. */
    const capMs = Math.max(CREDIT_CAP_MS, this.#frames[0]?.ms ?? 0);
    if (this.#creditMs < capMs) {
      this.#creditMs = Math.min(capMs, this.#creditMs + (nowMs - this.#refilledAtMs) * PACE);
    }
    this.#refilledAtMs = nowMs;
    const elapsedMs = nowMs - this.#startedAtMs;
    /* A timeline further behind than one silence frame is forgiven, not repaid: repaying it would
     * put silence between the frames of a person who is speaking again. */
    this.#sentMs = Math.max(this.#sentMs, elapsedMs - SILENCE_MS);
    const due: string[] = [];
    for (;;) {
      const head = this.#frames[0];
      if (head) {
        if (this.#creditMs < head.ms) break;
        this.#frames.shift();
        this.#queuedMs -= head.ms;
        this.#creditMs -= head.ms;
        this.#sentMs += head.ms;
        due.push(head.pcm);
        continue;
      }
      if (elapsedMs - this.#sentMs < SILENCE_MS || this.#creditMs < SILENCE_MS) break;
      this.#creditMs -= SILENCE_MS;
      this.#sentMs += SILENCE_MS;
      due.push(SILENCE_FRAME_B64);
    }
    return due;
  }
}
