// call-tiles.tsx — WHAT THE CALL SHOWS beside the chat: every camera and screen in it, this page's
// own first, and what the call says as it runs, in words: what the mind has not set up yet, the
// voice agent and its host, a repair, a notice, and the path each connection takes. A click on a
// tile makes it large, and small again; a remote camera then takes the simulcast layer that fits it.
// A screen reader hears who comes into the call and who leaves it, from one polite region that is
// always there.
//
// THE DRIVEN DEVICE comes first and large (`DriveTile`): a Mac's screen in the call, or a Chrome
// tab's screenshot. Pointer, wheel and keys over it go to the device (call-engine.ts `driveInput`):
// a key goes while the picture has the focus (a click gives it), and the driver's paste (⌘V or
// Ctrl+V) puts the driver's clipboard text into the device.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "cn";
import type { CallEngine, CallUi, CallVideo, DriveUi } from "#/lib/call-engine.ts";
import {
  callChanges,
  joinable,
  keyEvents,
  modsOf,
  pictureRect,
  pointOn,
  type CallLive,
  type DriveEvent,
} from "#/lib/call-rules.ts";
import { Button } from "#/components/ui/button.tsx";

/** What the mind does not have yet, plainly: the rest works without it. A member is told which
 *  secret is missing; a guest is not. */
function setupNote(setup: CallLive["setup"], member: boolean) {
  if (!setup) return "";
  if (!setup.sfu)
    return member
      ? "This mind has no Cloudflare Realtime SFU app yet (the secret /secrets/cloudflare-realtime-sfu), so the call cannot start. The chat works."
      : "The call cannot start here yet. The chat works.";
  if (!setup.turn && member)
    return "This mind has no TURN key yet (/secrets/cloudflare-turn): a network that blocks UDP cannot join the call.";
  return "";
}

/** `call`, `ui`, `live`: what `useCall` answers. `member`: the viewer is a member of the mind. Draws
 *  nothing to see when the call has nothing to show; what the mind has not set up shows while a
 *  call goes on, or when it keeps Join shut. Its region for a screen reader is always there. */
export function CallTiles({
  call,
  ui,
  live,
  member,
  className,
}: {
  call: CallEngine | null;
  ui: CallUi;
  live: CallLive | undefined;
  member: boolean;
  className?: string;
}) {
  const going = ui.joined || Object.keys(live?.inCall || {}).length > 0;
  const setup = going || !joinable(live) ? setupNote(live?.setup || null, member) : "";
  const agent = live?.voiceAgent || null;
  // a node that mounts with its words is often not read: the words go into one that stays. They
  // compare two live states the page knows: a read that did not come says nothing of who is here
  const said = useRef<HTMLParagraphElement>(null);
  const known = useRef(live);
  useEffect(() => {
    if (!live) return;
    const before = known.current;
    known.current = live;
    const lines = before ? callChanges(before, live) : [];
    if (lines.length && said.current) said.current.textContent = lines.join(" ");
  }, [live]);
  const something = Boolean(
    ui.videos.length || setup || agent || ui.repair || ui.notice || ui.joined || ui.drive?.driving,
  );
  return (
    <>
      <p ref={said} aria-live="polite" className="sr-only" />
      {call && something ? (
        <Tiles call={call} ui={ui} setup={setup} agent={agent} className={className} />
      ) : null}
    </>
  );
}

