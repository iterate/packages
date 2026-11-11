// api.ts — `itx.voice`, the voice service's published type. Voice is userspace: a mind installs
// it (install.ts names worker.ts, as `voice.ts` of its config re-exports it, in the `itx.voice`
// rewrite rule), the platform never ships it, so
// iterate/api does not name it. Importing this package registers the root on iterate/api's
// `InstalledAppRoots`, and a caller that knows voice is installed writes
// `itx as IterateContextApiWith<"voice">`. worker.ts `implements VoiceApi`; Kit's firmware calls
// `ensureVoiceDevice` over the wire (iterate/kit's firmware/components/voice/src/voice_loop.c).
import type { z } from "zod";
import type { ScreenImageInput, ScreenInfo } from "./screen.ts";

/** `itx.voice`: a device's provisioning, the screen renderer, and the installer's liveness probe. */
export interface VoiceApi {
  /** The installer's check that the service loads and answers, in the mind it names. */
  health(): Promise<{ ok: true; mindId: string }>;
  /** Render `image.html` in Browser Run at the device's advertised resolution and upload it to
   *  `itx.clients[device].screen` in its chunk size; `image: null` restores the call-status view. */
  setImage(input: z.input<typeof ScreenImageInput>): Promise<
    | { shown: false; bytes: number; renderMs: number; transferMs: number; totalMs: number }
    | {
        shown: true;
        width: number;
        height: number;
        format: z.infer<typeof ScreenInfo>["preferredFormat"];
        bytes: number;
        renderMs: number;
        transferMs: number;
        totalMs: number;
      }
  >;
  /** Provisioning, when a device connects (Kit's firmware), never on a press: the device's agent at `/agents/voice/<client>` and its relay at
   *  `/voice/<client>`, each linked to the context that asked. Idempotent. `client` names the
   *  device: a Kit board's `itx.clients` name, or the installation id a browser (`web-…`) or the
   *  CLI (`--device`) keeps. `screen` is the `itx.clients` name of a device with a screen: the agent
   *  gets instructions for drawing on it with `setImage`. A press is then one append to `path`,
   *  `events.iterate.com/voice-agent/call-started { activation }` (call-client.ts). */
  ensureVoiceDevice(options: {
    client: string;
    screen?: string;
  }): Promise<{ path: string; agentPath: string }>;
}

declare module "iterate/api" {
  interface InstalledAppRoots {
    voice: VoiceApi;
  }
}
