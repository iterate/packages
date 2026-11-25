// call-controls.tsx — THE CALL'S CONTROLS IN A HEADER. Out of the call, one button: "Start call"
// when nobody is in the agent's call, "Join call" when someone is. In the call, the microphone, the
// camera, the screen, the voice agent (a member's alone) and the devices are icon buttons in one
// shadcn button group that does not wrap, and Leave stands apart after it, in red. The Dash's agent
// page and Meet draw the same controls.
//
// - ONE PRESS GOES IN: Start or Join turns the call on when the agent has none (`start`), and joins
//   with the microphone open. A microphone that the browser refuses does not keep the person out:
//   the page joins listening, and says why. The camera, the screen and the voice agent are the
//   call's own controls: they come once the page is in it.
// - THE BUTTON IS THERE FROM THE FIRST PAINT: with no engine yet, or while nobody knows whether the
//   agent has a call, it is drawn and cannot be pressed. So the header does not move when the call
//   comes.
// - EACH BUTTON HAS ONE NAME for a screen reader (`aria-label`); a switch's `aria-pressed` says
//   whether it is on. Its tooltip says what a press does, or why it cannot be pressed.
// - WHAT GOES WRONG is said in words under the buttons, from the engine's state, so a row drawn
//   again still says it: a start that failed, a join that failed, a voice agent that did not come.
//   In a header (`CallHeaderControls`) the words stand over the page below it: the row keeps its
//   height.
// - A SWITCH SAYS ON BY ITS FILL. The microphone and the camera are struck through when off, as in
//   every call app; the screen and the voice agent keep one icon.
// - A MEMBER'S MAC: with a Mac lent by the member (the iterate Mac app), the devices' Camera picker
//   lists its camera too, and a Screen picker lists its screens; a choice asks the Mac to send it
//   (call-engine.ts `chooseMac`). Without one, the pickers are as before.
// - ON A PHONE (`CallHeaderControls`) Start or Join is its icon alone, and in the call the controls
//   are behind one button, so the path and the tabs keep the header.
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import {
  BotIcon,
  MicIcon,
  MicOffIcon,
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
import { ButtonGroup } from "#/components/ui/button-group.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip.tsx";

export type CallControlsProps = {
  /** What `useCall` answers. `call` is null until the page has a context and its row: the button
   *  is then drawn and cannot be pressed. */
  call: CallEngine | null;
  ui: CallUi;
  live: CallLive | undefined;
  /** The viewer is a member of the mind: a guest gets no voice agent. */
  member: boolean;
  /** Turns the call on, for an agent that has none yet (`live` is undefined). A press then turns it
   *  on, and joins. Without it and without `live`, nobody knows yet whether there is a call. */
  start?: () => Promise<unknown>;
  /** The host's start is under way: the button waits for it. */
  starting?: boolean;
  className?: string;
};

/** THE CALL'S CONTROLS: Start or Join out of the call, the button group and Leave in it, and what
 *  went wrong under them, in one element a host may place (`data-slot="call-bar-words"`). */
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
  // a press of Start, Join or Leave in this row moves the focus to the row's first button after it:
  // the button that was pressed is gone then
  const row = useRef<HTMLDivElement>(null);
  const keepFocus = useRef(false);
  const joined = ui.joined && Boolean(call);
  useLayoutEffect(() => {
    if (!keepFocus.current) return;
    keepFocus.current = false;
    row.current?.querySelector("button")?.focus();
  }, [joined]);

  /** In the call: the call on first when the agent has none, then the join with the microphone. A
   *  start that fails says why in the call's words. */
  const enter = async () => {
    if (!call) return;
    keepFocus.current = true;
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
      await call.join({ orListen: true });
    } finally {
      setEntering(false);
    }
  };
  const words = call ? <CallWords call={call} ui={ui} /> : null;
  if (!joined || !call)
    return (
      <div
        data-slot="call-bar"
        data-joined={false}
        className={cn("flex flex-col gap-2", className)}
      >
        <div ref={row} className="flex items-center">
          <GoIn
            ready={Boolean(call)}
            live={live}
            start={start}
            busy={starting || entering || ui.joining}
            onClick={() => void enter()}
          />
        </div>
        {words}
      </div>
    );
  const voiceHere = Boolean(live?.voiceAgent);
  return (
    <div data-slot="call-bar" data-joined className={cn("flex flex-col gap-2", className)}>
      <div ref={row} className="flex items-center gap-1">
        <ButtonGroup aria-label="The call">
          <Switch
            label="Microphone"
            on={!ui.muted}
            tip={ui.unmuting ? "Unmuting…" : ui.muted ? "Unmute" : "Mute"}
            disabled={ui.unmuting}
            onClick={() => void call.toggleMute()}
          >
            {ui.muted ? <MicOffIcon /> : <MicIcon />}
          </Switch>
          <Switch
            label="Camera"
            on={ui.camera}
            tip={ui.camera ? "Turn the camera off" : "Share video"}
            onClick={() => void call.toggleCamera()}
          >
            {ui.camera ? <VideoIcon /> : <VideoOffIcon />}
          </Switch>
          {canShareScreen() ? (
            <Switch
              label="Share screen"
              on={ui.screen}
              tip={ui.screen ? "Stop sharing the screen" : "Share the screen"}
              onClick={() => void call.toggleScreen()}
            >
              <MonitorUpIcon />
            </Switch>
          ) : null}
          {member ? (
            <Switch
              label="Voice agent"
              on={voiceHere}
              tip={
                voiceHere
                  ? "Send the voice agent away"
                  : ui.ai === "starting"
                    ? "The voice agent is coming…"
                    : "Add a voice agent"
              }
              disabled={!voiceHere && ui.ai !== "off"}
              onClick={() => void (voiceHere ? call.aiDismiss() : call.aiInvite())}
            >
              <BotIcon />
            </Switch>
          ) : null}
          <CallDevices call={call} ui={ui} variant="outline" />
        </ButtonGroup>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon-sm"
                variant="destructive"
                aria-label="Leave the call"
                onClick={() => {
                  keepFocus.current = true;
                  void call.leave();
                }}
              />
            }
          >
            <PhoneOffIcon />
          </TooltipTrigger>
          <TooltipContent>Leave the call</TooltipContent>
        </Tooltip>
      </div>
      {words}
    </div>
  );
}

