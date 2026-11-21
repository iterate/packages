// call-share.tsx — SHARE ON AN AGENT WITH A CALL: one button for a header, and its pane. The Dash's
// agent page and Meet draw the same one.
//
// - THE BUTTON is the share icon and the word "Share" (the icon alone on a phone), with a tooltip.
//   `ShareButton` is the button alone, for a header that draws it before the pane can open.
// - THE MEMBERS' LINK is the agent's page (`pageUrl`): a member copies it, or puts it in an invite.
// - A GUEST LINK lets anyone who has it into this one agent's chat and call, as a guest with a name
//   and no account. The host makes it and ends it (`ShareLinks`): the kit knows neither the events
//   nor where a guest comes in.
// - THE CALL HOLDS THE LINKS: its facet folds them and admits a guest. So the pane's first open turns
//   the call on when it is off (`enable`), and the live links are the call's live state (`links`),
//   which a guest reads too: who made each, its end, who came by it.
// - THE SECRET is in the made link's URL alone. The pane shows it once, with a button that copies
//   it, and keeps it only while the page holds the pane's state.
// - AN AGENT THAT TAKES NO GUEST'S MESSAGE (no `agent` facet): the pane says so and makes no link.
// - THE CALENDAR INVITE (./calendar-invite.ts): a start and a length, then Google Calendar's form or
//   an .ics file. It holds the agent's page, for members, or the link made in this pane while it
//   is live, when the member includes it.
import { useEffect, useState, type ComponentProps } from "react";
import { ShareIcon } from "lucide-react";
import { cn } from "cn";
import { googleCalendarUrl, icsOf, localInput, nextQuarter } from "./calendar-invite.ts";
import { CopyButton, CopyText } from "#/components/copy-text.tsx";
import { Button, buttonVariants } from "#/components/ui/button.tsx";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip.tsx";
import { CallLive } from "#/lib/call-rules.ts";

/** LINKS FOR GUESTS TO ONE AGENT, as the host makes and ends them: `make` makes a link that lives
 *  `lifetimeMs` and answers it once, with its secret in `url`; `end` ends one by its id. */
export type ShareLinks = {
  make: (lifetimeMs: number) => Promise<ShareMade>;
  end: (link: string) => Promise<unknown>;
};
/** A link just made: its URL with the secret, its end, and its id. */
export type ShareMade = { url: string; until: number; link: string };

/** What the pane reads of the agent's context: which facets it hosts, and the call's live state. */
export type ShareContext = {
  processors: { rows: readonly { hostedFacet?: { name: string } }[]; loaded: boolean };
  liveState: Readonly<Record<string, { value: unknown }>>;
};

const HOUR = 3_600_000;
/** How long a new link lives: the choices, 7 days at most, and the one chosen first. */
const LIFETIMES = [
  { label: "For 1 hour", ms: HOUR },
  { label: "For 1 day", ms: 24 * HOUR },
  { label: "For 7 days", ms: 7 * 24 * HOUR },
];
const DEFAULT_LIFETIME = 24 * HOUR;
/** The lengths an invite offers, in minutes. */
const LENGTHS = [15, 30, 45, 60, 90];

/** WHAT A GUEST GETS, right above "Make a link", so it is on screen at every press of it. */
const GUEST_GETS = [
  "Whoever has this link can read this whole conversation: everything people typed here, and the agent's scripts and their results.",
  "They can write to the agent and join its call, and the agent acts for them with everything it can reach: its tools, its secrets and its files.",
  "A link works until it ends, and you can end it here.",
];

/** THE SHARE BUTTON: the share icon, and "Share" from `md` up, with a tooltip. Its props go to the
 *  button (a popover's trigger passes its own). */
export function ShareButton({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label="Share this agent"
            focusableWhenDisabled
            className={cn("aria-disabled:opacity-50", className)}
            {...props}
          />
        }
      >
        <ShareIcon data-icon="inline-start" />
        <span className="hidden md:inline">Share</span>
      </TooltipTrigger>
      <TooltipContent>Share this agent</TooltipContent>
    </Tooltip>
  );
}

