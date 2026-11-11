// THE FRAME a kind's chat view runs in: a sandboxed iframe with an opaque origin and none of the
// page's cookies (host.ts makes it). View code comes from a config repo any member, or any
// member's agent, can commit to; in the page itself it would run as the viewer, in every mind
// they belong to. Here it holds only what the host hands over for one agent.
//
// `startAgentKindViewFrame()` is the frame's whole script: it says it is ready, takes the host's hello
// (the kind file and a port), loads the file (load.ts), tells the host what to read
// (`ephemeralEvents`), and renders `view(kit)` with AgentChat-shaped props rebuilt from the bridge's
// updates. With no kind file, or one that fails, it shows the Events tab.
import { createElement, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { newMessagePortRpcSession, RpcTarget } from "capnweb";
import {
  applyUpdate,
  AGENT_KIND_VIEW_READY,
  type AgentKindViewFrameApi,
  type AgentKindViewHello,
  type AgentKindViewHostApi,
  type AgentKindViewInputs,
  type AgentKindViewUpdate,
} from "./bridge.ts";
import { FrameView } from "./frame-view.tsx";
import { agentKindViewKit } from "./kit.ts";
import { importAgentKind } from "./load.ts";
import type { AgentKindNewAgent, AgentKindViewProps } from "./types.ts";

export function startAgentKindViewFrame(root: HTMLElement) {
  const onHello = (event: MessageEvent) => {
    const hello = event.data as AgentKindViewHello | undefined;
    if (event.source !== window.parent || hello?.type !== "iterate/agent-kind-view") return;
    const port = event.ports[0];
    if (!port) return;
    window.removeEventListener("message", onHello);
    void open(hello, port, root);
  };
  window.addEventListener("message", onHello);
  // the parent's origin is the app's, which an opaque origin cannot name: any parent will do, and
  // the readiness says nothing
  window.parent.postMessage({ type: AGENT_KIND_VIEW_READY }, "*");
}

async function open(hello: AgentKindViewHello, port: MessagePort, root: HTMLElement) {
  const inputs = new InputsStore();
  const loading = viewOf(hello);
  const host = newMessagePortRpcSession<AgentKindViewHostApi>(
    port,
    new FrameTarget(inputs, loading),
  );
  const view = await loading;
  void host.loaded(
    "error" in view
      ? { error: view.error }
      : view.component
        ? {
            ephemeralEvents: view.ephemeralEvents,
            ...(view.newAgent && {
              newAgent: { choices: view.newAgent.choices, fields: view.newAgent.fields },
            }),
          }
        : { none: true },
  );
  createRoot(root).render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(FrameView, { inputs, host, view }),
    ),
  );
}

/** The kind's component, or why there is none. */
export type LoadedView =
  | {
      component: ComponentType<AgentKindViewProps>;
      ephemeralEvents: string[];
      newAgent: AgentKindNewAgent | undefined;
    }
  | { component: null }
  | { error: string };

async function viewOf({ name, source }: AgentKindViewHello): Promise<LoadedView> {
  if (!source) return { component: null };
  try {
    const kind = await importAgentKind(source, name);
    return {
      component: kind.view(agentKindViewKit),
      ephemeralEvents: kind.ephemeralEvents || [],
      newAgent: kind.newAgent,
    };
  } catch (error) {
    return { error: `${name}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** What the host last sent, for React to read. */
export class InputsStore {
  #held: AgentKindViewInputs | undefined;
  #listeners = new Set<() => void>();
  get = () => this.#held;
  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => void this.#listeners.delete(listener);
  };
  apply(update: AgentKindViewUpdate) {
    this.#held = applyUpdate(this.#held, update);
    // the page's theme is the frame's
    document.documentElement.className = this.#held.documentClass;
    for (const listener of this.#listeners) listener();
  }
}

class FrameTarget extends RpcTarget implements AgentKindViewFrameApi {
  #inputs: InputsStore;
  #view: Promise<LoadedView>;
  constructor(inputs: InputsStore, view: Promise<LoadedView>) {
    super();
    this.#inputs = inputs;
    this.#view = view;
  }
  update(update: Parameters<AgentKindViewFrameApi["update"]>[0]) {
    this.#inputs.apply(update);
  }
  async startEvents(input: Parameters<AgentKindViewFrameApi["startEvents"]>[0]) {
    const view = await this.#view;
    const newAgent = "newAgent" in view ? view.newAgent : undefined;
    if (!newAgent) throw new Error("this kind starts no new agents");
    return newAgent.start(input);
  }
}
