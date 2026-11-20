// page-tools.ts — CLIENT-SIDE TOOLS FOR AN AGENT, IN THE PAGE THAT SHOWS IT. A page that a signed-in
// person has open lends the agent a few functions that run in that page: show a banner, find an
// element as Playwright does, then fill, click, press, highlight or read it. The component is
// #/components/page-tools.tsx; this file is the plain part, with no React.
//
// HOW A CALL TRAVELS. The page lends one live stub at the AGENT's own context, under a name that
// holds the person and the tab (`lendPageTools`):
//
//   itx.cd(path).provide("itx.page.jonas.k3f9", tools, { description })
//
// The kernel puts a rule in that context's table which points at the stub, so the agent reads the
// name and its description in its capability tree, and its script calls
// `await itx.page.jonas.k3f9.getByLabel("Message").fill("…")`. A call is a live RPC over the page's
// own socket and is stored nowhere. When the socket closes or the page leaves the agent, the
// kernel takes the rule away, and a later call fails. The name is new at every lend: a call in
// flight to an old name fails, and never runs in another tab or a second time.
//
// WHO MAY CALL. Any code of the mind that can reach the agent's context: the mind has no walls
// between its unjailed agents, so one member's agent can act in another member's tab. A JAILED
// agent never gets a lend (`jailOf`): it holds less than a member, and a function in a member's
// tab would be its way out. The kernel does not refuse a member's lend into a jail, so this file's
// lender is where that is refused: before the lend, and again before every call. A host that calls
// `provide` by itself skips both.
//
// WHAT THE RULES BELOW ARE. The scope (`data-page-tools="scope"`), the parts a host keeps back
// (`data-page-tools="off"`), the fields that never match (`keptBack`) and the links and forms that
// refuse (`watched`) bound the agent's ACTS and what `textContent` answers, in a page WHOSE CODE IT
// CANNOT CHANGE: an app that is not the mind's own. They do not seal what the page holds: a
// selector asks about every attribute and every text of the document, and a patient caller learns
// from what matches. A host whose page holds what the agent must not learn does not lend. On a
// mind's own Dash the rules are manners, no wall: an unjailed agent can commit to the mind's
// config repo, and that commit is the Dash's code. There the walls are the jail and the passkey.
//
// WHAT THE PERSON SEES is this file's `shown` store, which the component draws: the agent's path
// on every banner, a label while a call runs and three seconds after ("… is typing"), a ring on
// what was filled or highlighted, and Stop, which ends the lend for the tab. No act runs while the
// tab is in the background: the person would not see it. Each call appends one audit row to the
// agent's context (`PAGE_TOOL_CALLED`): the tool, the locator, the outcome, and never a field's
// value or a banner's words. The PAGE appends it, so it carries the member's stamp and names no
// caller: it says that a tool ran in that member's tab, not which code of the mind called it.
import { RpcTarget } from "capnweb";
import { Ivya, getByLabelSelector, getByRoleSelector, getByTextSelector } from "ivya";
import { getAriaDisabled, isElementVisible } from "ivya/utils";
import { z } from "zod";

/** The attribute a host marks its page with: `scope` on the element the agent may act in, `off`
 *  on a part of it that the agent may not touch or read. */
export const PAGE_TOOLS_ATTRIBUTE = "data-page-tools";

/** The audit row's type: one for each call, appended by the page to the agent's context. */
export const PAGE_TOOL_CALLED = "events.iterate.com/page/tool-called";

/** How many calls one lend takes in `CALLS_WINDOW_MS`. */
export const CALLS_PER_WINDOW = 30;
export const CALLS_WINDOW_MS = 10_000;
/** How many banners wait behind the one that shows. */
export const BANNERS_WAITING = 3;
/** The longest texts a call may carry, in characters. */
export const LIMITS = {
  title: 120,
  body: 1_000,
  label: 40,
  note: 200,
  fill: 10_000,
  read: 20_000,
  /** One part of a locator (a selector, a text, a label), and how many parts a chain has. */
  part: 200,
  parts: 8,
  /** The locator as the audit row keeps it. */
  written: 300,
} as const;
const BUTTONS = 3;
/** How long the label stays after a call ends. */
const ACTING_LINGERS_MS = 3_000;
/** How long a click or a key is watched for where it leads, after it returned: a page's handler
 *  may leave later (the shell's Sign out wipes its saved rows first, then submits a form). */