/** SHARE: the button and its pane. `title` is the agent's title, the invite's; `pageUrl` is the
 *  agent's page for members; `enable` turns the call on for the agent. */
export function CallShare({
  share,
  title,
  pageUrl,
  context,
  enable,
}: {
  share: ShareLinks;
  title: string;
  pageUrl: string;
  context: ShareContext;
  enable: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const callOn = context.processors.rows.some((row) => row.hostedFacet?.name === "call");
  // this pane's turning the call on: undefined while it has not tried, "asking" while it does,
  // true once it did, or the words of why it could not
  const [turnedOn, setTurnedOn] = useState<true | "asking" | string | undefined>();
  const needsCall = open && !callOn && context.processors.loaded && turnedOn === undefined;
  useEffect(() => {
    if (!needsCall) return;
    // once: "asking" ends `needsCall`
    setTurnedOn("asking");
    enable().then(
      () => setTurnedOn(true),
      (error: unknown) =>
        setTurnedOn(
          `Links could not be turned on: ${error instanceof Error ? error.message : String(error)}`,
        ),
    );
  }, [needsCall, enable]);
  const ready = callOn || turnedOn === true;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger nativeButton render={<ShareButton />} />
      <PopoverContent
        align="end"
        className="max-h-[80dvh] w-96 max-w-[calc(100vw-1rem)] overflow-y-auto"
        data-slot="share-pane"
      >
        <div className="flex flex-col gap-4 text-sm">
          <section className="flex flex-col gap-1.5" aria-label="Members">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-medium">Members</h3>
              <CopyButton text={pageUrl} label="the members' link" variant="outline" size="sm">
                Copy link
              </CopyButton>
            </div>
            <p className="text-xs text-muted-foreground">
              This page, for members of the mind. Put it in a message or an invite.
            </p>
          </section>
          {ready ? (
            <SharePane share={share} title={title} pageUrl={pageUrl} context={context} />
          ) : turnedOn && turnedOn !== "asking" ? (
            <p className="text-destructive" role="alert">
              {turnedOn}
            </p>
          ) : (
            <p className="text-muted-foreground">Turning links on…</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A date and a time, for the list and the invite's note. */
const when = (at: number) =>
  new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

/** What a guest gets, "Make a link" (and the new link, once), the live links, then the invite. */
function SharePane({
  share,
  title,
  pageUrl,
  context,
}: {
  share: ShareLinks;
  title: string;
  pageUrl: string;
  context: ShareContext;
}) {
  const [lifetime, setLifetime] = useState(DEFAULT_LIFETIME);
  const [made, setMade] = useState<ShareMade | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // a guest's message goes to the `agent` facet: a link to a context with none opens a chat whose
  // every message fails
  const takesGuests =
    !context.processors.loaded ||
    context.processors.rows.some((row) => row.hostedFacet?.name === "agent");
  const live = context.liveState.call?.value;
  const links = live === undefined ? undefined : CallLive.safeParse(live).data?.links;
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  if (!takesGuests)
    return <p className="text-muted-foreground">This agent takes no messages from a guest.</p>;
  // the made link counts while the call lists it: an ended link is in no invite
  const madeLive = made && links?.some((one) => one.link === made.link) ? made : null;
  return (
    <>
      <section className="flex flex-col gap-3 border-t pt-3" aria-label="Guests">
        <h3 className="font-medium">Guests</h3>
        <div className="flex flex-col gap-1.5">
          {GUEST_GETS.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <NativeSelect
            size="sm"
            aria-label="How long the link lives"
            value={lifetime}
            onChange={(event) => setLifetime(Number(event.target.value))}
          >
            {LIFETIMES.map(({ ms, label }) => (
              <NativeSelectOption key={ms} value={ms}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => act(async () => setMade(await share.make(lifetime)))}
          >
            Make a link
          </Button>
        </div>
        {made ? (
          <div className="flex flex-col gap-1" data-slot="share-made">
            <CopyText text={made.url} label="the link" />
            <p className="text-xs text-muted-foreground">
              This link is shown once: its secret is not kept. Make another when you need one.
            </p>
          </div>
        ) : null}
        {error ? (
          <p className="text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <Links
          links={links}
          error={live !== undefined && !links}
          busy={busy}
          end={(link) => act(() => share.end(link))}
        />
      </section>
      <Invite title={title} pageUrl={pageUrl} made={madeLive} />
    </>
  );
}

/** The live links of the call's live state, newest last. No secret is here. */
function Links({
  links,
  error,
  busy,
  end,
}: {
  links: CallLive["links"] | undefined;
  /** The live state is there and is no call's. */
  error: boolean;
  busy: boolean;
  end: (link: string) => void;
}) {
  if (error) return <p className="text-destructive">The links could not be read.</p>;
  if (!links) return <p className="text-muted-foreground">Reading the links…</p>;
  if (!links.length) return <p className="text-muted-foreground">No live link.</p>;
  return (
    <ul className="flex max-h-64 flex-col gap-2 overflow-auto" data-slot="share-links">
      {links.map((link) => (
        <li key={link.link} className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate">
              Made by {link.madeBy}, until {when(link.until)}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {link.guests.length
                ? `${link.guests.length} ${link.guests.length === 1 ? "guest" : "guests"}: ${link.guests.join(", ")}`
                : "No guest yet"}
            </div>
          </div>
          <Button size="xs" variant="outline" disabled={busy} onClick={() => end(link.link)}>
            End
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** "Add to calendar": a start and a length, then Google Calendar's form or an .ics file. */
function Invite({
  title,
  pageUrl,
  made,
}: {
  title: string;
  pageUrl: string;
  /** The link made in this pane, while the call lists it. */
  made: ShareMade | null;
}) {
  const [start, setStart] = useState(() => localInput(nextQuarter(new Date())));
  const [minutes, setMinutes] = useState(30);
  const [withGuests, setWithGuests] = useState(false);
  const [uid] = useState(() => `${crypto.randomUUID()}@${location.hostname}`);
  const guests = made && withGuests ? made : null;
  const at = new Date(start);
  const invite = {
    title,
    start: Number.isNaN(at.getTime()) ? nextQuarter(new Date()) : at,
    minutes,
    link: guests ? guests.url : pageUrl,
    uid,
    stamp: new Date(),
  };
  const download = () => {
    const file = new Blob([icsOf(invite)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(file);
    // an anchor in the document, which some browsers need for a download, and the file's URL kept
    // a while: the download may begin after this turn
    const anchor = Object.assign(document.createElement("a"), {
      href: url,
      download: `${fileNameOf(title)}.ics`,
    });
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  return (
    <section className="flex flex-col gap-2 border-t pt-3" aria-label="Add to calendar">
      <h3 className="font-medium">Add to calendar</h3>
      <div className="flex items-center gap-2">
        <Input
          type="datetime-local"
          aria-label="Starts at"
          value={start}
          onChange={(event) => setStart(event.target.value)}
          className="h-7 min-w-0 flex-1"
        />
        <NativeSelect
          size="sm"
          aria-label="How long"
          value={minutes}
          onChange={(event) => setMinutes(Number(event.target.value))}
        >
          {LENGTHS.map((length) => (
            <NativeSelectOption key={length} value={length}>
              {length} minutes
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {made ? (
        <Label className="font-normal">
          <Checkbox checked={withGuests} onCheckedChange={setWithGuests} />
          Include the guest link
        </Label>
      ) : (
        <p className="text-xs text-muted-foreground">
          The invite links to this page: members only.
        </p>
      )}
      {guests ? (
        <p className="text-xs text-muted-foreground">
          Anyone with this invite can join until {when(guests.until)}.
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <a
          className={buttonVariants({ variant: "outline", size: "sm" })}
          href={googleCalendarUrl(invite)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Google Calendar
        </a>
        <Button variant="outline" size="sm" onClick={download}>
          Download .ics
        </Button>
      </div>
    </section>
  );
}

/** A title as a file's name: letters, digits and dashes. */
const fileNameOf = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "invite";
