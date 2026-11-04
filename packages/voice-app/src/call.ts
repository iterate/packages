// This browser as a voice device: `@iterate-com/voice/call`'s client, the device's calls, with the
// browser's microphone and speaker on either end (audio.ts). The page provisions the device when
// it opens (`openDevice`), so a press is one append.

// registers `itx.voice` on InstalledAppRoots
import type {} from "@iterate-com/voice";
import { connectVoiceDevice, type VoiceCallStats, type VoiceDevice } from "@iterate-com/voice/call";
import type { IterateContextApiWith } from "iterate/api";
import type { AuthenticatedApp } from "iterate/app";
import { base64ToInt16, int16ToBase64, type AudioSession } from "./audio.ts";

/** `id` counts up per call: the list key (one subscription batch can report several facts at once). */
export type CallFact = { id: number; text: string };

/** What this browser saw of the call, counted by the call client because the relay cannot see the
 *  last hop. */
export type CallStats = VoiceCallStats;

type ProjectItx = ReturnType<Awaited<ReturnType<AuthenticatedApp["api"]["projects"]["get"]>>["cd"]>;

/** This browser's device on a project, once it is provisioned, or why it could not be. */
export type Device =
  | { ok: true; name: string; device: VoiceDevice<ProjectItx> }
  | { ok: false; name: string; error: string };

export type Call = {
  /** The device's relay context — what `useLiveState` subscribes to. */
  itx: ProjectItx;
  stats: CallStats;
  hangUp(): Promise<void>;
};

/** This browser's installation id, kept across visits: it names the device, so every call from
 *  this browser is one device's, with one agent that remembers. */
function installationName(): string {
  const key = "iterate-voice-device";
  try {
    const kept = localStorage.getItem(key);
    if (kept && /^web-[0-9a-f]{12}$/.test(kept)) return kept;
  } catch {
    // storage refused (a private window): the name lasts as long as the page
  }
  const name = `web-${Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
  try {
    localStorage.setItem(key, name);
  } catch {
    // as above
  }
  return name;
}

/** One provisioning per project per page, whatever it answered: the phone asks on every render,
 *  and a reload asks again. */
const devices = new Map<string, Promise<Device>>();

/** Provision this browser as a device of `projectId` and subscribe to its relay. Never rejects:
 *  a project whose voice is not answering is a `Device` that says why. */
export function openDevice(api: AuthenticatedApp["api"], projectId: string): Promise<Device> {
  const opened = devices.get(projectId);
  if (opened) return opened;
  const name = installationName();
  const opening = (async (): Promise<Device> => {
    try {
      const project = await api.projects.get(projectId);
      // The page offers Call only once `itx.voice` is configured (it sets voice up otherwise), so
      // the project answers `voice`.
      const installed = project as typeof project & Pick<IterateContextApiWith<"voice">, "voice">;
      return { ok: true, name, device: await connectVoiceDevice(installed, { client: name }) };
    } catch (error: unknown) {
      return {
        ok: false,
        name,
        error: `This project's voice agent isn't answering (${error instanceof Error ? error.message : String(error)}).`,
      };
    }
  })();
  devices.set(projectId, opening);
  return opening;
}

export function startCall(input: {
  device: VoiceDevice<ProjectItx>;
  audio: AudioSession;
  onFact(fact: CallFact): void;
}): Call {
  const { device, audio, onFact } = input;
  let factId = 0;
  const say = (text: string) => onFact({ id: factId++, text });
  const call = device.call({
    onSpeakerFrame: (frame) => {
      if (frame.clearSpeakerBufferBeforeFrame) audio.speaker.clear();
      if (frame.pcm) audio.speaker.push(base64ToInt16(frame.pcm));
    },
    // The list shows the call's milestones and the provider's troubles; the transcript and the
    // delegations are the live view's (the page's `voice-agent` state).
    onFact: (fact) => {
      switch (fact.type) {
        case "events.iterate.com/voice-agent/conversation-accepted":
          say(
            `accepted ${String(call.stats.pressToAcceptedMs)} ms after the press (handshake ${String(fact.payload.handshakeTookMs)} ms)`,
          );
          break;
        case "events.iterate.com/voice-agent/call-ended":
          audio.onFrame = null;
          say(`ended: ${fact.payload.reason}`);
          break;
        case "events.iterate.com/voice-agent/audio-trimmed":
        case "events.iterate.com/voice-agent/provider-error-reported":
        case "events.iterate.com/voice-agent/provider-disconnected":
          say(
            `${fact.type.replace("events.iterate.com/voice-agent/", "")}: ${JSON.stringify(fact.payload).slice(0, 160)}`,
          );
          break;
      }
    },
  });
  // The press is on its way: the microphone's frames follow it at once.
  audio.onFrame = (pcm) => {
    call.sendMicFrame(int16ToBase64(pcm));
  };
  say(`call ${call.activation.slice(0, 8)} on ${device.path}`);
  call.pressed.catch((error: unknown) => {
    audio.onFrame = null;
    say(`the press was refused: ${error instanceof Error ? error.message : String(error)}`);
  });
  return {
    itx: device.itx,
    stats: call.stats,
    async hangUp() {
      audio.onFrame = null;
      await call.hangUp("hung up");
    },
  };
}