const WATCHED_AFTER_MS = 2_000;
const KEYS = ["Enter", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"] as const;

/** A locator's options, off the wire. The engine writes some of them into its selector as they
 *  are (`level`, `checked`), so a value of another type could start a part of another engine
 *  (`{ level: "1] >> xpath=..//*[1" }`): only these keys, each of its own type. */
const MatchOptions = z.strictObject({ exact: z.boolean().optional() });
const RoleOptions = MatchOptions.extend({
  name: z.string().max(LIMITS.part).optional(),
  disabled: z.boolean().optional(),
  includeHidden: z.boolean().optional(),
  checked: z.boolean().optional(),
  expanded: z.boolean().optional(),
  level: z.number().int().min(1).max(6).optional(),
  pressed: z.boolean().optional(),
  selected: z.boolean().optional(),
});
type MatchOptions = z.infer<typeof MatchOptions>;
type RoleOptions = z.infer<typeof RoleOptions>;
/** The options as their schema takes them, or the words that say what is wrong. */
function optionsOf<T>(schema: z.ZodType<T>, options: unknown, what: string): T {
  const parsed = schema.safeParse(options ?? {});
  if (!parsed.success) throw new Error(`${what}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
type Step =
  | { kind: "css"; selector: string }
  | { kind: "role"; role: string; options: RoleOptions }
  | { kind: "text" | "label"; text: string; options: MatchOptions }
  | { kind: "nth"; index: number };
type Options = { timeout?: number };
/** What a locator is asked to do, with what the act takes. */
type Act =
  | { action: "fill"; text: string }
  | { action: "press"; key: string }
  | { action: "highlight"; note: string; seconds: number }
  | { action: "click" | "focus" | "scrollIntoView" | "textContent" | "count" };

/** One audit row: what was called and how it ended. `locator` is the caller's own selector, cut
 *  to `LIMITS.written` characters. */
export type PageToolCall = {
  tool: string;
  locator?: string;
  outcome: "done" | "refused" | "failed";
};

export type BannerInput = {
  title: string;
  body?: string;
  /** Up to three. `open`: a path of this app that a press also opens. No button: a notice. */
  buttons?: { label: string; open?: string }[];
  /** How long it shows with no press: 60 by default, 300 at most. */
  seconds?: number;
};
/** Which button was pressed, or why none was: nobody pressed in time, the person closed the
 *  banner, or the person stopped the tools in the tab. */
export type BannerAnswer =
  | { pressed: string }
  | { pressed: null; why: "no answer" | "dismissed" | "off" };

export type ShownBanner = { id: number; title: string; body: string; buttons: readonly string[] };
export type ShownHighlight = { id: number; element: Element; note: string };
/** What the page draws for the person. */
export type PageToolsShown = {
  banner: ShownBanner | null;
  /** The word of the call that runs or just ran ("typing"), or null. */
  acting: string | null;
  highlights: readonly ShownHighlight[];
};

/** A host's own tool: a function of the page under a name of its own, with the line the agent
 *  reads for it. The kit shows the label and writes the audit row; what the function does is the
 *  host's. */
export type OwnPageTool = { description: string; run: (...args: unknown[]) => unknown };

const WORDS: Record<Act["action"], string> = {
  fill: "typing",
  press: "typing",
  click: "clicking",
  focus: "pointing",
  highlight: "pointing",
  scrollIntoView: "pointing",
  textContent: "reading",
  count: "reading",
};

const engine = Ivya.create({ browser: "chromium", testIdAttribute: "data-testid" });

/** The selector of a chain of steps, in the engine's own language. */
function selectorOf(steps: readonly Step[]): string {
  return steps
    .map((step) => {
      switch (step.kind) {
        case "css":
          // the CSS engine alone: no `xpath=`, no engine of the library's own
          return `css=${step.selector}`;
        case "role":
          return getByRoleSelector(step.role, { exact: false, ...step.options });
        case "text":
          return getByTextSelector(step.text, { exact: false, ...step.options });
        case "label":
          return getByLabelSelector(step.text, { exact: false, ...step.options });
        case "nth":
          return `nth=${step.index}`;
      }
    })
    .join(" >> ");
}

const SENSITIVE_TYPES: ReadonlySet<string> = new Set(["password", "hidden", "file"]);
const SENSITIVE_AUTOCOMPLETE =
  /(?:^|\s)(?:one-time-code|current-password|new-password|cc-[a-z-]+)(?:\s|$)/;

/** WHAT NEVER MATCHES A LOCATOR, whatever the selector says: a part the host keeps back, and a
 *  field for a password, a code or a card (a hidden or a file input too). To every tool it is
 *  absent, `count` included, so a selector on its value answers the same as one that matches
 *  nothing. */
function keptBack(element: Element): boolean {
  if (element.closest(`[${PAGE_TOOLS_ATTRIBUTE}="off"]`)) return true;
  return (
    element instanceof HTMLInputElement &&
    (SENSITIVE_TYPES.has(element.type) || SENSITIVE_AUTOCOMPLETE.test(element.autocomplete))
  );
}

/** What a failed search says besides its selector: the same words whether the element is absent or
 *  kept back. */
const NEVER_MATCH =
  "a part the page keeps back, a field for a password, a code or a card, and anything outside the page's marked part never match";

/** WHY AN ADDRESS IS NOT FOR AN AGENT'S ACT, or null: it leaves this origin, or it is one of the
 *  platform's own paths on it (`/.auth/…`, `/.iterate/…`: sign-in, sign-out, the issuer). No tool
 *  signs a person out or sends them to where a member signs. */
export function refusalOf(address: string): string | null {
  const to = new URL(address, document.baseURI);
  if (to.origin !== location.origin)
    return "it leads to another site: say where it is, and the person presses it";
  if (to.pathname.startsWith("/."))
    return "it is the platform's own page (sign-in, sign-out): the person presses it";
  return null;
}

/** One watched act: until when it is watched (`Infinity` while it runs), why what it set off was
 *  stopped while it ran, and how a later stop is written down. */
type Watch = { until: number; refused: string; written(): void };
/** The acts that are watched now, oldest first. The page has one pair of listeners for all of
 *  them, whichever lend made them: they stand while this holds one. */
const watches = new Set<Watch>();

/** A CLICK OR A KEY OF AN AGENT'S, WATCHED FOR WHERE IT LEADS. While the act runs and for
 *  `WATCHED_AFTER_MS` after, a link that a script follows and a form that is submitted are read
 *  first, whoever starts them: the element itself, a button of the form, or the page's own
 *  handler. One that `refusalOf` refuses is stopped before any handler of the page hears it.
 *
 *  The watch belongs to the page and not to the lend: a click on Sign out, and then a call that
 *  ends the lend, must not let the late submit through. The person's own click on a link passes
 *  (the browser marks it as theirs); a form has no such mark, so in those two seconds their own
 *  Sign out is held too. What the watch cannot see: a handler that leaves by `location`, by
 *  `form.submit()` or by a request of its own, one that a `fill` sets off, or one after the two
 *  seconds.
 *
 *  Answers the watch; `returned()` says that the act came back, and until when it is watched. */
function watchAnAct(written: () => void): Watch & { returned(): number } {
  if (watches.size === 0) {
    document.addEventListener("click", stopAFollowedLink, true);
    document.addEventListener("submit", stopASubmittedForm, true);
  }
  const watch = {
    until: Infinity,
    refused: "",
    written,
    returned() {
      watch.until = performance.now() + WATCHED_AFTER_MS;
      setTimeout(() => {
        watches.delete(watch);
        if (watches.size > 0) return;
        document.removeEventListener("click", stopAFollowedLink, true);
        document.removeEventListener("submit", stopASubmittedForm, true);
      }, WATCHED_AFTER_MS);
      return watch.until;
    },
  };
  watches.add(watch);
  return watch;
}

function stopAFollowedLink(event: Event): void {
  if (!event.isTrusted && event.target instanceof Element)
    stopWhereItLeads(event, event.target.closest("a[href], area[href]")?.getAttribute("href"));
}

function stopASubmittedForm(event: SubmitEvent): void {
  if (event.target instanceof HTMLFormElement)
    stopWhereItLeads(
      event,
      // a form with no action posts to the page's own address
      event.submitter?.getAttribute("formaction") ||
        event.target.getAttribute("action") ||
        location.href,
    );
}

/** Stops an event that leads where no act of an agent's may, and tells the newest watch. */
function stopWhereItLeads(event: Event, address: string | null | undefined): void {
  // a watch whose window has ended stops nothing, also before its timer took it away
  const newest = [...watches].findLast((watch) => watch.until >= performance.now());
  const why = address ? refusalOf(address) : null;
  if (!newest || !why) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (newest.until === Infinity) newest.refused = why;
  else newest.written();
}

/** An element's text as the agent may read it: without the parts the host keeps back. A field's
 *  value is no text, so it is never in it. */
function readableText(element: Element): string {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const kept = node.parentElement?.closest(`[${PAGE_TOOLS_ATTRIBUTE}="off"]`);
    if (!kept || !element.contains(kept)) text += node.nodeValue;
  }
  return text;
}

function editable(element: Element): boolean {
  const mark = element.getAttribute("contenteditable");
  return mark === "" || mark === "true" || mark === "plaintext-only";
}

const FILLABLE_TYPES: ReadonlySet<string> = new Set([
  "text",
  "search",
  "email",
  "tel",
  "url",
  "number",
]);

/** Puts `text` in a field as a person's typing would: React and an editor hear an input. */
function fill(element: Element, text: string): void {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (element instanceof HTMLInputElement && !FILLABLE_TYPES.has(element.type))
      throw new Error(`fill does not take an input of type ${element.type}`);
    // The prototype's setter, which every browser defines: a React input's own one only records
    // the value it was given.
    const prototype =
      element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, text);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  if (!(element instanceof HTMLElement) || !editable(element))
    throw new Error("fill takes a text input, a textarea or an editor");
  // An editor (the chat's composer is one) keeps its own document: it takes text only as input.
  element.focus();
  getSelection()?.selectAllChildren(element);
  const took = text
    ? document.execCommand("insertText", false, text)
    : !element.textContent || document.execCommand("delete");
  if (!took) throw new Error("this editor did not take the text");
}

function click(element: HTMLElement): void {
  const box = element.getBoundingClientRect();
  const at = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: box.left + box.width / 2,
    clientY: box.top + box.height / 2,
    button: 0,
  };
  // a menu or a select opens on the press, a button acts on the click
  element.dispatchEvent(new PointerEvent("pointerdown", { ...at, buttons: 1, isPrimary: true }));
  element.dispatchEvent(new MouseEvent("mousedown", { ...at, buttons: 1 }));
  element.focus();
  element.dispatchEvent(new PointerEvent("pointerup", { ...at, isPrimary: true }));
  element.dispatchEvent(new MouseEvent("mouseup", at));
  element.click();
}

/** The key's events, for the page's own handlers (a composer sends on Enter, a menu moves on an
 *  arrow). A page's script cannot make the browser's own answer to a key. */
function press(element: HTMLElement, key: string): void {
  element.focus();
  const event = { key, code: key, bubbles: true, cancelable: true, composed: true };
  element.dispatchEvent(new KeyboardEvent("keydown", event));
  element.dispatchEvent(new KeyboardEvent("keyup", event));
}

/** A refusal reads as one: the audit row says `refused`, and the agent gets the words. */
class Refusal extends Error {}
/** A call over the lend's rate: refused, and not written down, so the rows stay bounded too. */
class OverTheRate extends Refusal {}

/** "The person sees each call" is the bound on what a call does, and it is false in a background
 *  tab: asked when a call is admitted, and again right before it acts. */
function refuseInTheBackground(): void {
  if (document.visibilityState !== "visible")
    throw new Refusal(
      "the person's tab is in the background, so they would not see this: call again when they look at it",
    );
}

function bounded(text: unknown, limit: number, what: string): string {
  if (typeof text !== "string") throw new Refusal(`${what} is a string`);
  if (text.length > limit)
    throw new Refusal(`${what} is at most ${limit} characters: this one has ${text.length}`);
  return text;
}

/** ONE LEND'S TOOLS AND WHAT THEY SHOW. The page makes one for each lend and ends it with
 *  `stop`. */
export class PageToolsSession {
  /** What the page lends. */
  readonly target: PageTarget;
  /** The line the agent reads for the lent name in its capability tree. */
  readonly description: string;
  readonly #host: PageToolsHost;
  #shown: PageToolsShown = { banner: null, acting: null, highlights: [] };
  #listeners = new Set<() => void>();
  #stopped: string | null = null;
  #calls: number[] = [];
  #running = 0;
  #lingering: ReturnType<typeof setTimeout> | undefined;
  #nextId = 0;
  #banners: {
    shown: ShownBanner;
    opens: ReadonlyMap<string, string>;
    seconds: number;
    answer: (answer: BannerAnswer) => void;
    timer?: ReturnType<typeof setTimeout>;
  }[] = [];
  #marks = new Map<number, () => void>();
  #inFlight = new Set<Promise<void>>();
  #end: (() => void) | undefined;
  #watchedUntil = 0;

  constructor(host: PageToolsHost) {
    this.#host = host;
    const own = Object.entries(host.tools || {});
    // capnweb answers a target's prototype members alone, so the host's names go on a prototype
    // made for this lend
    class Lent extends PageTarget {}
    for (const [name, tool] of own) {
      if (name in PageTarget.prototype || !/^[a-z][A-Za-z0-9]*$/.test(name))
        throw new Error(`${JSON.stringify(name)} is no name for a page's own tool`);
      Object.defineProperty(Lent.prototype, name, {
        value: (...args: unknown[]) =>
          this.#call({ tool: name }, "working", () => tool.run(...args)),
      });
    }
    const help = [
      `${host.person}'s browser tab, open on this agent's page at ${location.host}, until the tab closes or they press Stop. They see each call as it runs, and no call runs while the tab is in the background.`,
      "banner.show({ title, body, buttons: [{ label, open }], seconds }) shows a notice and answers { pressed }: the label, or null and why (no answer, dismissed, off). open is a path of this app that the press also opens.",
      "getByRole(role, { name }), getByText(text), getByLabel(text) and locator(css) find one element as Playwright does (first(), nth(i), chained, { exact }). locator takes CSS alone.",
      `Then: fill(text), click(), press(key) with ${KEYS.join(", ")}, focus(), highlight({ note, seconds }), scrollIntoView(), textContent(), count(). Each waits up to { timeout } ms (5000) for the element.`,
      "open(path) shows a page of this app.",
      ...own.map(([name, tool]) => `${name}: ${tool.description}`),
      `Never matched: password, code and card fields, the parts the page keeps back, and anything outside the page's marked part. Refused: a click or a key on a link or a form that leads to another site or to sign-in or sign-out. At most ${CALLS_PER_WINDOW} calls in ${CALLS_WINDOW_MS / 1000} seconds.`,
    ].join("\n");
    this.target = new Lent({
      banner: (input) => this.#banner(input),
      run: (steps, act, options) => this.#locate(steps, act, options),
      open: (path) => this.#open(path),
      help,
    });
    // The kernel takes one line of at most 500 characters for a rule: the names, and where the
    // rest is.
    this.description = `${host.person.slice(0, 80)}'s open browser tab on this agent's page: they see each call, and none runs while the tab is in the background. banner.show({ title, body, buttons }) answers { pressed }. getByRole, getByText, getByLabel, locator(css), then fill, click, press, focus, highlight({ note }), scrollIntoView, textContent, count. open(path).${own.length > 0 ? ` And ${own.length} of the page's own.` : ""} help() says how each is called and what refuses.`;
  }

  get = (): PageToolsShown => this.#shown;
  subscribe = (changed: () => void): (() => void) => {
    this.#listeners.add(changed);
    return () => void this.#listeners.delete(changed);
  };

  /** The person pressed a button of the banner that shows (`label`), or closed it (null). */
  answerBanner(label: string | null): void {
    const banner = this.#banners[0];
    if (!banner) return;
    const open = label && banner.opens.get(label);
    this.#settleBanner(label ? { pressed: label } : { pressed: null, why: "dismissed" });
    if (open) this.#host.open(open);
  }

  /** A mark's element left the page, or the person edited what was typed. */
  unmark(id: number): void {
    this.#marks.get(id)?.();
  }

  /** The page lent this session's tools: `end` takes the lend away. A session that stopped
   *  meanwhile ends it at once. */
  lent(end: () => void): void {
    if (this.#stopped) end();
    else this.#end = end;
  }

  /** The end of the lend, in the words a later call is refused with: the lend goes, every banner
   *  answers "off", every mark goes, and the tools do nothing more. The first stop's words stay. */
  stop(why: string): void {
    if (this.#stopped) return;
    this.#stopped = why;
    this.#end?.();
    clearTimeout(this.#lingering);
    for (const end of [...this.#marks.values()]) end();
    for (const banner of this.#banners.splice(0)) {
      clearTimeout(banner.timer);
      banner.answer({ pressed: null, why: "off" });
    }
    this.#show({ banner: null, acting: null, highlights: [] });
  }

  #show(shown: Partial<PageToolsShown>): void {
    this.#shown = { ...this.#shown, ...shown };
    for (const changed of this.#listeners) changed();
  }

  /** Resolves when every call that began has ended and is written down: the page keeps the
   *  agent's context open until then, so the last rows of a lend that ends are not lost. */
  async settled(): Promise<void> {
    await Promise.all(this.#inFlight);
    // a stop that the watch makes after its act is a row too
    const watchedFor = this.#watchedUntil - performance.now();
    if (watchedFor > 0) await new Promise((resolve) => setTimeout(resolve, watchedFor));
  }

  #call<T>(row: Omit<PageToolCall, "outcome">, word: string, run: () => T): Promise<Awaited<T>> {
    const call = this.#admitted(row, word, run);
    const ended = call.then(
      () => void this.#inFlight.delete(ended),
      () => void this.#inFlight.delete(ended),
    );
    this.#inFlight.add(ended);
    return call;
  }

  /** One call: admitted or refused, shown while it runs, and written down when it ends. */
  async #admitted<T>(
    row: Omit<PageToolCall, "outcome">,
    word: string,
    run: () => T,
  ): Promise<Awaited<T>> {
    let outcome: PageToolCall["outcome"] = "failed";
    let unwritten = false;
    try {
      await this.#admit().catch((error: unknown) => {
        unwritten = error instanceof OverTheRate;
        throw error;
      });
      this.#running++;
      clearTimeout(this.#lingering);
      this.#show({ acting: word });
      try {
        const answer = await run();
        outcome = "done";
        return answer;
      } finally {
        this.#running--;
        if (!this.#running && !this.#stopped)
          this.#lingering = setTimeout(() => this.#show({ acting: null }), ACTING_LINGERS_MS);
      }
    } catch (error) {
      if (error instanceof Refusal) outcome = "refused";
      throw error;
    } finally {
      // every admitted call and every refusal but one: a call over the rate writes nothing
      if (!unwritten) this.#host.audit({ ...row, outcome });
    }
  }

  async #admit(): Promise<void> {
    if (this.#stopped) throw new Refusal(this.#stopped);
    const now = Date.now();
    this.#calls = this.#calls.filter((at) => at > now - CALLS_WINDOW_MS);
    if (this.#calls.length >= CALLS_PER_WINDOW)
      throw new OverTheRate(
        `this tab takes at most ${CALLS_PER_WINDOW} calls in ${CALLS_WINDOW_MS / 1000} seconds: wait, then call again`,
      );
    this.#calls.push(now);
    refuseInTheBackground();
    // the context may have become a jail since the lend
    const jail = jailOf(await this.#host.rules());
    // Stop may have been pressed while the rules were read
    if (this.#stopped) throw new Refusal(this.#stopped);
    if (jail) {
      this.stop(jail);
      throw new Refusal(jail);
    }
  }

  #banner(input: BannerInput): Promise<BannerAnswer> {
    return this.#call({ tool: "banner.show" }, "showing a notice", () => {
      if (!input) throw new Refusal("banner.show takes { title, body, buttons, seconds }");
      const buttons = input.buttons || [];
      if (buttons.length > BUTTONS) throw new Refusal(`a banner has at most ${BUTTONS} buttons`);
      const seconds = input.seconds ?? 60;
      if (!Number.isFinite(seconds) || seconds < 1 || seconds > 300)
        throw new Refusal("a banner shows for 1 to 300 seconds");
      if (this.#banners.length > BANNERS_WAITING)
        throw new Refusal(
          `${BANNERS_WAITING} banners already wait in this tab: wait for an answer first`,
        );
      const opens = new Map<string, string>();
      for (const button of buttons) {
        if (!bounded(button.label, LIMITS.label, "a button's label"))
          throw new Refusal("a button of a banner has a label");
        if (buttons.filter((other) => other.label === button.label).length > 1)
          throw new Refusal("two buttons of a banner have the same label");
        if (button.open) opens.set(button.label, this.#ownPath(button.open));
      }
      const shown: ShownBanner = {
        id: ++this.#nextId,
        title: bounded(input.title, LIMITS.title, "a banner's title"),
        body: bounded(input.body || "", LIMITS.body, "a banner's body"),
        buttons: buttons.map((button) => button.label),
      };
      return new Promise<BannerAnswer>((answer) => {
        this.#banners.push({ shown, opens, seconds, answer });
        if (this.#banners.length === 1) this.#showNextBanner();
      });
    });
  }

  #showNextBanner(): void {
    const banner = this.#banners[0];
    this.#show({ banner: banner ? banner.shown : null });
    if (banner)
      banner.timer = setTimeout(
        () => this.#settleBanner({ pressed: null, why: "no answer" }),
        banner.seconds * 1_000,
      );
  }

  #settleBanner(answer: BannerAnswer): void {
    const banner = this.#banners.shift();
    if (!banner) return;
    clearTimeout(banner.timer);
    banner.answer(answer);
    this.#showNextBanner();
  }

  /** A path of this app, as the host opens it: never another origin. */
  #ownPath(path: unknown): string {
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//"))
      throw new Refusal("open takes a path of this app, from its first slash");
    const address = new URL(path, location.origin);
    const refused = refusalOf(address.href);
    if (refused) throw new Refusal(`open takes a path of this app: ${refused}`);
    return address.pathname + address.search + address.hash;
  }

  #open(path: string): Promise<void> {
    return this.#call({ tool: "open" }, "opening a page", () =>
      this.#host.open(this.#ownPath(path)),
    );
  }

  #locate(steps: readonly Step[], act: Act, options: Options) {
    const selector = selectorOf(steps);
    const row = { tool: act.action, locator: selector.slice(0, LIMITS.written) };
    return this.#call(row, WORDS[act.action], () => this.#act(selector, act, options, row));
  }

  /** Finds the one element and acts on it. It looks again every 50 ms until the deadline: a page
   *  draws after its data. */
  async #act(selector: string, act: Act, options: Options, row: Omit<PageToolCall, "outcome">) {
    const timeout = options.timeout ?? 5_000;
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 30_000)
      throw new Refusal("timeout must be between 1 and 30000 ms");
    if (act.action === "fill") bounded(act.text, LIMITS.fill, "the text to fill");
    if (act.action === "press" && !KEYS.some((key) => key === act.key))
      throw new Refusal(`press takes one of ${KEYS.join(", ")}`);
    if (act.action === "highlight") {
      bounded(act.note, LIMITS.note, "a highlight's note");
      if (!Number.isFinite(act.seconds) || act.seconds < 1 || act.seconds > 60)
        throw new Refusal("a highlight shows for 1 to 60 seconds");
    }
    const deadline = performance.now() + timeout;
    for (let last = `no match (${NEVER_MATCH})`; ;) {
      const scope = this.#host.scope();
      if (!scope) throw new Refusal("this page marked no part of itself for an agent's tools");
      // what is outside the scope or kept back is absent, to `count` as to every act
      const matches = engine
        .queryLocatorSelectorAll(selector, scope)
        .filter((element) => scope.contains(element) && !keptBack(element));
      if (act.action === "count") return matches.length;
      if (matches.length > 1)
        throw new Error(`${matches.length} elements match ${selector}: narrow it, or use first()`);
      const element = matches[0];
      if (element) {
        // the wait for the element may have been long: the person must still be looking
        refuseInTheBackground();
        if (act.action === "textContent") {
          const text = readableText(element);
          if (text.length > LIMITS.read)
            throw new Refusal(`${text.length} characters: narrow the locator to read less`);
          return text;
        }
        if (!(element instanceof HTMLElement)) throw new Error("this element takes no input");
        const waits = waitOf(element);
        if (!waits) {
          this.#perform(element, act, row);
          return;
        }
        last = waits;
      }
      if (performance.now() >= deadline)
        throw new Error(`timed out after ${timeout} ms: ${act.action} ${selector}: ${last}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (this.#stopped) throw new Refusal(this.#stopped);
    }
  }

  #perform(element: HTMLElement, act: Act, row: Omit<PageToolCall, "outcome">): void {
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
    if (act.action === "fill") {
      fill(element, act.text);
      // stays until the person edits what was typed
      const end = this.#mark(element, `typed by ${this.#host.agent()}`);
      element.addEventListener("input", end, { once: true });
    } else if (act.action === "click") this.#watched(row, () => click(element));
    else if (act.action === "press") this.#watched(row, () => press(element, act.key));
    else if (act.action === "focus") element.focus();
    else if (act.action === "highlight") {
      // the note is the caller's words: the page says whose
      const agent = this.#host.agent();
      const end = this.#mark(element, act.note ? `${agent}: ${act.note}` : `${agent} points here`);
      setTimeout(end, act.seconds * 1_000);
    }
  }

  /** A click or a key, watched for where it leads (`watchAnAct`). The act is refused when what it
   *  set off was stopped before it returned; a later stop is written down as a refusal of its
   *  own. */
  #watched(row: Omit<PageToolCall, "outcome">, act: () => void): void {
    const watch = watchAnAct(() => this.#host.audit({ ...row, outcome: "refused" }));
    try {
      act();
    } finally {
      this.#watchedUntil = watch.returned();
    }
    if (watch.refused) throw new Refusal(watch.refused);
  }

  /** A ring on an element, with a note. Answers what takes it away. */
  #mark(element: Element, note: string): () => void {
    const id = ++this.#nextId;
    const end = () => {
      if (!this.#marks.delete(id)) return;
      this.#show({ highlights: this.#shown.highlights.filter((mark) => mark.id !== id) });
    };
    this.#marks.set(id, end);
    // one mark for an element: the newest
    for (const mark of this.#shown.highlights) if (mark.element === element) this.unmark(mark.id);
    this.#show({ highlights: [...this.#shown.highlights, { id, element, note }] });
    return end;
  }
}

/** What a session asks of the page that made it. */
export type PageToolsHost = {
  /** The agent's name, as the page shows it now: on "typed by" and on a highlight's note. */
  agent(): string;
  /** Who has the page open, for the description the agent reads. */
  person: string;
  /** The element the agent may act in, or null when the page marked none. */
  scope(): Element | null;
  /** Shows a path of this app. */
  open(path: string): void;
  /** Writes one call down. */
  audit(call: PageToolCall): void;
  /** The agent's context's own rules now (`rewriteRules.list(0)`): read before every call. */
  rules(): Promise<RuleRow[]>;
  /** The host's own tools, each under its name. */
  tools?: Readonly<Record<string, OwnPageTool>>;
};

/** What an element waits for before it can take input, or null when it can now. */
function waitOf(element: HTMLElement): string | null {
  if (!isElementVisible(element)) return "the element is hidden";
  if (getAriaDisabled(element) || element.matches(":disabled") || element.closest("[inert]"))
    return "the element is disabled or inert";
  return null;
}

/** What a locator is made of, off the wire: an agent's script can send anything. */
function named(text: unknown, what: string): string {
  if (typeof text !== "string" || !text)
    throw new Error(`${what} is a string with something in it`);
  if (text.length > LIMITS.part)
    throw new Error(`${what} is at most ${LIMITS.part} characters: this one has ${text.length}`);
  return text;
}

type Run = (steps: readonly Step[], act: Act, options: Options) => unknown;

/** A locator: a chain of steps, resolved again at each action. The extension's names
 *  (packages/browser-extension/src/page.ts). */
class PageLocator extends RpcTarget {
  readonly #run: Run;
  readonly #steps: readonly Step[];
  constructor(run: Run, steps: readonly Step[]) {
    super();
    this.#run = run;
    this.#steps = steps;
  }
  #chain(step: Step) {
    if (this.#steps.length >= LIMITS.parts)
      throw new Error(`a locator has at most ${LIMITS.parts} parts`);
    return new PageLocator(this.#run, [...this.#steps, step]);
  }
  locator(selector: string) {
    // `>>` would start a part of another engine (`xpath=..` leaves the scope)
    if (named(selector, "a selector").includes(">>"))
      throw new Error("locator takes one CSS selector: chain locators in place of >>");
    return this.#chain({ kind: "css", selector });
  }
  getByRole(role: string, options: RoleOptions = {}) {
    if (!/^[a-z]+$/.test(named(role, "a role")))
      throw new Error("a role is one lowercase word: button, link, tab, textbox, heading");
    return this.#chain({
      kind: "role",
      role,
      options: optionsOf(RoleOptions, options, "getByRole's options"),
    });
  }
  getByText(text: string, options: MatchOptions = {}) {
    return this.#chain({
      kind: "text",
      text: named(text, "the text to find"),
      options: optionsOf(MatchOptions, options, "getByText's options"),
    });
  }
  getByLabel(text: string, options: MatchOptions = {}) {
    return this.#chain({
      kind: "label",
      text: named(text, "a label"),
      options: optionsOf(MatchOptions, options, "getByLabel's options"),
    });
  }
  nth(index: number) {
    if (!Number.isInteger(index) || index < 0) throw new Error("nth takes a nonnegative integer");
    return this.#chain({ kind: "nth", index });
  }
  first() {
    return this.nth(0);
  }
  fill(text: string, options: Options = {}) {
    return this.#run(this.#steps, { action: "fill", text }, options);
  }
  click(options: Options = {}) {
    return this.#run(this.#steps, { action: "click" }, options);
  }
  press(key: string, options: Options = {}) {
    return this.#run(this.#steps, { action: "press", key }, options);
  }
  focus(options: Options = {}) {
    return this.#run(this.#steps, { action: "focus" }, options);
  }
  highlight(mark?: { note?: string; seconds?: number; timeout?: number }) {
    return this.#run(
      this.#steps,
      { action: "highlight", note: mark?.note || "", seconds: mark?.seconds ?? 5 },
      { timeout: mark?.timeout },
    );
  }
  scrollIntoView(options: Options = {}) {
    return this.#run(this.#steps, { action: "scrollIntoView" }, options);
  }
  textContent(options: Options = {}) {
    return this.#run(this.#steps, { action: "textContent" }, options);
  }
  count() {
    return this.#run(this.#steps, { action: "count" }, {});
  }
}

