// dash-call.tsx — A CALL ON AN AGENT IN THE DASH: its controls in the agent page's header, and its
// cameras and screens over the feed while a call is live. The Agents page loads this module, beside
// the chat's part, only where its row turns calls on (`DashPage["call"]`).
//
// - THE CALL is a facet on the agent's context, the processor row `call` (a mind's config:
//   `call.ts`). Its live state comes with the chat's own: `AgentChat.contextOptions` names no
//   `liveState`, so the chat's hook opens each facet the processors table has, `call` once its row
//   is there. A context with no call opens nothing for it, and shows no error.
// - THE PAGE is its own row on the context (`context.subscription`), which the call knows it by.
// - THE HEADER has the kit's call controls (components/call/call-controls.tsx), the same as Meet's:
//   out of the call, Start call or Join call; in it, the button group and Leave. Before a call,
//   once the table is read and has no `call` row, Start call turns the call on (`DashCall.enable`,
//   with the config's spec) and joins. The controls draw the call as this page knows it: in the
//   call, with or without the live state; else the call's live state, or, once the call is on (its
//   row, or this page's start), a call whose live state has not come yet. While this page's start
//   runs, the button waits for it (`starting`, held here, so a row drawn again keeps it).
// - ON A PHONE, in the call, the controls are behind one button in the header, so the path and the
//   tabs keep the row. The button marks an error the closed row holds.
// - THE TILES are always there over the feed: they draw what the call has to show, and their
//   region for a screen reader stays, so it hears the first arrival and the last departure.
// - A START belongs to the engine it began with: one whose engine changed (a new row) or whose
//   page went away does not join.
// - JOIN ON ARRIVAL (`joinOnArrival`: the Dash's `call=join`, the page a Mac's Accept opens): once
//   the table is read, the page opens the lobby (`CallLobby`, in a dialog), once, and joins nothing.
//   There the person checks their camera and their sound, chooses the devices, sees who is in the
//   call, and joins with what is on, or muted; the tracks it opened go to the call as they are.
//   ANYONE CAN SEND A MEMBER SUCH A LINK (a guest on a share link of the agent can), so it is no
//   press of the person's: this lobby opens no microphone and no camera by itself. `arrived` then
//   takes the key out of the address, so a reload does not open it again.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CallHeaderControls } from "#/components/call/call-controls.tsx";
import { CallLobby, type LobbyMedia } from "#/components/call/call-lobby.tsx";
import { CallTiles } from "#/components/call/call-tiles.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog.tsx";
import { useCall, type CallContext, type CallEngine } from "#/lib/call-engine.ts";
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
  // this page's own start, in flight: which engine's call, and which of its calls (`epoch`). A
  // dispose (pagehide), a Leave or a new row ends it, and a new row shows no start of an old one.
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
  // the lobby of a join on arrival, while it is open
  const [lobby, setLobby] = useState(false);
  // turns the call on while it is off; nothing before the table is read: an agent with a call
  // shows Join, never a start first
  const turnOn =
    call && !barLive && context.processors.loaded
      ? async () => {
          const token = { call, epoch: call.epoch };
          setStartedIn(token);
          try {
            await enable();
            setEnabled(true);
          } finally {
            setStartedIn((now) => (now === token ? null : now));
          }
        }
      : undefined;
  // the lobby's "Start the call": the call on, then the join with what the lobby opened
  const startFromLobby = async (on: () => Promise<void>, { mic, camera }: LobbyMedia) => {
    if (!call) return;
    const epoch = call.epoch;
    await on();
    // the page went away, or its call was closed (a pagehide, a Leave), while the call was turned
    // on: joining is the person's next press
    if (heldCall.current !== call || call.epoch !== epoch) {
      for (const track of [...(mic?.getTracks() || []), ...(camera?.getTracks() || [])])
        track.stop();
      return;
    }
    await call.join({ mic, camera, listenOnly: !mic });
  };
  // the lobby on arrival, once, with nothing open. What it does is this render's (`arrive`, set
  // after each render); when it runs is the table's first read.
  const arrival = useRef(joinOnArrival);
  const arrive = useRef(() => {});
  useEffect(() => {
    arrive.current = () => {
      if (!call) return;
      arrived?.();
      if (!ui.joined && !ui.joining) setLobby(true);
    };
  });
  // the lobby's Join now (or Start the call): the call takes what it opened
  const fromLobby = (media: LobbyMedia) => {
    setLobby(false);
    if (!call) return;
    if (turnOn)
      startFromLobby(turnOn, media).catch((error: unknown) =>
        call.fail(
          `The call could not start: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    else void call.join({ ...media, listenOnly: !media.mic });
  };
  useEffect(() => {
    if (!arrival.current || !call || !context.processors.loaded) return;
    arrival.current = false;
    arrive.current();
  }, [call, context.processors.loaded]);
  return (
    <>
      {barIn
        ? createPortal(
            <CallHeaderControls
              call={call}
              ui={ui}
              live={barLive}
              member
              start={turnOn}
              starting={starting}
            />,
            barIn,
          )
        : null}
      <Dialog open={lobby} onOpenChange={(open) => !open && setLobby(false)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{turnOn ? "Start a call" : "Join the call"}</DialogTitle>
            <DialogDescription>
              Check your camera and your sound first. Nothing is sent until you join.
            </DialogDescription>
          </DialogHeader>
          {lobby ? (
            <CallLobby
              live={live}
              action={turnOn ? "start" : "join"}
              micAtStart={false}
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
