# @iterate-com/voice

GPT-Live voice calls for a project's devices. Each device has two contexts, made when it connects
and kept: its relay, `/voice/<device>`, which runs this package's relay facet and holds the live
model, and its agent, `/agents/voice/<device>`, an agent of the agents app (`iterate/agents`,
created through `itx.agents`) that answers every call the device makes and remembers them. Each
request the live model delegates goes to the agent as a message through the agents app
(`itx.agents.get(path).message(words)`), and the agent's answer goes back to the live model to
speak. A press is ONE append to the relay's context, `call-started { activation }`: nothing is
created on it, and the relay dials in the batch that carries it. Userspace: a project installs this
package; the platform ships none of it.

Two contexts, not one, because a context's birth restarts what it runs: an agent's cold build must
never sit in front of the relay's dial.

## Install

A project's config repo depends on the package, re-exports its service and relay class from
`voice.ts`, and installs voice from its init case beside the agents app, which every device's agent
runs on (configs/voice does all of it):

```text
package.json   "dependencies": { "@iterate-com/voice": "0.1.0-main.<date>-<sha>" }   (npm's `main` dist-tag, pinned)
voice.ts       export { default, VoiceAgentDurableObject } from "@iterate-com/voice";
```

```ts
import { installAgents } from "iterate/agents/install";
import { installVoice } from "@iterate-com/voice/install";

// in processEvent, the init case
case "events.iterate.com/project/worker-updated":
  await installAgents(itx);
  await installVoice(itx);
```