class BannerTarget extends RpcTarget {
  readonly #show: (input: BannerInput) => Promise<BannerAnswer>;
  constructor(show: (input: BannerInput) => Promise<BannerAnswer>) {
    super();
    this.#show = show;
  }
  show(input: BannerInput) {
    return this.#show(input);
  }
}

/** What the agent calls: the page's banner, its locators and its own paths. */
export class PageTarget extends RpcTarget {
  readonly #banner: BannerTarget;
  readonly #root: PageLocator;
  readonly #open: (path: string) => Promise<void>;
  readonly #help: string;
  constructor(parts: {
    banner: (input: BannerInput) => Promise<BannerAnswer>;
    run: Run;
    open: (path: string) => Promise<void>;
    help: string;
  }) {
    super();
    this.#banner = new BannerTarget(parts.banner);
    this.#root = new PageLocator(parts.run, []);
    this.#open = parts.open;
    this.#help = parts.help;
  }
  /** How each tool is called, the host's own among them: more than a rule's one line holds. It
   *  does nothing in the page, so it shows nothing and writes no row. */
  help() {
    return this.#help;
  }
  // a getter: capnweb answers prototype members alone
  get banner() {
    return this.#banner;
  }
  locator(selector: string) {
    return this.#root.locator(selector);
  }
  getByRole(role: string, options: RoleOptions = {}) {
    return this.#root.getByRole(role, options);
  }
  getByText(text: string, options: MatchOptions = {}) {
    return this.#root.getByText(text, options);
  }
  getByLabel(text: string, options: MatchOptions = {}) {
    return this.#root.getByLabel(text, options);
  }
  open(path: string) {
    return this.#open(path);
  }
}