/** START OR JOIN, the one button out of the call: "Start call" when nobody is in the call, "Join
 *  call" and how many are in it when someone is. Below `md` it is its icon (and the count) alone;
 *  its name and its tooltip say the words. While a start or a join is under way it waits, with a
 *  spinner. */
function GoIn({
  ready,
  live,
  start,
  busy,
  onClick,
}: {
  /** The page has its engine. */
  ready: boolean;
  live: CallLive | undefined;
  start: (() => Promise<unknown>) | undefined;
  busy: boolean;
  onClick: () => void;
}) {
  const inCall = Object.keys(live?.inCall || {}).length;
  // nothing to press: no engine yet, or nobody knows yet whether the agent has a call
  const why =
    !ready || (!live && !start)
      ? "The call is not ready yet"
      : joinable(live)
        ? undefined
        : "This mind has no call service yet";
  const word = inCall ? "Join call" : "Start call";
  const people = inCall === 1 ? "1 person is" : `${inCall} people are`;
  const tip =
    why ||
    (busy
      ? `${inCall ? "Joining" : "Starting"} the call…`
      : inCall
        ? `Join the call: ${people} in it`
        : "Start a call");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            data-slot="call-go-in"
            size="sm"
            variant={inCall ? "default" : "outline"}
            aria-label={inCall ? `Join call: ${people} in it` : word}
            aria-busy={busy || undefined}
            disabled={Boolean(why) || busy}
            focusableWhenDisabled
            className="aria-disabled:opacity-50"
            onClick={onClick}
          />
        }
      >
        {busy ? (
          <Spinner data-icon="inline-start" aria-hidden />
        ) : (
          <PhoneIcon data-icon="inline-start" />
        )}
        <span className="hidden md:inline">{word}</span>
        {inCall ? (
          <span data-slot="call-count" aria-hidden className="tabular-nums">
            {inCall}
          </span>
        ) : null}
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

