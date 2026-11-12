// THE HOST SIDE of a kind's chat view: the page that holds an agent's context puts the kind's view
// in a sandboxed frame (frame.tsx says why), feeds it the agent's live log, and answers its verbs
// for that one agent. The page owns the live read, the URL state and the verbs:
//
//   const { link, loaded } = useAgentKindViewLink("agent-kinds/echo.ts", source);
//   const log = useIterateContext(loaded && agent, { consumes: ["*", ...ephemeralEvents] });
//   <AgentKindViewFrame link={link} frameScript={url} inputs={{ path, events: log.events, … }}
//     verbs={{ message, append, fileUrl, setState }} />
//
// The Agents app's New agent loads each kind in a frame no one sees (`AgentKindHiddenFrame`), for
// the choices it reports (`newAgent`) and the events that start one (`link.startEvents`).
import { createElement, useEffect, useMemo, useSyncExternalStore } from "react";
import { newMessagePortRpcSession, RpcTarget, type RpcStub } from "capnweb";
import {
  AGENT_KIND_VIEW_READY,
  updateBetween,
  type AgentKindViewFrameApi,
  type AgentKindViewHello,
  type AgentKindViewHostApi,
  type AgentKindViewInputs,
  type AgentKindViewLoaded,
} from "./bridge.ts";

/** What the frame may do, all of it to the one agent the page shows. */
export type AgentKindViewVerbs = Omit<AgentKindViewHostApi, "loaded">;

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

  /** The events that start a new agent of this kind, from the kind's own `newAgent.start`. */
  async startEvents(input: Parameters<AgentKindViewFrameApi["startEvents"]>[0]) {
    if (!this.#frame) throw new Error(`${this.name} hasn't loaded`);
    return await this.#frame.startEvents(input);
  }

  /** The kind's line about a New agent choice as typed (`newAgent.describe`), or null. */
  async describe(input: Parameters<AgentKindViewFrameApi["describe"]>[0]) {
    if (!this.#frame) return null;
    return await this.#frame.describe(input);
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

/** Links for several kind files at once, and what each frame reported, in the same order. */
export function useAgentKindViewLinks(files: { name: string; source: string }[]) {
  const key = JSON.stringify(files);
  const links = useMemo(
    () =>
      (JSON.parse(key) as typeof files).map(
        ({ name, source }) => new AgentKindViewLink(name, source),
      ),
    [key],
  );
  const store = useMemo(() => {
    let snapshot: (AgentKindViewLoaded | undefined)[] = links.map((link) => link.loaded());
    return {
      subscribe: (listener: () => void) => {
        const unsubscribe = links.map((link) => link.subscribe(listener));
        return () => unsubscribe.forEach((stop) => stop());
      },
      get: () => {
        const next = links.map((link) => link.loaded());
        if (next.some((loaded, index) => loaded !== snapshot[index])) snapshot = next;
        return snapshot;
      },
    };
  }, [links]);
  const loaded = useSyncExternalStore(store.subscribe, store.get, store.get);
  return { links, loaded };
}

/** A kind's frame that shows nothing: for what it reports and answers, not for a chat. */
export function AgentKindHiddenFrame({
  link,
  frameScript,
}: {
  link: AgentKindViewLink;
  frameScript: string;
}) {
  const srcDoc = useMemo(() => frameDocument(frameScript), [frameScript]);
  return createElement("iframe", {
    ref: link.attach,
    title: link.name,
    sandbox: "allow-scripts",
    srcDoc,
    hidden: true,
  });
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
    // scripts, and links that open a tab or download a file; never the page's origin
    sandbox: "allow-scripts allow-popups allow-downloads",
    srcDoc,
    className: "min-h-0 w-full flex-1 border-0",
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