/** One row of a context's `rewriteRules.list()`, as far as the lender reads it. */
export type RuleRow = { match: string; target: string | null };

/** WHY NO PAGE LENDS TO A CONTEXT, or null when one may, from the context's own rows
 *  (`rewriteRules.list(0)`). A page lends only where the agent's scripts run HERE with the
 *  kernel's own `run` and `cd`: then the agent holds the mind's whole reach already, and a
 *  function in a member's tab adds no authority.
 *
 *  A context nobody restricted lists both as implicit rows, `itx.run ⇒ itx.builtins.run` and
 *  `itx.cd ⇒ itx.builtins.cd` (core/itx/src/context/itx-expression-rewriting.ts
 *  `describeRewriteRules`, from the names of `BUILT_IN_ROOT_DESCRIPTIONS`). A jailed agent does
 *  not: a mind's config sends its scripts to a jail with a row of its own,
 *  `itx.run ⇒ itx.cd("<jail>").run`, and the jail's table starts with the bare `itx ⇒ null`, under
 *  which nothing is implicit (core/itx/src/context/jail-rows-reach.test.ts says the form). A list
 *  that cannot be read lends nothing either. lint/page-tools-jail-rows.test.ts holds this rule to
 *  the kernel's own list of each form. */
export function jailOf(rows: readonly RuleRow[]): string | null {
  const kernels = (name: string) =>
    rows.some((row) => row.match === `itx.${name}` && row.target === `itx.builtins.${name}`);
  return kernels("run") && kernels("cd")
    ? null
    : "this agent is jailed (its scripts do not run in its own context with the mind's whole reach): it holds less than a member, so no page lends it tools";
}

