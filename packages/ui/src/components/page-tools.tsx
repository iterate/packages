// page-tools.tsx — A PAGE THAT SHOWS AN AGENT LENDS IT TOOLS THAT RUN IN THE PAGE: a banner with
// buttons, and Playwright's locators (find, fill, click, press, highlight, read) inside the part of
// the page that the host marks. Off unless the host mounts this, beside its agent view:
//
//   <div data-page-tools="scope">            the part the agent may act in (`<body>` for all of it)
//     <AgentChat path={path} … />
//     <PageTools itx={itx} path={path} me={principal} agent="Helper" />
//     <aside data-page-tools="off">…</aside>  a part of it that never matches a locator
//   </div>
//
// With no `scope` mark around it the agent gets the banner and `open` alone.
// ../lib/page-tools.ts says how a call travels, who may call, and what the marks are worth: read it
// before you turn this on.
//
// WHAT TURNING IT ON COSTS. What the agent does here, it does in the person's tab: a message it
// sends from the composer and a button it presses carry the PERSON's stamp in the log. The page
// writes one audit row for each call (`events.iterate.com/page/tool-called`), which also carries
// the person's stamp and names no caller: it says that a tool ran in this tab, not which code of
// the mind called it. A jailed agent gets nothing: the lender refuses it.
//
// `tools` are the host's own, each a function of the page under a name of its own, lent with the
// kit's. `onOpen` shows a path of the app for `open(path)` and for a banner's button; without it
// the browser loads the path. Stop is kept for the tab (`sessionStorage`): a reload does not lend
// again.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { BotIcon } from "lucide-react";
import {
  lendPageTools,
  PAGE_TOOL_CALLED,
  PAGE_TOOLS_ATTRIBUTE,
  PageToolsSession,
  personSegment,
  type LendingContext,
  type OwnPageTool,
  type PageToolsShown,
  type ShownBanner,
  type ShownHighlight,
} from "../lib/page-tools.ts";
import { Button } from "#/components/ui/button.tsx";
import { itxSessionOf } from "#/lib/itx-session.ts";

const NOTHING_SHOWN: PageToolsShown = { banner: null, acting: null, highlights: [] };
const nothingShown = () => NOTHING_SHOWN;
/** Where the tab keeps that its person pressed Stop. */
const STOPPED = "iterate.page-tools.stopped";

function auditFailed(error: unknown) {
  console.error({
    event: "page-tools.audit-failed",
    message: error instanceof Error ? error.message : String(error),
  });
}

