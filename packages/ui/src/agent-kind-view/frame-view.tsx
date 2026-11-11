// The frame's React tree (frame.ts starts it): the kind's view with AgentChat-shaped props rebuilt
// from what the host sent, or the Events tab when there is no view, it failed to load, or it threw.
import { Component, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { RpcStub } from "capnweb";
import { AgentShell } from "../components/agent-chat/agent-shell.tsx";
import { Spinner } from "../components/ui/spinner.tsx";
import type { AgentKindViewHostApi, AgentKindViewInputs } from "./bridge.ts";
import type { InputsStore, LoadedView } from "./frame.ts";
import type { AgentKindViewProps } from "./types.ts";

type Host = RpcStub<AgentKindViewHostApi>;

export function FrameView({
  inputs,
  host,
  view,
}: {
  inputs: InputsStore;
  host: Host;
  view: LoadedView;
}) {
  const held = useSyncExternalStore(inputs.subscribe, inputs.get);
  const props = useMemo(() => held && propsOf(held, host), [held, host]);
  if (!props)
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Spinner className="size-4" /> Connecting…
      </div>
    );
  // the shell takes the view's props: its state is the page's search, which the shell reads whole
  const shell = props as unknown as Parameters<typeof AgentShell>[0];
  if ("error" in view) return <AgentShell {...shell} error={view.error} />;
  if (!view.component) return <AgentShell {...shell} />;
  return (
    <ViewBoundary props={props}>
      <view.component {...props} />
    </ViewBoundary>
  );
}

/** AgentChat's props from what the host sent, its verbs calls back over the port. */
function propsOf(held: AgentKindViewInputs, host: Host): AgentKindViewProps {
  return {
    path: held.path,
    context: {
      events: held.events,
      caughtUp: held.caughtUp,
      error: held.error,
      head: held.head,
      older: held.older ? { ...held.older, loadOlder: () => void host.loadOlder() } : undefined,
      processors: held.processors,
      presence: held.presence,
      liveState: held.liveState,
    },
    error: held.hostError,
    state: held.state,
    onStateChange: (patch) => void host.setState(patch),
    onMessage: async (input) => await host.message(input),
    onAppend: async (events) => await host.append(events),
    signedUrl: async (path) => await host.fileUrl(path),
  };
}

/** A view that throws while rendering leaves the Events tab, saying why. */
class ViewBoundary extends Component<
  { props: AgentKindViewProps; children: ReactNode },
  { error: string | null }
> {
  override state: { error: string | null } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  override render() {
    if (this.state.error)
      return <AgentShell {...this.props.props} error={`The view failed: ${this.state.error}`} />;
    return this.props.children;
  }
}
