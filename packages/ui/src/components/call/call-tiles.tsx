// call-tiles.tsx — WHAT THE CALL SHOWS beside the chat: every camera and screen in it, this page's
// own first, and what the call says as it runs, in words: what the mind has not set up yet, the
// voice agent and its host, a repair, a notice, and the path each connection takes. A click on a
// tile makes it large, and small again; a remote camera then takes the simulcast layer that fits it.
// A screen reader hears who comes into the call and who leaves it, from one polite region that is
// always there.
import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import type { CallEngine, CallUi, CallVideo } from "#/lib/call-engine.ts";
import { callChanges, joinable, type CallLive } from "#/lib/call-rules.ts";
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
    ui.videos.length || setup || agent || ui.repair || ui.notice || ui.joined,
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
      {ui.videos.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
          {ui.videos.map((video) => (
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