`installVoice` stores the screen font and writes the `itx.voice` rule to `voice.ts`'s default
export (`{ mainModule: "voice.ts", source: itx.cd('/').config }`), and each device's relay facet
is that module's class (`voiceAgentFacetSpec`), so nothing is copied into the project: a commit that
changes what `voice.ts` bundles, such as a new pin, is the relay's code from its next event, and one
that only changes the website leaves the relay running. A commit that changes `voice.ts` ends every
call in progress: its relay restarts on the new build and the call ends as interrupted. The OpenAI
key (the live model's) is needed only once a call starts: `ensureVoiceAgent`, which Kit's Prepare
and voice.iterate.com run, stores it when the project has none, waits for `itx.voice` and asks it
for `health()`, and refuses a project whose config installs no voice or whose publication was
refused, saying why. An upgrade commits a newer pin (the Voice app's **Upgrade to the newest**,
`upgradeVoice`) and waits for that commit's publication, throwing why it was refused;
`voiceVersion` reads the build the project runs, the pin of its published commit, which a refused
upgrade leaves where it was. A device's calls are the same either way, so no Kit board needs a
reflash for an upgrade.

## A device

`itx.voice.ensureVoiceDevice({ client, screen? })` provisions a device: Kit's firmware calls it
when it connects, the voice app when its page opens, and `voice-call.ts` before its call. It is
idempotent, and it is never part of a press: a press on a device that is not provisioned ends at
once, saying so. `client` names the device: a Kit board's `itx.clients` name, the installation id
a browser keeps (`web-<12 hex>`), or the CLI's `--device`. Both contexts are linked to the context
that asked, so a device holds no more than it does.

- **The agent** is created with `itx.agents.at(caller).create("/agents/voice/<client>")`.
  Provisioning adds [voice-context.md](src/voice-context.md), the instructions for spoken answers,
  as a developer message that starts no turn; [screen-context.md](src/screen-context.md) the same
  way for a device with a screen; and
  `agent/configured { config: { llmRequestDebounceMs: 0, idleCompactionAfterMs: 900_000, idleCompactionMinNewTokens: 2_000 } }`, so a
  hand-over is answered at once and the history between calls gets its idle summary 15 minutes
  after a request, once 2,000 tokens are new since the last one (the agents app's idle compaction
  is off until an agent sets it). Each instruction
  and the patch are keyed by their content, so a build with new ones adds them once. Two rows on the agent's context copy what the relay needs to the relay's:
  `agent/summary-updated`, `agent/web-message-sent`, `agent/paused`, and the agent's own report of
  each failed script (the `context-added` that begins "Your script failed") as
  `voice-agent/script-failed`; the platform never copies an `itx/*` event.
- **The relay**, `/voice/<client>`, gets a parent link to the caller, the `voice-agent`
  subscription row, and `voice-agent/device-provisioned { agentPath }`, which wakes the relay so it
  prepares the live model's session before the first press. A second row copies each press to the
  agent's context as `agent/warm-up-requested`.

The backend is the project's normal agent: its system prompt, capability tree and `run` tool. Keep
tool examples in the agents app's prompt; do not maintain a separate voice API description. Each
hand-over carries the words said since the one before (`Person:` and `Voice:` lines), and the first
of each call starts with `New call.`, so the agent's own conversation holds every call on the device
and where each began. A script's status reaches the live model as a quiet note, a failed script
too, and a message is spoken for the newest hand-over of this call its request had read, unless it
was written beside a script (`besideScript`), before that script's result. A message ending in
`HANG_UP` ends the call after the goodbye, and an agent that pauses says so. What the agent says
before a call has handed it anything belongs to an earlier call and is not spoken.

The screen guide's display action is `itx.cd("/").voice.setImage({ device, image: { html } })`.
The agent retains supplied context messages and passes them to the model unchanged; it has no
screen-specific matching logic. Script calls and results are retained through the same context
events, so a later question can refer to the exercises or other content already displayed. The
renderer uses `screen.info()` for dimensions and supported monochrome, grayscale or colour formats.
Set `image: null` to restore the normal call-status view. Capture waits for `<img>` decoding and
font readiness, with a five-second asset wait. A failed image leaves the existing screen intact.
Use `<img>` instead of CSS backgrounds for photos; the readiness check covers image elements.

## A call

One activation per device. The press, `call-started { activation }`, opens a call; the relay dials
in the batch that carries it and sends the session it prepared, awaiting nothing else. A repeated
press is the call it already opened, and a new activation while a call is live ends that call
first. Every fact and frame names its activation. The device sends microphone frames from the
press, never waiting for an answer: the relay queues them (at most 6 s) until the provider is
ready, then sends everything through one pacer (`src/mic-pacer.ts`): up to 5 s of what it held at
once, the rest at 1.2× real time. A frame can reach the relay a moment before its own
`call-started` does; up to 1 s of such frames waits for that call. Words typed into a call
(`voice-call.ts --say`) reach the relay as `voice-agent/words-typed`, a hand-over like a spoken
request. Words the device gives the voice to say, such as a phone bridge's opening line, reach it as
`voice-agent/words-given` (the client's `speak`): the live model says them at once, or once the
session starts. Unlike the agent's words, they need no hand-over of the call first, because they
name the call.

The live model hands over within seconds of the press, so the press also readies the agent, on the
row above and never in the dial's way: its context wakes, it reads its instructions, opens its socket
if it has one (a project's own `llm.apiKeys`) and has the provider cache its prompt with one ping
(`iterate/agents`, Warming up), which its log shows as `agent/cache-kept-warm`. A first hand-over
that comes while the ping runs is answered at once, beside it. Facts the relay writes:

| Event                   | Payload                                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `conversation-accepted` | `pressToDialMs` (`call-started`'s commit to the dial), `handshakeTookMs`, `upgradeTookMs`, `heldMs`  |
| `call-ended`            | `reason`, and on the relay's own, `startup`: how far the call got (the same fields, `trimmedMs` too) |
| `audio-trimmed`         | `ms`: microphone audio past the 6 s queue, which ends the call                                       |

The call client counts the rest on the device's own clock: `pressToAcceptedMs` and
`pressToFirstAudioMs`.

| File                                         | What                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/voice-agent.ts`                         | `VoiceAgentDurableObject`: the GPT-Live relay and the device's call fold. Dials `wss://api.openai.com/v1/live/sessions` through egress with `getSecret("/secrets/openai")`, forwards `mic-frame`s, appends `speaker-frame`s and transcripts, hands the live model's delegations to the device's agent, and forwards the agent's replies to the live model to speak.                                                                       |
| `src/mic-pacer.ts`                           | The relay's one queue and pacer for everything the live model hears: the device's frames from the press on, held until the session starts, sent oldest first: what was held goes at once up to 5 s (GPT-Live's burst limit), the rest at most 1.2× real time (at most 100 ms of saved-up credit), and digital silence only when nothing is queued and the provider would starve. More than 6 s queued ends the call with `audio-trimmed`. |
| `src/worker.ts`                              | The voice service at `itx.voice`: `ensureVoiceDevice`, `setImage`, `health`.                                                                                                                                                                                                                                                                                                                                                              |
| `src/install.ts`                             | `installVoice`, the init case's; `ensureVoiceAgent`, the key and the wait Kit and voice.iterate.com run in the browser, preserving existing services and secrets; `voiceVersion` and `upgradeVoice`, the running build and its upgrade.                                                                                                                                                                                                   |
| `src/screen-font.ts`                         | The screen font's CSS with its font embedded (`assets/`), stored at `voice/screen-font.css`.                                                                                                                                                                                                                                                                                                                                              |
| `src/call-client.ts`                         | `connectVoiceDevice(project, { client, screen? })` (`@iterate-com/voice/call`): a device as a client makes its calls — provisioning and one subscription, then `call()`, the press, `mic-frame` appends, `speak` (`words-given`), the keepalive, the 5 s opening deadline and `call-ended`; `moveTo` carries the device to a new link after a reconnect. voice.iterate.com, `voice-call.ts` and the phone bridges run it.                 |
| `packages/agents-app/scripts/voice-call.ts`  | One conversation from Node through the call client (`--device`): a WAV in, the answer's WAV out, the press timeline printed.                                                                                                                                                                                                                                                                                                              |
| `packages/agents-app/scripts/voice-board.ts` | The physical HAVPE proof: remote press, the prompt spoken through the air, transcripts checked.                                                                                                                                                                                                                                                                                                                                           |

A device's calls are `readEvents` on its relay's context, and what its agent did on the agent's,
through the CLI:
`pnpm exec iterate itx run --project <slug> --eval 'return (await itx.cd("/voice/<device>").readEvents(0, 500)).events'`.

## Your own model, voice and instructions

A project sets the live model, its voice and its instructions from its `voice.ts`, on the relay's
class. Each is read when the relay prepares its session, once per build, so a commit changes the
next call:

```ts
// voice.ts
import { VoiceAgentDurableObject } from "@iterate-com/voice";

export { default, VoiceAgentDurableObject } from "@iterate-com/voice";

VoiceAgentDurableObject.liveModel = "gpt-live-1"; // the default; name a newer GPT-Live model here
VoiceAgentDurableObject.liveVoice = "vesper"; // default "marin"
VoiceAgentDurableObject.liveInstructions = ({ path, instructions }) =>
  `You are Jeeves, the family's chief of staff. ${instructions}`; // path: the device's agent
```

`instructions` is the default: the delegation policy and the project. Return it changed or
whole.

## The device's calls on the wire

```ts
const root = session.authenticate(credentials).projects.get("prj-voice");
// when the device connects: provisioning, then one subscription for every call
const { path } = await root.voice.ensureVoiceDevice({
  client: "home_assistant_voice_preview_edition",
});
const relay = root.cd(path);
await relay.subscribe({
  name: "kit-voice",
  consumes: [
    "events.iterate.com/voice-agent/speaker-frame",
    ".../conversation-accepted",
    ".../call-ended",
  ],
  target: (events, range) => {
    /* bare function; argument 0 IS the events array; filter by activation */
  },
});
// the press: ONE append, and the frames follow it at once
await relay.append({
  type: "events.iterate.com/voice-agent/call-started",
  idempotencyKey: `voice-agent/call:${activation}`,
  payload: { activation },
});
await relay.append({
  type: "events.iterate.com/voice-agent/mic-frame",
  ephemeral: true,
  payload: { activation, pcm },
}); // 50 ms PCM16 16 kHz, base64
await relay.append({
  type: "events.iterate.com/voice-agent/call-ended",
  payload: { activation, reason },
});
```

Platform facts this leans on: a processor sees an ephemeral type only when its subscription names
it (`consumes: ["*", mic-frame, keepalive]`); the engine's `append` stamps provenance, not the
catalog's `ephemeral` marker, so the facet stamps its speaker frames; `provide()` rules are
session-scoped handles, the raw `itx/rewrite-rule-configured` event is the durable rule; a client
push carries every event folded behind it, so one speaker frame per append keeps a push under the
ESP32's 16 KiB inbox slot; a context comes into being at its first append, and has only what its
parent link gives it.

## Install, run, prove

Run these commands from `packages/agents-app`. The project's config installs both apps.

```bash
export WORKER_BASE_URL=https://os.iterate.com
# a personal access token for prj-voice (core/os/docs/credentials.md): the Dash's Sessions page, or
# `pnpm exec iterate --config prd tokens create --name voice-scripts --project prj-voice`
export ITERATE_BEARER_TOKEN=itk_…
export OPENAI_API_KEY=$(doppler secrets get OPENAI_API_KEY --project os --config prd --plain)
# First prepare the project at https://k.iterate.com
say -o ask.wav --data-format LEI16@16000 --channels=1 "What is two plus two?"
PROJECT=prj-voice node scripts/voice-call.ts --utterance ask.wav --out answer.wav --device cli-laptop
PROJECT=prj-voice node scripts/voice-board.ts --device home_assistant_voice_preview_edition --expect banana
```

`--expect` is a case-insensitive regular expression tested against the spoken transcript; models
say numbers as digits or as words, so ask for either: `--expect "132|thirty-two"`.
