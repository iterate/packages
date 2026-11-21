// call-controls.tsx — THE CALL'S CONTROLS IN A HEADER, icon buttons in one row that does not wrap:
// the microphone, the camera, the screen, the voice agent (a member's alone), and, in the call, the
// devices and Leave. The Dash's agent page and Meet draw the same row.
//
// - ONE PRESS GOES IN: before the page is in the call, a press of the microphone, the camera, the
//   screen or the voice agent turns the call on when the agent has none (`start`), joins, then does
//   what the button says. The microphone and the voice agent join with the microphone open; the
//   camera and the screen join listening, and send only their own picture.
// - THE BUTTONS ARE THERE FROM THE FIRST PAINT: with no engine yet, or while nobody knows whether
//   the agent has a call, they are drawn and cannot be pressed. So the header does not move when the
//   call comes.
// - EACH BUTTON HAS ONE NAME for a screen reader (`aria-label`); `aria-pressed` says whether it is
//   on. Its tooltip says what a press does, or why it cannot be pressed.
// - WHAT GOES WRONG is said in words under the buttons, from the engine's state, so a row drawn
//   again still says it: a start that failed, a join that failed, a voice agent that did not come.
// - ON A PHONE (`CallHeaderControls`) the row is behind one button, so the path and the tabs keep
//   the header.
import { useState, useSyncExternalStore, type ReactNode } from "react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip.tsx";

/** What a press before the join does once the page is in: the button that was pressed. */
type First = "mic" | "camera" | "screen" | "voice";

export type CallControlsProps = {
  /** What `useCall` answers. `call` is null until the page has a context and its row: the buttons
   *  are then drawn and cannot be pressed. */
  call: CallEngine | null;
  ui: CallUi;
  live: CallLive | undefined;
  /** The viewer is a member of the mind: a guest gets no voice agent. */
  member: boolean;
  /** Turns the call on, for an agent that has none yet (`live` is undefined). A press then turns it
   *  on, and joins. Without it and without `live`, nobody knows yet whether there is a call. */
  start?: () => Promise<unknown>;
  /** The host's start is under way: the buttons wait for it. */
  starting?: boolean;
  className?: string;
};

/** THE CALL'S CONTROLS: the row of buttons, and what went wrong under it, in one element a host may
 *  place (`data-slot="call-bar-words"`). */