/** What there is to see: the notes, the notice, the tiles and the path. */
function Tiles({
  call,
  ui,
  setup,
  agent,
  className,
}: {
  call: CallEngine;
  ui: CallUi;
  setup: string;
  agent: CallLive["voiceAgent"];
  className: string | undefined;
}) {
  const until = agent
    ? new Date(agent.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : "";
  const notes = [
    setup,
    agent
      ? `The voice agent is in the call, ${ui.ai === "off" ? `hosted by ${agent.host.name}` : "hosted by this tab: it leaves when you leave"}. Everyone hears it, and it hears everyone. It leaves by ${until} at the latest.`
      : "",
    ui.repair,
    // the captions, when they are not working: off for a reason, or failing
    ui.captions.status === "error" || ui.captions.status === "off" ? ui.captions.text : "",
  ].filter(Boolean);
  return (
    <section data-slot="call-tiles" className={cn("flex flex-col gap-2", className)}>
      {notes.map((note) => (
        <p key={note} role="status" className="text-xs text-muted-foreground">
          {note}
        </p>
      ))}
      {ui.notice ? (
        <p role="status" className="flex items-start justify-between gap-2 text-xs">
          <span>{ui.notice}</span>
          <Button size="xs" variant="ghost" onClick={() => call.dismiss()}>
            Close
          </Button>
        </p>
      ) : null}
      {ui.drive?.driving ? (
        <DriveTile
          call={call}
          driving={ui.drive.driving}
          video={ui.videos.find((one) => one.track && one.track === ui.drive?.driving?.track)}
        />
      ) : null}
      {ui.videos.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
          {ui.videos
            .filter((video) => !video.track || video.track !== ui.drive?.driving?.track)
            .map((video) => (
              <Tile key={video.key} call={call} video={video} />
            ))}
        </div>
      ) : null}
      {ui.joined ? (
        // one line whatever its length: the feed under it does not move as the round trips change
        <p
          className="truncate text-xs text-muted-foreground"
          title={`The path each connection takes to Cloudflare: ${ui.net || "Connecting…"}`}
        >
          {ui.net || "Connecting…"}
        </p>
      ) : null}
    </section>
  );
}

/** One camera or screen. A remote camera tells the call its width, so it takes the layer that fits. */
function Tile({ call, video }: { call: CallEngine; video: CallVideo }) {
  const element = useRef<HTMLVideoElement>(null);
  const [big, setBig] = useState(false);
  const { stream, track, local } = video;
  useEffect(() => {
    const node = element.current;
    if (!node) return;
    node.srcObject = stream;
    node.play().catch(() => {});
    if (local) return;
    const seen = new ResizeObserver(() =>
      call.tileWidth(track, node.getBoundingClientRect().width),
    );
    seen.observe(node);
    return () => seen.disconnect();
  }, [call, stream, track, local]);
  return (
    <figure
      data-big={big}
      className={cn("relative m-0 overflow-hidden rounded-lg bg-muted", big && "col-span-full")}
    >
      <button
        type="button"
        className="block w-full"
        aria-label={`${video.name}'s ${video.kind}, large`}
        aria-pressed={big}
        title={big ? "Make it small" : "Make it large"}
        onClick={() => setBig((was) => !was)}
      >
        <video
          ref={element}
          autoPlay
          playsInline
          muted
          className={cn(
            "aspect-video w-full",
            video.kind === "screen" ? "object-contain" : "object-cover",
          )}
        />
      </button>
      <figcaption className="absolute bottom-1 left-1 rounded bg-background/80 px-1.5 text-xs">
        {video.name}: {video.kind}
      </figcaption>
    </figure>
  );
}

/** A key event's own fields (a spread copies none: they are the prototype's getters). */
const keyOf = (event: KeyboardEvent, type: "keydown" | "keyup") => ({
  type,
  code: event.code,
  key: event.key,
  shiftKey: event.shiftKey,
  ctrlKey: event.ctrlKey,
  altKey: event.altKey,
  metaKey: event.metaKey,
  isComposing: event.isComposing,
});

/** WHAT IS DRIVEN, large, with its input: the picture (the Mac's screen in the call, or the tab's
 *  screenshot), and over it a surface that takes the pointer, the wheel and the keys. A hidden text
 *  box holds the focus, so that the keys and a paste come to it and not to the page. */