/** Below `md` a header has no room for the row beside the path and the tabs. */
const NARROW = "(max-width: 47.99rem)";
function watchNarrow(changed: () => void) {
  const query = matchMedia(NARROW);
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
}

/** In a header's row, of one height, what went wrong stands over the page below it, so the row
 *  does not grow. */
const WORDS_OVER_THE_PAGE =
  "relative items-end *:data-[slot=call-bar-words]:absolute *:data-[slot=call-bar-words]:top-full *:data-[slot=call-bar-words]:right-0 *:data-[slot=call-bar-words]:z-20 *:data-[slot=call-bar-words]:mt-1 *:data-[slot=call-bar-words]:w-80 *:data-[slot=call-bar-words]:*:shadow-md";

/** THE CALL'S CONTROLS IN A HEADER: as they are on a wide screen, and out of the call, with what
 *  went wrong over the page below the header. On a phone in the call they are behind one button,
 *  which marks an error that the closed row holds. */
export function CallHeaderControls(props: CallControlsProps) {
  const narrow = useSyncExternalStore(
    watchNarrow,
    () => matchMedia(NARROW).matches,
    () => false,
  );
  const { ui } = props;
  if (!narrow || !ui.joined || !props.call)
    return <CallControls {...props} className={cn(WORDS_OVER_THE_PAGE, props.className)} />;
  const wrong = Boolean(ui.error || ui.aiRefusal);
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              nativeButton
              data-joined
              render={
                <Button
                  size="icon-sm"
                  variant="secondary"
                  aria-label={`Call: you are in it${wrong ? ", and an error" : ""}`}
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
        <TooltipContent>The call: you are in it</TooltipContent>
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

/** THE CALL'S CONTROLS BEFORE THE CALL'S PART HAS LOADED: Start call in the same place, which
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
  disabled = false,
  className,
  onClick,
  children,
}: {
  label: string;
  on: boolean;
  tip: string;
  disabled?: boolean;
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
            className={cn("relative aria-disabled:opacity-50", className)}
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
 *  pickers open, and the member's lent Macs add their cameras and screens (a Screen picker comes
 *  only with a Mac's screen). */
export function CallDevices({
  call,
  ui,
  variant = "ghost",
}: {
  call: CallEngine;
  ui: CallUi;
  /** The button's look: "outline" in the call's button group. */
  variant?: "ghost" | "outline";
}) {
  const mac = ui.devices.mac;
  return (
    <Popover onOpenChange={(open) => open && void call.listDevices({ macs: true })}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              nativeButton
              render={<Button size="icon-sm" variant={variant} aria-label="Devices" />}
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
                value={(kind === "camera" && mac?.chosen.camera) || ui.devices.chosen[kind]}
                onChange={(event) => void call.chooseDevice(kind, event.target.value)}
              >
                {[...ui.devices[kind], ...(kind === "camera" ? mac?.camera || [] : [])].map(
                  (option) => (
                    <NativeSelectOption key={option.id} value={option.id}>
                      {option.label}
                    </NativeSelectOption>
                  ),
                )}
              </NativeSelect>
            </label>
          ),
        )}
        {mac?.screen.length ? (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Screen
            <NativeSelect
              value={mac.chosen.screen}
              onChange={(event) => void call.chooseMac("screen", event.target.value)}
            >
              <NativeSelectOption value="">Shared from this browser</NativeSelectOption>
              {mac.screen.map((option) => (
                <NativeSelectOption key={option.id} value={option.id}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        ) : null}
        {mac?.asking ? (
          <p role="status" className="text-xs text-muted-foreground">
            Asking your Mac: {mac.asking}…
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