export function CallControls({
  call,
  ui,
  live,
  member,
  start,
  starting = false,
  className,
}: CallControlsProps) {
  // this row's own press, from the start to the end of its join
  const [entering, setEntering] = useState(false);
  const busy = starting || entering || ui.joining;
  const shut = !ui.joined && !joinable(live);
  // nothing to press: no engine yet, or nobody knows yet whether the agent has a call
  const unknown = !call || (!ui.joined && !live && !start);
  const why = unknown
    ? "The call is not ready yet"
    : shut
      ? "This mind has no call service yet"
      : undefined;
  const othersInCall = !ui.joined && Object.keys(live?.inCall || {}).length > 0;
  const voiceHere = Boolean(live?.voiceAgent);

  /** In the call first, then `first`'s own act. A start that fails says why in the call's words. */
  const enter = async (first: First) => {
    if (!call) return;
    setEntering(true);
    try {
      const epoch = call.epoch;
      if (start) {
        try {
          await start();
        } catch (error) {
          call.fail(
            `The call could not start: ${error instanceof Error ? error.message : String(error)}`,
          );
          return;
        }
        // a Leave, or a page that went away, while the call came on: joining is the next press
        if (call.epoch !== epoch) return;
      }
      const joining = call.join({ listenOnly: first === "camera" || first === "screen" });
      // the camera and the screen go from the press itself: the screen's picker needs it, and the
      // call sends them once the join has its connection
      if (first === "camera") void call.toggleCamera();
      if (first === "screen") void call.toggleScreen();
      await joining;
      if (first === "voice" && call.ui.joined) void call.aiInvite();
    } finally {
      setEntering(false);
    }
  };
  const press = (first: First, inCall: () => unknown) => () => {
    if (ui.joined) void inCall();
    else void enter(first);
  };
  const waits = Boolean(why) || (!ui.joined && busy);
  const goIn = start ? "Start a call" : "Join the call";
  return (
    <div
      data-slot="call-bar"
      data-joined={ui.joined}
      className={cn("flex flex-col gap-2", className)}
    >
      <div className="flex items-center gap-1" aria-busy={busy || undefined}>
        <span className="relative inline-flex">
          <Switch
            label="Microphone"
            on={ui.joined && !ui.muted}
            tip={
              why ||
              (ui.joined
                ? ui.unmuting
                  ? "Unmuting…"
                  : ui.muted
                    ? "Unmute"
                    : "Mute"
                : othersInCall
                  ? "Join the call: others are in it"
                  : goIn)
            }
            disabled={waits || ui.unmuting}
            onClick={press("mic", () => call?.toggleMute())}
          >
            {ui.joined && ui.muted ? <MicOffIcon /> : <MicIcon />}
          </Switch>
          {othersInCall ? (
            <span
              data-slot="call-live-dot"
              aria-hidden
              className="pointer-events-none absolute top-0.5 right-0.5 size-1.5 rounded-full bg-success"
            />
          ) : null}
        </span>
        <Switch
          label="Camera"
          on={ui.camera}
          tip={
            why ||
            (ui.camera
              ? "Turn the camera off"
              : ui.joined
                ? "Share video"
                : `${goIn} with the camera`)
          }
          disabled={waits}
          onClick={press("camera", () => call?.toggleCamera())}
        >
          {ui.camera ? <VideoIcon /> : <VideoOffIcon />}
        </Switch>
        {canShareScreen() ? (
          <Switch
            label="Share screen"
            on={ui.screen}
            tip={
              why ||
              (ui.screen
                ? "Stop sharing the screen"
                : ui.joined
                  ? "Share the screen"
                  : `${goIn} and share the screen`)
            }
            disabled={waits}
            onClick={press("screen", () => call?.toggleScreen())}
          >
            {ui.screen ? <MonitorOffIcon /> : <MonitorUpIcon />}
          </Switch>
        ) : null}
        {member ? (
          <Switch
            label="Voice agent"
            on={voiceHere}
            tip={
              why ||
              (voiceHere
                ? ui.joined
                  ? "Send the voice agent away"
                  : "Join the call: a voice agent is in it"
                : ui.ai === "starting"
                  ? "The voice agent is coming…"
                  : ui.joined
                    ? "Add a voice agent"
                    : `${goIn} with a voice agent`)
            }
            disabled={waits || (ui.joined && !voiceHere && ui.ai !== "off")}
            className={voiceHere ? "border-success text-success" : undefined}
            onClick={() => {
              if (!ui.joined) void enter(voiceHere ? "mic" : "voice");
              else if (voiceHere) void call?.aiDismiss();
              else void call?.aiInvite();
            }}
          >
            {voiceHere ? <BotOffIcon /> : <BotIcon />}
          </Switch>
        ) : null}
        {ui.joined && call ? <CallDevices call={call} ui={ui} /> : null}
        {ui.joined && call ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="destructive"
                  aria-label="Leave the call"
                  onClick={() => void call.leave()}
                />
              }
            >
              <PhoneOffIcon />
            </TooltipTrigger>
            <TooltipContent>Leave the call</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      {call ? <CallWords call={call} ui={ui} /> : null}
    </div>
  );
}

/** Below `md` a header has no room for the row beside the path and the tabs. */
const NARROW = "(max-width: 47.99rem)";
function watchNarrow(changed: () => void) {
  const query = matchMedia(NARROW);
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
}

/** THE CALL'S CONTROLS IN A HEADER: the row on a wide screen, behind one button on a phone. The
 *  button says when the page is in the call, and marks an error that the closed row holds. */
export function CallHeaderControls(props: CallControlsProps) {
  const narrow = useSyncExternalStore(
    watchNarrow,
    () => matchMedia(NARROW).matches,
    () => false,
  );
  if (!narrow) return <CallControls {...props} />;
  const { ui } = props;
  const wrong = Boolean(ui.error || ui.aiRefusal);
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              nativeButton
              data-joined={ui.joined}
              render={
                <Button
                  size="icon-sm"
                  variant={ui.joined ? "secondary" : "ghost"}
                  aria-label={
                    ui.joined
                      ? `Call: you are in it${wrong ? ", and an error" : ""}`
                      : wrong
                        ? "Call: an error"
                        : "Call"
                  }
                  className="relative"
                />
              }
            />
          }
        >
          <PhoneIcon />
          {wrong ? (
            <span className="absolute top-0.5 right-0.5 size-2 rounded-full bg-destructive" />
          ) : null}
        </TooltipTrigger>
        <TooltipContent>{ui.joined ? "The call: you are in it" : "Call"}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-auto max-w-[calc(100vw-2rem)]">
        <CallControls {...props} className={undefined} />
      </PopoverContent>
    </Popover>
  );
}

