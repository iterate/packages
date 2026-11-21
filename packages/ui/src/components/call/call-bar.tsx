// call-bar.tsx — THE CALL'S CONTROLS WITH A MAIN BUTTON in words (Start a call, Join, Leave), for a
// page that wants one; an agent's header has the controls of call-controls.tsx. In one row that does
// not wrap: join, leave, mute, the camera, the screen, the devices, and the voice agent (a member's
// alone). Each switch is an icon button with its name in words for a screen reader and a pointer.
// What goes wrong is said in words under the buttons, from the engine's state, so a bar drawn again
// still says it: a start that failed, a join that failed, a voice agent that did not come. What the
// call says as it runs (its path, a repair, the mind's setup) is the tiles' (call-tiles.tsx), beside
// the chat.
import type { ReactNode } from "react";
import {
  BotIcon,
  BotOffIcon,
  MicIcon,
  MicOffIcon,
  MonitorOffIcon,
  MonitorUpIcon,
  PhoneIcon,
  PhoneOffIcon,
  VideoIcon,
  VideoOffIcon,
} from "lucide-react";
import { cn } from "cn";
import { CallDevices, CallWords } from "./call-controls.tsx";
import type { CallEngine, CallUi } from "#/lib/call-engine.ts";
import { joinable, type CallLive } from "#/lib/call-rules.ts";
import { Button } from "#/components/ui/button.tsx";

/**
 * `call`, `ui`, `live`: what `useCall` answers; in the call, the bar draws before `live` has come.
 * `member`: the viewer is a member of the mind (a guest gets no voice agent). `start`: turns the call
 * on for this agent, for a member whose agent has no call yet (`live` is undefined): the bar then
 * shows "Start a call", and a start that fails says why in the call's words (`call.fail`).
 * `starting`: the host's start is under way; the host holds it, so it outlives this bar (a popover
 * that closes). `join`: the host's own Join, such as a lobby it opens first (`CallLobby`); with
 * none, Join joins at once. What goes wrong is said in one element under the buttons,
 * `data-slot="call-bar-words"`, which a host may place.
 */
export function CallBar({
  call,
  ui,
  live,
  member,
  start,
  starting = false,
  join,
  className,
}: {
  call: CallEngine | null;
  ui: CallUi;
  live: CallLive | undefined;
  member: boolean;
  start?: () => Promise<unknown>;
  starting?: boolean;
  join?: () => void;
  className?: string;
}) {
  if (!call || (!ui.joined && !starting && !start && !live)) return null;
  return (
    <div
      data-slot="call-bar"
      data-joined={ui.joined}
      className={cn("flex flex-col gap-2", className)}
    >
      <div className="flex items-center gap-1">
        {ui.joined ? <JoinedControls call={call} ui={ui} live={live} member={member} /> : null}
        <MainButton call={call} ui={ui} live={live} start={start} starting={starting} join={join} />
      </div>
      <CallWords call={call} ui={ui} />
    </div>
  );
}

/** The switches of a page in the call: the microphone, the camera, the screen, the devices, and the
 *  voice agent (a member's alone). */
function JoinedControls({
  call,
  ui,
  live,
  member,
}: {
  call: CallEngine;
  ui: CallUi;
  live: CallLive | undefined;
  member: boolean;
}) {
  return (
    <>
      <Toggle
        on={!ui.muted}
        label="Microphone"
        title={ui.unmuting ? "Unmuting…" : ui.muted ? "Unmute" : "Mute"}
        icon={ui.muted ? <MicOffIcon /> : <MicIcon />}
        disabled={ui.unmuting}
        onPress={() => call.toggleMute()}
      />
      <Toggle
        on={ui.camera}
        label="Camera"
        title={ui.camera ? "Turn the camera off" : "Share video"}
        icon={ui.camera ? <VideoIcon /> : <VideoOffIcon />}
        onPress={() => void call.toggleCamera()}
      />
      <Toggle
        on={ui.screen}
        label="Share screen"
        title={ui.screen ? "Stop sharing the screen" : "Share the screen"}
        icon={ui.screen ? <MonitorOffIcon /> : <MonitorUpIcon />}
        onPress={() => void call.toggleScreen()}
      />
      <CallDevices call={call} ui={ui} />
      {member ? <VoiceAgentToggle call={call} ui={ui} live={live} /> : null}
    </>
  );
}

