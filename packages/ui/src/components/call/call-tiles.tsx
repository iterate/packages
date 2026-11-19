// call-tiles.tsx — WHAT THE CALL SHOWS beside the chat: every camera and screen in it, this page's
// own first, and what the call says as it runs, in words: what the mind has not set up yet, the
// voice agent and its host, a repair, a notice, and the path each connection takes. A click on a
// tile makes it large, and small again; a remote camera then takes the simulcast layer that fits it.
import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import type { CallEngine, CallUi, CallVideo } from "#/lib/call-engine.ts";
import type { CallLive } from "#/lib/call-rules.ts";
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
 *  nothing when the call has nothing to show. */
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
  const setup = setupNote(live?.setup || null, member);
  const agent = live?.voiceAgent;
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
  if (!call || (!ui.videos.length && !notes.length && !ui.notice && !ui.joined)) return null;
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
        <p
          className="text-xs text-muted-foreground"
          title="The path each connection takes to Cloudflare"
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
        aria-label={
          big
            ? `Make ${video.name}'s ${video.kind} small`
            : `Make ${video.name}'s ${video.kind} large`
        }
        onClick={() => setBig(!big)}
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
