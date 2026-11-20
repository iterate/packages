// dash-call.tsx — A CALL ON AN AGENT IN THE DASH: its controls in the agent page's header, and its
// cameras and screens over the feed while a call is live. The Agents page loads this module, beside
// the chat's part, only where its row turns calls on (`DashPage["call"]`).
//
// - THE CALL is a facet on the agent's context, the processor row `call` (a mind's config:
//   `call.ts`). Its live state comes with the chat's own: `AgentChat.contextOptions` names no
//   `liveState`, so the chat's hook opens each facet the processors table has, `call` once its row
//   is there. A context with no call opens nothing for it, and shows no error.
// - THE PAGE is its own row on the context (`context.subscription`), which the call knows it by.
// - BEFORE A CALL: "Start a call", once the table is read and has no `call` row. Its press opens
//   the lobby; the lobby's "Start the call" turns the call on (`DashCall.enable`, with the config's
//   spec) and joins with what the lobby has on.
// - THE LOBBY (`CallLobby`, in a dialog) comes before every join: Join and Start open it, with the
//   microphone on (a press of the person's opened it), and the camera off. There the person checks
//   their camera and their sound, chooses the devices, sees who is in the call, and joins with
//   what is on, or muted. The tracks it opened go to the call as they are.
// - THE HEADER draws the call as this page knows it: while its own start runs and the page is not
//   in the call yet, "Starting…" alone (`starting`, held here, so a bar drawn again keeps it); in
//   the call, the joined bar, with or without the live state; else the call's live state, or, once
//   the call is on (its row), a call whose live state has not come yet. So a start goes Start →
//   Starting… → the joined bar, with no Join between and no empty header, whichever comes first:
//   the live state or the join's end. Mute and Leave show as soon as the page is in the call.
// - ON A PHONE the bar is behind one button in the header, so the path and the tabs keep the row.
//   The button says when the page is in the call, and marks an error the closed bar holds.
// - THE TILES are always there over the feed: they draw what the call has to show, and their
//   region for a screen reader stays, so it hears the first arrival and the last departure.
// - A START belongs to the engine it began with: one whose engine changed (a new row) or whose
//   page went away does not join.
// - JOIN ON ARRIVAL (`joinOnArrival`: the Dash's `call=join`, the page a Mac's Accept opens): once
//   the table is read, the page opens the lobby, once, and joins nothing. ANYONE CAN SEND A MEMBER
//   SUCH A LINK (a guest on a share link of the agent can), so it is no press of the person's: this
//   lobby opens no microphone and no camera by itself. `arrived` then takes the key out of the
//   address, so a reload does not open it again.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { PhoneIcon } from "lucide-react";
import { CallBar } from "#/components/call/call-bar.tsx";
import { CallLobby, type LobbyMedia } from "#/components/call/call-lobby.tsx";
import { CallTiles } from "#/components/call/call-tiles.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import { useCall, type CallContext, type CallEngine, type CallUi } from "#/lib/call-engine.ts";
import type { CallLive } from "#/lib/call-rules.ts";

/** THE CALL OF ONE AGENT'S PAGE. `stub` is the agent's context as the page holds it; `context` is
 *  what the chat's hook reads of it; `barIn` is the header's place for the controls. Draws the
 *  tiles where it stands. */