/** The agent's context, as far as the lender calls it: `itx.cd(path)`. */
export type LendingContext = {
  /** `depth` 0: the context's own rows and the kernel's implicit ones. */
  rewriteRules: { list(depth: number): PromiseLike<RuleRow[]> };
  provide(
    match: string,
    target: unknown,
    options: { description: string },
  ): PromiseLike<{ [Symbol.dispose](): void }>;
  append(event: { type: string; payload: PageToolCall }): PromiseLike<unknown>;
};

/** The person's part of the lent name: letters and digits of their address before the `@`, as the
 *  browser extension names a person, else of their actor id. */
export function personSegment(principal: { actor: string; email?: string }): string {
  const letters = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
  return letters((principal.email || "").split("@")[0]!) || letters(principal.actor) || "member";
}

/** LENDS A SESSION'S TOOLS AT THE AGENT'S CONTEXT, unless the context is jailed. Answers why it
 *  did not lend, or null when it did. The session ends the lend when it stops. */
export async function lendPageTools(
  context: LendingContext,
  person: string,
  session: PageToolsSession,
): Promise<string | null> {
  const jail = jailOf(await context.rewriteRules.list(0));
  if (jail) {
    session.stop(jail);
    return jail;
  }
  // New at every lend, and long enough that no two lends share it: the kernel sends a call in
  // flight again to a newer lend of the SAME name. 32 symbols, so a byte's low five bits pick one
  // with no bias.
  const tab = Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) =>
    "abcdefghijklmnopqrstuvwxyz234567".charAt(byte & 31),
  ).join("");
  const handle = await context.provide(`itx.page.${person}.${tab}`, session.target, {
    description: session.description,
  });
  session.lent(() => handle[Symbol.dispose]());
  return null;
}
