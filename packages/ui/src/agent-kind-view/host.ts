// THE HOST SIDE of a kind's chat view: the page that holds an agent's context puts the kind's view
// in a sandboxed frame (frame.tsx says why), feeds it the agent's live log, and answers its verbs
// for that one agent. The page owns the live read, the URL state and the verbs:
//
//   const { link, loaded } = useAgentKindViewLink("agent-kinds/echo.ts", source);
//   const log = useIterateContext(loaded && agent, { consumes: ["*", ...ephemeralEvents] });
//   <AgentKindViewFrame link={link} frameScript={url} inputs={{ path, events: log.events, … }}
//     verbs={{ message, append, fileUrl, setState }} />
import { createElement, useEffect, useMemo, useSyncExternalStore } from "react";
import { newMessagePortRpcSession, RpcTarget, type RpcStub } from "capnweb";
import { z } from "zod";
import {
  AGENT_KIND_VIEW_READY,
  updateBetween,
  type AgentKindViewFrameApi,
  type AgentKindViewHello,
  type AgentKindViewHostApi,
  type AgentKindViewInputs,
  type AgentKindViewLoaded,
} from "./bridge.ts";

/** What the frame may do, all of it to the one agent the page shows. A page that does not give
 *  `storeFiles` refuses a message with files that a kind appends itself. */
export type AgentKindViewVerbs = Omit<AgentKindViewHostApi, "loaded" | "storeFiles"> &
  Partial<Pick<AgentKindViewHostApi, "storeFiles">>;

/** One frame's link to the page: its handshake, its session, what it reported, what it holds. */
export class AgentKindViewLink {
  readonly name: string;
  readonly source: string | null;
  /** The page's verbs as of its last render. */
  verbs: AgentKindViewVerbs | undefined;
  #loaded: AgentKindViewLoaded | undefined;
  #listeners = new Set<() => void>();
  #frame: RpcStub<AgentKindViewFrameApi> | undefined;
  #sent: AgentKindViewInputs | undefined;
  #latest: AgentKindViewInputs | undefined;

  constructor(name: string, source: string | null) {
    this.name = name;
    this.source = source;
  }

  loaded = () => this.#loaded;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  };

  /** Sends the frame what changed since it last heard. */
  push(inputs: AgentKindViewInputs) {
    this.#latest = inputs;
    if (!this.#frame) return;
    const update = updateBetween(this.#sent, inputs);
    this.#sent = inputs;
    if (update) void this.#frame.update(update);
  }

  /** The iframe's ref: answers its readiness with the hello and a port, each time it loads. */
  attach = (iframe: HTMLIFrameElement | null) => {
    if (!iframe) return;
    const onReady = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow || event.data?.type !== AGENT_KIND_VIEW_READY)
        return;
      this.#close();
      const channel = new MessageChannel();
      const hello: AgentKindViewHello = {
        type: "iterate/agent-kind-view",
        name: this.name,
        source: this.source,
      };
      // the frame's origin is opaque: "*" is the only name it has
      iframe.contentWindow?.postMessage(hello, "*", [channel.port2]);
      this.#frame = newMessagePortRpcSession<AgentKindViewFrameApi>(
        channel.port1,
        new HostTarget(this),
      );
      if (this.#latest) this.push(this.#latest);
    };
    window.addEventListener("message", onReady);
    return () => {
      window.removeEventListener("message", onReady);
      this.#close();
    };
  };

