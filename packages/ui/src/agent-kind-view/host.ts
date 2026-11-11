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

/** The frame's page: the host page's own stylesheets (its theme and every class iterate's parts
 *  use), a root that fills it, and the frame's script. */
function frameDocument(frameScript: string): string {
  // a server render has no document: the frame is the browser's
  if (!globalThis.document) return "";
  const styles = [...document.querySelectorAll<HTMLElement>('link[rel="stylesheet"], style')]
    .map((element) =>
      element instanceof HTMLLinkElement
        ? `<link rel="stylesheet" href="${attribute(element.href)}">`
        : `<style>${element.textContent || ""}</style>`,
    )
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