/** A page with no engine yet: out of the call, nothing on. */
const WAITING: CallUi = {
  joined: false,
  joining: false,
  muted: false,
  unmuting: false,
  camera: false,
  screen: false,
  net: "",
  notice: "",
  error: "",
  repair: "",
  ai: "off",
  aiRefusal: null,
  devices: {
    mic: [],
    camera: [],
    speaker: [],
    chosen: { mic: "", camera: "", speaker: "" },
    speakerSupported: true,
  },
  videos: [],
  captions: { status: "off", text: "" },
};

/** THE CALL'S CONTROLS BEFORE THE CALL'S PART HAS LOADED: the same buttons in the same place, which
 *  cannot be pressed yet. A header draws it at its first paint, so nothing moves when the call
 *  comes. */
export function CallHeaderWaiting({ member }: { member: boolean }) {
  return <CallHeaderControls call={null} ui={WAITING} live={undefined} member={member} />;
}

/** The browser can share a screen. */
const canShareScreen = () => Boolean(navigator.mediaDevices?.getDisplayMedia);

/** One of the call's switches: an icon, a fixed name for a screen reader, and whether it is on. The
 *  name never changes with the state: `aria-pressed` says it. Its tooltip (`tip`) says what a press
 *  does; a switch that cannot be pressed keeps its focus and its tooltip, which says why. */
function Switch({
  label,
  on,
  tip,
  disabled,
  className,
  onClick,
  children,
}: {
  label: string;
  on: boolean;
  tip: string;
  disabled: boolean;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="icon-sm"
            variant={on ? "default" : "outline"}
            aria-label={label}
            aria-pressed={on}
            disabled={disabled}
            focusableWhenDisabled
            className={cn("aria-disabled:opacity-50", className)}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

/** What went wrong, in words, in one element a host may place: the call's error (a start or a
 *  join that failed), and why the voice agent did not come. */
export function CallWords({ call, ui }: { call: CallEngine; ui: CallUi }) {
  if (!ui.error && !ui.aiRefusal) return null;
  return (
    <div data-slot="call-bar-words" className="flex flex-col gap-1">
      {ui.error ? <Said text={ui.error} onClose={() => call.dismiss()} /> : null}
      {ui.aiRefusal ? (
        <Said text={<VoiceRefusalText refusal={ui.aiRefusal} />} onClose={() => call.dismiss()} />
      ) : null}
    </div>
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
function VoiceRefusalText({ refusal }: { refusal: VoiceRefusal }) {
  if (refusal.credit)
    return (
      <>
        The mind&apos;s voice credit at iterate Cloud is spent. Two ways to pay: connect your
        ChatGPT plan in iterate Cloud, or save your own OpenAI key as /secrets/openai on the
        Dash&apos;s Secrets page.
      </>
    );
  if (refusal.noKey)
    return (
      <>
        This mind has no OpenAI key for the voice agent yet. iterate Cloud gives one with its
        credit, or save your own as /secrets/openai on the Dash&apos;s Secrets page.
      </>
    );
  return <>{refusal.message}</>;
}

const PICKERS: [DeviceKind, string][] = [
  ["mic", "Microphone"],
  ["camera", "Camera"],
  ["speaker", "Speaker"],
];

/** The microphone, the camera and the speaker, each a picker; the browser lists them when the
 *  pickers open. */
export function CallDevices({ call, ui }: { call: CallEngine; ui: CallUi }) {
  return (
    <Popover onOpenChange={(open) => open && void call.listDevices()}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              nativeButton
              render={<Button size="icon-sm" variant="ghost" aria-label="Devices" />}
            />
          }
        >
          <Settings2Icon />
        </TooltipTrigger>
        <TooltipContent>The microphone, camera and speaker</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="flex w-72 flex-col gap-3">
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
