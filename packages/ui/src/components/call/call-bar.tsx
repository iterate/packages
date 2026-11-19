// call-bar.tsx — THE CALL'S CONTROLS, compact enough for an agent's header: join, leave, mute, the
// camera, the screen, the devices, and the voice agent (a member's alone). Each is an icon button
// with its name in words for a screen reader and a pointer. What goes wrong is said in words under
// the buttons: a start that failed, a join that failed, a voice agent that did not come. What the
// call says as it runs (its path, a repair, the mind's setup) is the tiles' (call-tiles.tsx), beside
// the chat.
import { useState, type ReactNode } from "react";
import {
  BotIcon,
  BotOffIcon,
  MicIcon,
  MicOffIcon,
  MonitorOffIcon,
  MonitorUpIcon,
  PhoneIcon,
  PhoneOffIcon,
  Settings2Icon,
  VideoIcon,
  VideoOffIcon,
  XIcon,
} from "lucide-react";
import { cn } from "cn";
import type { CallEngine, CallUi, VoiceRefusal } from "#/lib/call-engine.ts";
import { joinable, type CallLive, type DeviceKind } from "#/lib/call-rules.ts";
import { Alert, AlertDescription } from "#/components/ui/alert.tsx";
import { Button } from "#/components/ui/button.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * `call`, `ui`, `live`: what `useCall` answers. `member`: the viewer is a member of the mind (a
 * guest gets no voice agent). `start`: turns the call on for this agent, for a member whose agent
 * has no call yet (`live` is undefined): the bar then shows "Start a call", and says in words why a
 * start failed. `voiceAppHref`: where a member sets up voice, named when the voice agent cannot
 * come for want of a key or credit.
 */
export function CallBar({
  call,
  ui,
  live,
  member,
  start,
  voiceAppHref,
  className,
}: {
  call: CallEngine | null;
  ui: CallUi;
  live: CallLive | undefined;
  member: boolean;
  start?: () => Promise<unknown>;
  voiceAppHref?: string;
  className?: string;
}) {
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [aiError, setAiError] = useState<VoiceRefusal | null>(null);
  const begin = () => {
    if (!start) return;
    setStarting(true);
    setStartError("");
    start()
      .catch((error: unknown) => setStartError(`The call could not start: ${messageOf(error)}`))
      .finally(() => setStarting(false));
  };
  const inviteAi = () => {
    setAiError(null);
    // `aiInvite` throws an Error, with the call's own words in `json` when the call refused
    call
      ?.aiInvite()
      .catch((error: unknown) =>
        setAiError(error instanceof Error ? error : new Error(String(error))),
      );
  };
  const words =
    startError || ui.error ? (
      <Said
        text={startError || ui.error}
        onClose={() => {
          setStartError("");
          call?.dismiss();
        }}
      />
    ) : null;

  if (!live || !call) {
    if (!start && !startError) return null;
    return (
      <div data-slot="call-bar" className={cn("flex flex-col gap-2", className)}>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" disabled={starting} onClick={begin}>
            <PhoneIcon data-icon="inline-start" />
            {starting ? "Starting…" : "Start a call"}
          </Button>
        </div>
        {words}
      </div>
    );
  }

  return (
    <div
      data-slot="call-bar"
      data-joined={ui.joined}
      className={cn("flex flex-col gap-2", className)}
    >
      <div className="flex flex-wrap items-center gap-1">
        {ui.joined ? (
          <>
            <Toggle
              on={!ui.muted}
              label={ui.muted ? "Unmute" : "Mute"}
              icon={ui.muted ? <MicOffIcon /> : <MicIcon />}
              onPress={() => call.toggleMute()}
            />
            <Toggle
              on={ui.camera}
              label={ui.camera ? "Turn the camera off" : "Share video"}
              icon={ui.camera ? <VideoIcon /> : <VideoOffIcon />}
              onPress={() => void call.toggleCamera()}
            />
            <Toggle
              on={ui.screen}
              label={ui.screen ? "Stop sharing the screen" : "Share the screen"}
              icon={ui.screen ? <MonitorOffIcon /> : <MonitorUpIcon />}
              onPress={() => void call.toggleScreen()}
            />
            <Devices call={call} ui={ui} />
            {member ? (
              live.voiceAgent ? (
                <Toggle
                  on
                  label="Send the voice agent away"
                  icon={<BotOffIcon />}
                  disabled={ui.ai === "starting"}
                  onPress={() => void call.aiDismiss()}
                />
              ) : (
                <Toggle
                  on={false}
                  label={ui.ai === "starting" ? "The voice agent is coming…" : "Add a voice agent"}
                  icon={<BotIcon />}
                  disabled={ui.ai !== "off"}
                  onPress={inviteAi}
                />
              )
            ) : null}
            <Button
              size="sm"
              variant="destructive"
              title="Leave the call"
              onClick={() => void call.leave()}
            >
              <PhoneOffIcon data-icon="inline-start" />
              Leave
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            disabled={ui.joining || !joinable(live)}
            title={joinable(live) ? "Join the call" : "This mind has no call service yet"}
            onClick={() => void call.join()}
          >
            <PhoneIcon data-icon="inline-start" />
            {ui.joining ? "Joining…" : "Join"}
          </Button>
        )}
      </div>
      {words}
      {aiError ? (
        <Said
          text={<VoiceRefusalText error={aiError} voiceAppHref={voiceAppHref} />}
          onClose={() => setAiError(null)}
        />
      ) : null}
    </div>
  );
}