function DriveTile({
  call,
  driving,
  video,
}: {
  call: CallEngine;
  driving: NonNullable<DriveUi["driving"]>;
  video: CallVideo | undefined;
}) {
  const movie = useRef<HTMLVideoElement>(null);
  const still = useRef<HTMLImageElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const keys = useRef<HTMLTextAreaElement>(null);
  const held = useRef(false);
  const stream = video?.stream;
  useEffect(() => {
    const node = movie.current;
    if (!node || !stream) return;
    node.srcObject = stream;
    node.play().catch(() => {});
  }, [stream]);
  /** A point of the page as 0–1 on the picture, as the picture is drawn in its box. */
  const at = (event: { clientX: number; clientY: number }) => {
    const video = movie.current;
    const image = still.current;
    const node = video || image;
    if (!node) return null;
    const [width, height] = video
      ? [video.videoWidth, video.videoHeight]
      : [image!.naturalWidth, image!.naturalHeight];
    return pointOn(
      pictureRect(node.getBoundingClientRect(), width, height),
      event.clientX,
      event.clientY,
    );
  };
  const send = (events: DriveEvent[]) => call.driveInput(events);
  // the wheel is taken from the page, which a passive listener cannot do
  useEffect(() => {
    const node = surface.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = at(event);
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      send([
        {
          t: "scroll",
          dx: Math.round(event.deltaX * scale),
          dy: Math.round(event.deltaY * scale),
          ...(point && { x: point.x, y: point.y }),
        },
      ]);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  });
  const press = (event: ReactPointerEvent, down: boolean) => {
    const point = at(event);
    if (!point || (down && !point.inside)) return;
    event.preventDefault();
    if (down) {
      keys.current?.focus({ preventScroll: true });
      surface.current?.setPointerCapture(event.pointerId);
    }
    held.current = down;
    const mods = modsOf(event, driving.ctrlIsCommand);
    send([
      {
        t: down ? "down" : "up",
        x: point.x,
        y: point.y,
        button: (event.button === 1 ? 1 : event.button === 2 ? 2 : 0) as 0 | 1 | 2,
        clicks: Math.min(3, Math.max(1, event.detail || 1)),
        ...(mods.length > 0 && { mods }),
      },
    ]);
  };
  const where = driving.direct ? "straight to the Mac" : "through the mind";
  return (
    <figure data-slot="call-drive" className="relative m-0 flex flex-col gap-1">
      <figcaption className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate">
          You drive {driving.label}
          {driving.rttMs !== null ? ` · ${Math.round(driving.rttMs)} ms ${where}` : ""}
          {driving.paused ? " · paused: its owner uses it" : ""}
        </span>
        <span className="flex shrink-0 gap-1">
          <Button
            size="xs"
            variant="ghost"
            title="Put your clipboard's text into it"
            onClick={() =>
              void navigator.clipboard
                ?.readText()
                .then((text) => call.drivePaste(text))
                .catch(() => {})
            }
          >
            Paste
          </Button>
          <Button size="xs" variant="destructive" onClick={() => void call.stopDrive()}>
            Stop driving
          </Button>
        </span>
      </figcaption>
      <div
        ref={surface}
        className="relative overflow-hidden rounded-lg bg-muted outline-none focus-within:ring-2 focus-within:ring-ring"
        style={{ touchAction: "none", cursor: "default" }}
        onPointerDown={(event) => press(event, true)}
        onPointerUp={(event) => held.current && press(event, false)}
        onPointerMove={(event) => {
          const point = at(event);
          if (point && (point.inside || held.current))
            send([{ t: "move", x: point.x, y: point.y }]);
        }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {driving.kind === "mac" ? (
          <video
            ref={movie}
            autoPlay
            playsInline
            muted
            className="aspect-video w-full object-contain"
          />
        ) : driving.shot ? (
          <img
            ref={still}
            src={driving.shot}
            alt=""
            className="aspect-video w-full object-contain"
          />
        ) : null}
        {(driving.kind === "mac" && !stream) || (driving.kind === "browser" && !driving.shot) ? (
          <p className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
            Waiting for the picture of {driving.label}…
          </p>
        ) : null}
        <textarea
          ref={keys}
          aria-label={`Keys to ${driving.label}`}
          className="absolute size-px opacity-0"
          onKeyDown={(event) => {
            // a paste is the driver's clipboard: the paste event below carries it
            if ((event.metaKey || event.ctrlKey) && event.code === "KeyV") return;
            event.preventDefault();
            send(keyEvents(keyOf(event.nativeEvent, "keydown"), driving.ctrlIsCommand));
          }}
          onKeyUp={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.code === "KeyV") return;
            event.preventDefault();
            send(keyEvents(keyOf(event.nativeEvent, "keyup"), driving.ctrlIsCommand));
          }}
          onPaste={(event) => {
            event.preventDefault();
            void call.drivePaste(event.clipboardData.getData("text/plain"));
          }}
        />
      </div>
      {driving.note ? (
        <p role="status" className="text-xs text-muted-foreground">
          {driving.note}
        </p>
      ) : null}
    </figure>
  );
}