export function PageTools({
  itx,
  path,
  me,
  agent,
  tools,
  onOpen,
}: {
  /** The signed-in person's `itx`: the lend is made over its socket. */
  itx: { cd(path: string): PromiseLike<LendingContext & Disposable> };
  /** The agent's path. */
  path: string;
  /** Who has the page open. Undefined while the page does not know: nothing is lent until then. */
  me: { actor: string; email?: string } | undefined;
  /** The agent's name, as the page shows it: what the agent calls itself, so no proof of who. */
  agent: string;
  /** The host's own tools. One object for the page's life: a new one is a new lend. */
  tools?: Readonly<Record<string, OwnPageTool>>;
  onOpen?: (path: string) => void;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  // what a call reads when it runs: a name that arrives later, or a new `onOpen`, is no new lend
  const latest = useRef({ agent, onOpen });
  useEffect(() => {
    latest.current = { agent, onOpen };
  });
  // a lend is of one session of the socket: a new session lends again, under a new name
  const connection = itxSessionOf(itx);
  const { epoch } = useSyncExternalStore(connection.subscribe, connection.get, connection.get);
  // Stop never fails: the state is the stop, and the tab's store only keeps it over a reload. A
  // store that is blocked or full throws, and then a reload lends again.
  const [stopped, setStopped] = useState(() => {
    try {
      return sessionStorage.getItem(STOPPED) === "1";
    } catch {
      return false;
    }
  });
  const stop = () => {
    setStopped(true);
    try {
      sessionStorage.setItem(STOPPED, "1");
    } catch (error) {
      console.error({
        event: "page-tools.stop-not-kept",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const actor = me?.actor;
  const email = me?.email;
  // The tools of the lend that stands, for the draw. One session for one lend: a lend that ended
  // never serves again, so a call that still arrives under its name does nothing.
  const [standing] = useState(() => {
    let session: PageToolsSession | null = null;
    const listeners = new Set<() => void>();
    return {
      get: () => session,
      subscribe: (changed: () => void) => {
        listeners.add(changed);
        return () => void listeners.delete(changed);
      },
      set(next: PageToolsSession | null) {
        session = next;
        for (const changed of listeners) changed();
      },
    };
  });
  const session = useSyncExternalStore(standing.subscribe, standing.get, () => null);
  useEffect(() => {
    if (!actor || stopped) return;
    // the agent's context, held from the lend to its end: a call arrives only between the two
    let context: (LendingContext & Disposable) | undefined;
    let gone = false;
    const session = new PageToolsSession({
      agent: () => latest.current.agent,
      person: email || actor,
      scope: () => anchor.current?.closest(`[${PAGE_TOOLS_ATTRIBUTE}="scope"]`) ?? null,
      open: (to) => (latest.current.onOpen ? latest.current.onOpen(to) : location.assign(to)),
      audit: (call) => {
        context?.append({ type: PAGE_TOOL_CALLED, payload: call }).then(undefined, auditFailed);
      },
      rules: async () => (context ? await context.rewriteRules.list(0) : []),
      tools,
    });
    const lending = async () => {
      const opened = await itx.cd(path);
      if (gone) {
        opened[Symbol.dispose]();
        return;
      }
      context = opened;
      // a session that stopped meanwhile ends the lend itself (`session.lent`)
      const refused = await lendPageTools(opened, personSegment({ actor, email }), session);
      if (refused) console.info({ event: "page-tools.not-lent", path, why: refused });
      else if (!gone) standing.set(session);
    };
    lending().catch((error: unknown) => {
      session.stop("this tab could not lend its tools");
      console.error({
        event: "page-tools.lend-failed",
        path,
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return () => {
      gone = true;
      standing.set(null);
      session.stop(
        "this tab's lend ended (the person pressed Stop, left the agent's page or closed the tab): the capability tree names the tabs that are open now",
      );
      // the calls that this ended write their rows first
      void session.settled().then(() => {
        context?.[Symbol.dispose]();
        context = undefined;
      });
    };
    // `epoch`: each session of the socket lends anew
  }, [standing, itx, path, actor, email, tools, stopped, epoch]);
  const shown = useSyncExternalStore(
    session ? session.subscribe : () => () => {},
    session ? session.get : nothingShown,
    nothingShown,
  );
  const drawn = session && (shown.banner || shown.acting || shown.highlights.length > 0);
  return (
    <>
      <span ref={anchor} hidden data-slot="page-tools" />
      {drawn
        ? createPortal(
            // Over the page, and kept back from every locator: the agent's tools never reach what
            // says that the agent acts.
            <div
              data-slot="page-tools-layer"
              data-page-tools="off"
              className="pointer-events-none fixed inset-0 z-50"
            >
              {shown.acting ? (
                <>
                  <div className="absolute inset-0 border-2 border-primary/60" />
                  {/* no name is long enough to move Stop out of the window */}
                  <p
                    role="status"
                    className="pointer-events-auto absolute top-2 left-1/2 flex max-w-[calc(100vw-1rem)] -translate-x-1/2 items-center gap-2 rounded-full border bg-background py-1 pr-1 pl-3 text-xs shadow-sm"
                  >
                    <BotIcon className="size-3 shrink-0" />
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{agent}</span> is {shown.acting}
                    </span>
                    <Button size="xs" variant="outline" className="shrink-0" onClick={stop}>
                      Stop
                    </Button>
                  </p>
                </>
              ) : null}
              {shown.highlights.map((mark) => (
                <Mark key={mark.id} session={session} mark={mark} />
              ))}
              {shown.banner ? (
                <Banner
                  banner={shown.banner}
                  agent={agent}
                  path={path}
                  onAnswer={(label) => session.answerBanner(label)}
                  onStop={stop}
                />
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** A ring on an element of the page, which follows it, with the note beside it. */
function Mark({ session, mark }: { session: PageToolsSession; mark: ShownHighlight }) {
  const ring = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    const place = () => {
      if (!mark.element.isConnected) {
        session.unmark(mark.id);
        return;
      }
      const box = mark.element.getBoundingClientRect();
      const node = ring.current;
      if (node) {
        node.style.transform = `translate(${box.left}px, ${box.top}px)`;
        node.style.width = `${box.width}px`;
        node.style.height = `${box.height}px`;
        // the note stays in the window: it opens towards the side with more room
        node.dataset.x = box.left + box.width / 2 > innerWidth / 2 ? "end" : "start";
        node.dataset.y = box.top + box.height / 2 > innerHeight / 2 ? "above" : "below";
      }
      frame = requestAnimationFrame(place);
    };
    place();
    return () => cancelAnimationFrame(frame);
  }, [session, mark]);
  return (
    <div
      ref={ring}
      data-slot="page-tools-mark"
      className="group absolute top-0 left-0 rounded-md ring-2 ring-primary ring-offset-2 ring-offset-background"
    >
      <span className="absolute top-full left-0 mt-2 line-clamp-4 w-max max-w-xs rounded-md bg-primary px-2 py-1 text-xs break-words text-primary-foreground shadow-sm group-data-[x=end]:right-0 group-data-[x=end]:left-auto group-data-[y=above]:top-auto group-data-[y=above]:bottom-full group-data-[y=above]:mt-0 group-data-[y=above]:mb-2">
        {mark.note}
      </span>
    </div>
  );
}

/** The agent's notice. Its first lines are the page's: the name the agent calls itself, and under
 *  it the agent's path, which no call sets. Its words are text, never markup. The card is never
 *  taller than the window: a long body scrolls inside it, so Close and Stop stay where a person
 *  can press them. */
function Banner({
  banner,
  agent,
  path,
  onAnswer,
  onStop,
}: {
  banner: ShownBanner;
  agent: string;
  path: string;
  onAnswer: (label: string | null) => void;
  onStop: () => void;
}) {
  return (
    <section
      role="alert"
      data-slot="page-tools-banner"
      className="pointer-events-auto absolute top-4 right-4 flex max-h-[calc(100vh-2rem)] w-80 max-w-[calc(100vw-2rem)] flex-col rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg"
    >
      <p className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        <BotIcon className="size-3 shrink-0" />
        <span className="min-w-0 truncate font-medium text-foreground">{agent}</span>
      </p>
      <p className="mt-0.5 line-clamp-2 shrink-0 font-mono text-xs break-all text-muted-foreground">
        {path}
      </p>
      <h2 className="mt-2 line-clamp-3 shrink-0 text-sm font-medium break-words">{banner.title}</h2>
      {banner.body ? (
        <p className="mt-1 min-h-0 overflow-y-auto text-sm break-words whitespace-pre-wrap text-muted-foreground">
          {banner.body}
        </p>
      ) : null}
      <div className="mt-3 flex shrink-0 flex-wrap justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => onAnswer(null)}>
          Close
        </Button>
        {banner.buttons.map((label, at) => (
          <Button
            key={label}
            size="sm"
            variant={at === banner.buttons.length - 1 ? "default" : "outline"}
            className="max-w-full"
            onClick={() => onAnswer(label)}
          >
            <span className="truncate">{label}</span>
          </Button>
        ))}
      </div>
      <p className="mt-3 shrink-0 border-t pt-2 text-xs text-muted-foreground">
        An agent of this mind shows this in your tab. A press here is no approval.{" "}
        <button type="button" className="underline" onClick={onStop}>
          Stop its tools here
        </button>
      </p>
    </section>
  );
}