/** The voice agent: invited into the call, or sent away when it is there. */
function VoiceAgentToggle({
  call,
  ui,
  live,
}: {
  call: CallEngine;
  ui: CallUi;
  live: CallLive | undefined;
}) {
  if (live?.voiceAgent)
    return (
      <Toggle
        on
        label="Voice agent"
        title="Send the voice agent away"
        icon={<BotOffIcon />}
        disabled={ui.ai === "starting"}
        onPress={() => void call.aiDismiss()}
      />
    );
  return (
    <Toggle
      on={false}
      label="Voice agent"
      title={ui.ai === "starting" ? "The voice agent is coming…" : "Add a voice agent"}
      icon={<BotIcon />}
      disabled={ui.ai !== "off"}
      onPress={() => void call.aiInvite()}
    />
  );
}

/** What the main button does and says in each state of the page: its words, its title for a
 *  pointer, and its look. "starting" and "joining" take no press. */
const MAIN = {
  leave: { words: "Leave", title: "Leave the call", variant: "destructive" },
  starting: { words: "Starting…", title: undefined, variant: "outline" },
  start: { words: "Start a call", title: undefined, variant: "outline" },
  joining: { words: "Joining…", title: "Join the call", variant: "default" },
  join: { words: "Join", title: "Join the call", variant: "default" },
} as const;

/** THE CALL'S ONE MAIN BUTTON: Start a call, Join, or Leave. It is one element in one place
 *  whatever the state, so keyboard focus stays on it from Join to Leave and back. While a start or
 *  a join runs it says so and takes no press, by `aria-disabled`: a disabled button drops focus. */
function MainButton({
  call,
  ui,
  live,
  start,
  starting,
  join,
}: {
  call: CallEngine;
  ui: CallUi;
  live: CallLive | undefined;
  start: (() => Promise<unknown>) | undefined;
  starting: boolean;
  join: (() => void) | undefined;
}) {
  const state: keyof typeof MAIN = ui.joined
    ? "leave"
    : starting
      ? "starting"
      : start
        ? "start"
        : ui.joining
          ? "joining"
          : "join";
  const { words, title, variant } = MAIN[state];
  const shut = state === "join" && !joinable(live);
  const press = () => {
    if (state === "leave") void call.leave();
    if (state === "join") {
      if (join) join();
      else void call.join();
    }
    if (state === "start" && start)
      start().catch((error: unknown) =>
        call.fail(
          `The call could not start: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  };
  return (
    <Button
      size="sm"
      variant={variant}
      title={shut ? "This mind has no call service yet" : title}
      disabled={shut}
      aria-disabled={state === "starting" || state === "joining" || undefined}
      // one width for each of its words: the header's path does not move as they change
      className="min-w-28 aria-disabled:opacity-50"
      onClick={press}
    >
      {state === "leave" ? (
        <PhoneOffIcon data-icon="inline-start" />
      ) : (
        <PhoneIcon data-icon="inline-start" />
      )}
      {words}
    </Button>
  );
}

/** One of the call's switches: an icon, a fixed name for a screen reader, what a press does for a
 *  pointer, and whether it is on. The name never changes with the state: `aria-pressed` says it. */
function Toggle({
  on,
  label,
  title,
  icon,
  disabled,
  onPress,
}: {
  on: boolean;
  label: string;
  title: string;
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
      title={title}
      disabled={disabled}
      onClick={onPress}
    >
      {icon}
    </Button>
  );
}