/** One of the call's switches: an icon, its name in words for a screen reader and a pointer, and
 *  whether it is on. */
function Toggle({
  on,
  label,
  icon,
  disabled,
  onPress,
}: {
  on: boolean;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      size="icon-sm"
      variant={on ? "outline" : "secondary"}
      aria-label={label}
      aria-pressed={on}
      title={label}
      disabled={disabled}
      onClick={onPress}
    >
      {icon}
    </Button>
  );
}

/** An error in words, with a button that closes it. */
function Said({ text, onClose }: { text: ReactNode; onClose: () => void }) {
  return (
    <Alert variant="destructive" role="alert">
      <AlertDescription className="flex items-start justify-between gap-2">
        <span>{text}</span>
        <Button size="icon-xs" variant="ghost" title="Close" onClick={onClose}>
          <XIcon />
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** Why the voice agent did not come, and what a member can do about it: a spent credit or no key
 *  has two ways out, in the call's own marks; anything else is the call's own words. */
function VoiceRefusalText({ error, voiceAppHref }: { error: VoiceRefusal; voiceAppHref?: string }) {
  const voiceApp = voiceAppHref ? <a href={voiceAppHref}>Voice app</a> : "Voice app";
  if (error.json?.credit)
    return (
      <>
        The mind&apos;s voice credit at iterate Cloud is spent. Two ways to pay: connect your
        ChatGPT plan in iterate Cloud, or save your own OpenAI key as /secrets/openai. The{" "}
        {voiceApp} asks for it once voice is on.
      </>
    );
  if (error.json?.noKey)
    return (
      <>
        This mind has no OpenAI key for the voice agent yet. iterate Cloud gives one with its
        credit, or save your own as /secrets/openai. The {voiceApp} asks for it once voice is on.
      </>
    );
  return <>{messageOf(error)}</>;
}

const PICKERS: [DeviceKind, string][] = [
  ["mic", "Microphone"],
  ["camera", "Camera"],
  ["speaker", "Speaker"],
];

/** The microphone, the camera and the speaker, each a picker; the browser lists them when the
 *  pickers open. */
function Devices({ call, ui }: { call: CallEngine; ui: CallUi }) {
  return (
    <Popover onOpenChange={(open) => open && void call.listDevices()}>
      <PopoverTrigger
        nativeButton
        render={
          <Button size="icon-sm" variant="outline" aria-label="Devices" title="Devices">
            <Settings2Icon />
          </Button>
        }
      />
      <PopoverContent className="flex w-72 flex-col gap-3">
        {PICKERS.map(([kind, label]) =>
          kind === "speaker" && !ui.devices.speakerSupported ? (
            <p key={kind} className="text-xs text-muted-foreground">
              This browser cannot choose a speaker.
            </p>
          ) : (
            <label key={kind} className="flex flex-col gap-1 text-xs text-muted-foreground">
              {label}
              <NativeSelect
                value={ui.devices.chosen[kind]}
                onChange={(event) => void call.chooseDevice(kind, event.target.value)}
              >
                {ui.devices[kind].map((option) => (
                  <NativeSelectOption key={option.id} value={option.id}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          ),
        )}
      </PopoverContent>
    </Popover>
  );
}