export function AgentCall({
  stub,
  context,
  enable,
  barIn,
  joinOnArrival = false,
  arrived,
}: {
  stub: CallContext | undefined;
  context: {
    subscription?: string;
    processors: { rows: readonly { hostedFacet?: { name: string } }[]; loaded: boolean };
    liveState: Readonly<Record<string, { value: unknown }>>;
  };
  /** Turns the call on for this agent. */
  enable: () => Promise<unknown>;
  barIn: HTMLElement | null;
  /** The page was opened to join: it opens the lobby once the table is read. */
  joinOnArrival?: boolean;
  /** The join on arrival began: the host takes its key out of the address. */
  arrived?: () => void;
}) {
  const { call, ui, live } = useCall(stub, context.subscription, context.liveState.call?.value);
  // this page's own start, in flight: the header shows it alone, never a Join beside it, until the
  // page is in the call. From then the bar's own buttons stand, also after a Leave that comes
  // before the join has ended.
  // which engine's call, and which of its calls (`epoch`): a dispose (pagehide), a Leave or a new
  // row ends the start, and a new row shows no "Starting…" of an old one
  const [startedIn, setStartedIn] = useState<{ call: CallEngine; epoch: number } | null>(null);
  const starting = Boolean(call && startedIn?.call === call && startedIn.epoch === call.epoch);
  // this page turned the call on: Join from now on, even when its join failed before the table or
  // the live state said so; a second start would turn on a call that is on
  const [enabled, setEnabled] = useState(false);
  const facetOn = context.processors.rows.some((row) => row.hostedFacet?.name === "call");
  const barLive = live || (facetOn || enabled ? NOT_READ_YET : undefined);
  // the engine this page holds now; none once the page went away
  const heldCall = useRef(call);
  useEffect(() => {
    heldCall.current = call;
    return () => {
      heldCall.current = null;
    };
  }, [call]);
  // the lobby, while it is open: `micAtStart` when a press of the person's opened it
  const [lobby, setLobby] = useState<{ micAtStart: boolean } | null>(null);
  // nothing before the table is read: an agent with a call shows Join, never a start first
  const start =
    call && !barLive && context.processors.loaded
      ? async ({ mic, camera }: LobbyMedia) => {
          const token = { call, epoch: call.epoch };
          setStartedIn(token);
          const done = () => setStartedIn((now) => (now === token ? null : now));
          const inTheCall = call.subscribe((ui) => {
            if (ui.joined) done();
          });
          try {
            await enable();
            setEnabled(true);
            // the page went away, or its call was closed (a pagehide, a Leave), while the call was
            // turned on: joining is the person's next press
            if (heldCall.current !== call || call.epoch !== token.epoch) {
              for (const track of [...(mic?.getTracks() || []), ...(camera?.getTracks() || [])])
                track.stop();
              return;
            }
            await call.join({ mic, camera, listenOnly: !mic });
          } finally {
            inTheCall();
            done();
          }
        }
      : undefined;
  // the lobby on arrival, once, with nothing open. What it does is this render's (`arrive`, set
  // after each render); when it runs is the table's first read.
  const arrival = useRef(joinOnArrival);
  const arrive = useRef(() => {});
  useEffect(() => {
    arrive.current = () => {
      if (!call) return;
      arrived?.();
      if (!ui.joined && !ui.joining) setLobby({ micAtStart: false });
    };
  });
  // the lobby's Join now (or Start the call): the call takes what it opened
  const fromLobby = (media: LobbyMedia) => {
    setLobby(null);
    if (!call) return;
    if (start)
      start(media).catch((error: unknown) =>
        call.fail(
          `The call could not start: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    else void call.join({ ...media, listenOnly: !media.mic });
  };
  const openLobby = () => setLobby({ micAtStart: true });
  useEffect(() => {
    if (!arrival.current || !call || !context.processors.loaded) return;
    arrival.current = false;
    arrive.current();
  }, [call, context.processors.loaded]);
  return (
    <>
      {barIn
        ? createPortal(
            <CallControls
              call={call}
              ui={ui}
              live={barLive}
              start={start ? async () => openLobby() : undefined}
              starting={starting}
              join={openLobby}
            />,
            barIn,
          )
        : null}
      <Dialog open={Boolean(lobby)} onOpenChange={(open) => !open && setLobby(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{start ? "Start a call" : "Join the call"}</DialogTitle>
            <DialogDescription>
              Check your camera and your sound first. Nothing is sent until you join.
            </DialogDescription>
          </DialogHeader>
          {lobby ? (
            <CallLobby
              live={live}
              action={start ? "start" : "join"}
              micAtStart={lobby.micAtStart}
              onJoin={fromLobby}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      {/* over the feed, which gives up the room: the composer stays where it is */}
      <div data-slot="agent-call-tiles" className="max-h-[40dvh] shrink-0 overflow-y-auto">
        <CallTiles
          call={call}
          ui={ui}
          live={live}
          member
          className="mx-auto w-full max-w-3xl px-4 pt-2 md:px-6"
        />
      </div>
    </>
  );
}

/** A call that is on, whose live state this page has not read yet: no one known in it, its setup
 *  unknown. */
const NOT_READ_YET: CallLive = {
  since: null,
  inCall: {},
  voiceAgent: null,
  setup: null,
  delegation: null,
  links: [],
};

/** The bar says what went wrong under its buttons. In the header's row, of one height, those words
 *  stand over the page below it, so the row does not grow. */
const WORDS_OVER_THE_PAGE =
  "relative items-end *:data-[slot=call-bar-words]:absolute *:data-[slot=call-bar-words]:top-full *:data-[slot=call-bar-words]:right-0 *:data-[slot=call-bar-words]:z-20 *:data-[slot=call-bar-words]:mt-1 *:data-[slot=call-bar-words]:w-80 *:data-[slot=call-bar-words]:*:shadow-md";

/** Below `md` the header has no room for the bar beside the tabs. */
const NARROW = "(max-width: 47.99rem)";
function watchNarrow(changed: () => void) {
  const query = matchMedia(NARROW);
  query.addEventListener("change", changed);
  return () => query.removeEventListener("change", changed);
}

/** The call's bar in the header: in the row on a wide screen, behind one button on a phone. */
function CallControls({
  call,
  ui,
  live,
  start,
  starting,
  join,
}: {
  call: CallEngine | null;
  ui: CallUi;
  live: CallLive | undefined;
  start: (() => Promise<unknown>) | undefined;
  starting: boolean;
  join: () => void;
}) {
  const narrow = useSyncExternalStore(
    watchNarrow,
    () => matchMedia(NARROW).matches,
    () => false,
  );
  const bar = { call, ui, live, start, starting, join, member: true };
  if (!narrow) return <CallBar {...bar} className={WORDS_OVER_THE_PAGE} />;
  if (!call || (!ui.joined && !starting && !start && !live)) return null;
  const wrong = Boolean(ui.error || ui.aiRefusal);
  return (
    <Popover>
      <PopoverTrigger
        nativeButton
        data-joined={ui.joined}
        render={
          <Button
            size="icon-sm"
            variant={ui.joined ? "secondary" : "ghost"}
            title="Call"
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
      >
        <PhoneIcon />
        {wrong ? (
          <span className="absolute top-0.5 right-0.5 size-2 rounded-full bg-destructive" />
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto max-w-[calc(100vw-2rem)]">
        <CallBar {...bar} />
      </PopoverContent>
    </Popover>
  );
}
