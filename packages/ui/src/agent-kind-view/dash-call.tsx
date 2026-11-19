// dash-call.tsx — A CALL ON AN AGENT IN THE DASH: its controls in the agent page's header, and its
// cameras and screens over the feed while a call is live. The Agents page loads this module, beside
// the chat's part, only where its row turns calls on (`DashPage["call"]`).
//
// - THE CALL is a facet on the agent's context, the processor row `call` (a mind's config:
//   `call.ts`). Its live state comes with the chat's own: `AgentChat.contextOptions` names no
//   `liveState`, so the chat's hook opens each facet the processors table has, `call` once its row
//   is there. A context with no call opens nothing for it, and shows no error.
// - THE PAGE is its own row on the context (`context.subscription`), which the call knows it by.
// - BEFORE A CALL: "Start a call", once the table is read and has no `call` row. Its press turns the
//   call on (`DashCall.enable`, with the config's spec) and joins.
// - THE HEADER draws the call as this page knows it: while its own start runs and the page is not
//   in the call yet, "Starting…" alone; else the call's live state, or, once the call is on (its
//   row) or this page is in it, a call whose live state has not come yet. So a start goes Start →
//   Starting… → the joined bar, with no Join between and no empty header, whichever comes first:
//   the live state or the join's end. Mute and Leave show as soon as the microphone is live.
// - ON A PHONE the bar is behind one button in the header, so the path and the tabs keep the row.
import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { PhoneIcon } from "lucide-react";
import { CallBar } from "#/components/call/call-bar.tsx";
import { CallTiles } from "#/components/call/call-tiles.tsx";
import { Button } from "#/components/ui/button.tsx";
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
  voiceAppHref,
  barIn,
}: {
  stub: CallContext | undefined;
  context: {
    subscription?: string;
    processors: { rows: readonly { hostedFacet?: { name: string } }[]; loaded: boolean };
    liveState: Readonly<Record<string, { value: unknown }>>;
  };
  /** Turns the call on for this agent. */
  enable: () => Promise<unknown>;
  voiceAppHref: string | undefined;
  barIn: HTMLElement | null;
}) {
  const { call, ui, live } = useCall(stub, context.subscription, context.liveState.call?.value);
  // this page's own start, in flight: the header shows it alone, never a Join beside it, until the
  // page is in the call. From then the bar's own buttons stand, also after a Leave that comes
  // before the join has ended.
  const [starting, setStarting] = useState(false);
  // this page turned the call on: Join from now on, even when its join failed before the table or
  // the live state said so; a second start would turn on a call that is on
  const [enabled, setEnabled] = useState(false);
  const facetOn = context.processors.rows.some((row) => row.hostedFacet?.name === "call");
  const barLive = starting
    ? undefined
    : live || (facetOn || enabled || ui.joined ? NOT_READ_YET : undefined);
  // nothing before the table is read: an agent with a call shows Join, never a start first
  const start =
    call && !barLive && context.processors.loaded
      ? async () => {
          setStarting(true);
          const inTheCall = call.subscribe((ui) => {
            if (ui.joined) setStarting(false);
          });
          try {
            await enable();
            setEnabled(true);
            await call.join();
          } finally {
            inTheCall();
            setStarting(false);
          }
        }
      : undefined;
  const callIsLive = ui.joined || Object.keys(live?.inCall || {}).length > 0;
  return (
    <>
      {barIn
        ? createPortal(
            <CallControls
              call={call}
              ui={ui}
              live={barLive}
              start={start}
              voiceAppHref={voiceAppHref}
            />,
            barIn,
          )
        : null}
      {callIsLive ? (
        // over the feed, which gives up the room: the composer stays where it is
        <div data-slot="agent-call-tiles" className="max-h-[40dvh] shrink-0 overflow-y-auto">
          <CallTiles
            call={call}
            ui={ui}
            live={live}
            member
            className="mx-auto w-full max-w-3xl px-4 pt-2 md:px-6"
          />
        </div>
      ) : null}
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
  links: [],
};

/** The bar says what went wrong under its buttons. In the header's row, of one height, those words
 *  stand over the page below it, so the row does not grow. */
const WORDS_OVER_THE_PAGE =
  "relative items-end *:data-[slot=alert]:absolute *:data-[slot=alert]:top-full *:data-[slot=alert]:right-0 *:data-[slot=alert]:z-20 *:data-[slot=alert]:mt-1 *:data-[slot=alert]:w-80 *:data-[slot=alert]:shadow-md";

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
  voiceAppHref,
}: {
  call: CallEngine | null;
  ui: CallUi;
  live: CallLive | undefined;
  start: (() => Promise<unknown>) | undefined;
  voiceAppHref: string | undefined;
}) {
  const narrow = useSyncExternalStore(
    watchNarrow,
    () => matchMedia(NARROW).matches,
    () => false,
  );
  const bar = { call, ui, live, start, voiceAppHref, member: true };
  if (!narrow) return <CallBar {...bar} className={WORDS_OVER_THE_PAGE} />;
  if (!live && !start) return null;
  return (
    <Popover>
      <PopoverTrigger
        nativeButton
        data-joined={ui.joined}
        render={<Button size="icon-sm" variant={ui.joined ? "secondary" : "ghost"} title="Call" />}
      >
        <PhoneIcon />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto max-w-[calc(100vw-2rem)]">
        <CallBar {...bar} />
      </PopoverContent>
    </Popover>
  );
}