  /** The kind's `newAgent.start(input)`, run in the frame: the events that start an agent of the
   *  kind. Refused until the frame has said it is ready. */
  async start(input: Parameters<AgentKindViewFrameApi["start"]>[0]): Promise<unknown[]> {
    if (!this.#frame) throw new Error(`${this.name} has not loaded yet`);
    // the frame runs a config repo's code: what it answers is checked to be a list here
    return z.array(z.unknown()).parse(await this.#frame.start(input));
  }

  setLoaded(result: AgentKindViewLoaded) {
    this.#loaded = result;
    for (const listener of this.#listeners) listener();
  }

  #close() {
    this.#frame?.[Symbol.dispose]();
    this.#frame = undefined;
    this.#sent = undefined;
  }
}

/** The page's side of the session: the frame's report, and its verbs, passed to the page's. */
class HostTarget extends RpcTarget implements AgentKindViewHostApi {
  #link: AgentKindViewLink;
  constructor(link: AgentKindViewLink) {
    super();
    this.#link = link;
  }
  #verbs(): AgentKindViewVerbs {
    if (!this.#link.verbs) throw new Error("the page is not showing this agent");
    return this.#link.verbs;
  }
  loaded(result: Parameters<AgentKindViewHostApi["loaded"]>[0]) {
    this.#link.setLoaded(result);
  }
  message(input: Parameters<AgentKindViewHostApi["message"]>[0]) {
    return this.#verbs().message(input);
  }
  append(events: unknown[]) {
    return this.#verbs().append(events);
  }
  fileUrl(path: string) {
    return this.#verbs().fileUrl(path);
  }
  storeFiles(...[files, key]: Parameters<AgentKindViewHostApi["storeFiles"]>) {
    const { storeFiles } = this.#verbs();
    if (!storeFiles) throw new Error("This page cannot store files for this agent.");
    return storeFiles(files, key);
  }
  setState(patch: Parameters<AgentKindViewHostApi["setState"]>[0]) {
    this.#verbs().setState(patch);
  }
  loadOlder() {
    this.#verbs().loadOlder();
  }
}

/** A link for the kind file `name` (its `source`, or `null` for a kind without one), and what its
 *  frame reported once it read the file: until then, `undefined`. */
export function useAgentKindViewLink(name: string, source: string | null) {
  const link = useMemo(() => new AgentKindViewLink(name, source), [name, source]);
  const loaded = useSyncExternalStore(link.subscribe, link.loaded, () => undefined);
  return { link, loaded };
}

export function AgentKindViewFrame({
  link,
  frameScript,
  inputs,
  verbs,
}: {
  link: AgentKindViewLink;
  /** The frame's script (`startAgentKindViewFrame()`, bundled): a URL the page serves. */
  frameScript: string;
  inputs: AgentKindViewInputs;
  verbs: AgentKindViewVerbs;
}) {
  // the newest verbs answer the frame: they close over the page's latest render
  link.verbs = verbs;
  // the frame is another window: what the page renders is sent to it, as it changes
  useEffect(() => link.push(inputs), [link, inputs]);
  const srcDoc = useMemo(() => frameDocument(frameScript), [frameScript]);
  return createElement("iframe", {
    ref: link.attach,
    title: link.name,
    // scripts, and links that open a tab or download a file; never the page's origin. A tab that
    // a link opens escapes the sandbox: it is an ordinary page of the link's own origin, which the
    // view cannot read. A sandboxed tab would have no origin, so no sign-in, no passkey and, without
    // `allow-forms`, no form: the vault's secret form could not be sent from it.
    sandbox: "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads",
    srcDoc,
    className: "min-h-0 w-full flex-1 border-0",
  });
}

/** A FRAME THAT ONLY LOADS A KIND FILE, drawn nowhere: what it reports (`link.loaded()`: the
 *  kind's `newAgent`) and its `start` (`link.start`), for the Dash's New agent. It is sent no
 *  inputs, and has no verbs: it cannot read or change any agent. */
export function AgentKindStarterFrame({
  link,
  frameScript,
}: {
  link: AgentKindViewLink;
  frameScript: string;
}) {
  link.verbs = undefined;
  const srcDoc = useMemo(() => frameDocument(frameScript), [frameScript]);
  return createElement("iframe", {
    ref: link.attach,
    title: link.name,
    sandbox: "allow-scripts",
    srcDoc,
    hidden: true,
    "aria-hidden": true,
    tabIndex: -1,
  });
}

/** WHETHER THE FRAME CARRIES A `<style>` OF THE PAGE. Not one that CodeMirror made: an editor
 *  writes its themes into its document as rules for class names it generates by counting
 *  (`.ͼ1`, `.ͼ2`, …). The frame's own editors count from one again, for other rules, so the
 *  page's rules would land on the wrong classes there: a composer in a fixed-width font with the
 *  editor's default dotted focus ring. The frame's editors write their own. */
export const frameCarriesStyle = (text: string) => !text.includes("\u037c");

/** A STYLE SHEET THAT THE PAGE LINKS, AS THE FRAME CARRIES IT. The frame has no sign-in: a request
 *  from it is answered as nobody's. So a sheet on the page's own host (a mind's theme, an app's own
 *  sheet), which is behind the app's guard, would come back 401 there, and the view would be drawn
 *  without the mind's theme. Such a sheet goes as TEXT: the rules that the page has loaded. A sheet
 *  of another host (this package's, on a module server) is public, large and cached, and stays a
 *  link. `rules` is null when the page cannot read the sheet (it has not loaded yet): then the
 *  link, which is what the frame had before. A rule's own `url()` is then read from the page's
 *  address, not from the sheet's. */
export function frameSheet(
  sheet: { href: string; media: string; rules: string[] | null },
  pageOrigin: string,
): string {
  const media = sheet.media ? ` media="${attribute(sheet.media)}"` : "";
  if (!sheet.rules || new URL(sheet.href).origin !== pageOrigin)
    return `<link rel="stylesheet" href="${attribute(sheet.href)}"${media}>`;
  return `<style${media}>${styleText(sheet.rules.join("\n"))}</style>`;
}

/** CSS as the text of a `<style>` element: no `</` in it ends the element early. In CSS a
 *  backslash before the slash is the same slash. */
const styleText = (css: string) => css.replaceAll("</", "<\\/");

/** The rules of a sheet that the page has loaded, each as text, or null when the page may not
 *  read them: a sheet that is still loading has none, and one of another host refuses. */
function rulesOf(sheet: CSSStyleSheet | null): string[] | null {
  try {
    return sheet && [...sheet.cssRules].map((rule) => rule.cssText);
  } catch {
    return null;
  }
}

/** The frame's page: the host page's own stylesheets (its theme and every class iterate's parts
 *  use), a root that fills it, and the frame's script. */
function frameDocument(frameScript: string): string {
  // a server render has no document: the frame is the browser's
  if (!globalThis.document) return "";
  const styles = [...document.querySelectorAll<HTMLElement>('link[rel="stylesheet"], style')]
    .flatMap((element) => {
      if (element instanceof HTMLLinkElement)
        return [
          frameSheet(
            { href: element.href, media: element.media, rules: rulesOf(element.sheet) },
            location.origin,
          ),
        ];
      const text = element.textContent || "";
      return frameCarriesStyle(text) ? [`<style>${styleText(text)}</style>`] : [];
    })
    .join("\n");
  return `<!doctype html>
<html class="${attribute(document.documentElement.className)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${styles}
</head>
<body class="${attribute(document.body.className)}" style="margin:0">
<div id="root" style="height:100vh;display:flex;flex-direction:column"></div>
<script src="${attribute(new URL(frameScript, location.href).href)}"></script>
</body>
</html>`;
}

function attribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
