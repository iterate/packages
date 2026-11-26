// The frame's React tree (frame.ts starts it): the kind's view with AgentChat-shaped props rebuilt
// from what the host sent, or the Events tab when there is no view, it failed to load, or it threw.
import { Component, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { RpcStub } from "capnweb";
import { AgentReading } from "../components/agent-chat/agent-reading.tsx";
import { AgentShell } from "../components/agent-chat/agent-shell.tsx";
import { AgentTabsInHeader } from "../components/agent-chat/agent-shell-contexts.ts";
import { OLDER_FAILED } from "../components/virtual-log/older-pages.ts";
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
  // what the frame itself reported of its kind file, which the host says back as its own error
  const kindFileError = "error" in view ? view.error : undefined;
  // the verbs are the host's alone: each update of what it sent keeps them, so the view's rows
  // stay memoised and an attachment keeps its signed URL
  const verbs = useMemo(() => verbsOf(host), [host]);
  const props = useMemo(
    () => held && propsOf(held, host, verbs, kindFileError),
    [held, host, verbs, kindFileError],
  );
  // the page's header has the tabs: every shell in the frame draws none
  return (
    <AgentTabsInHeader value={Boolean(held?.tabsInHeader)}>
      <FrameBody props={props} view={view} />
    </AgentTabsInHeader>
  );
}

function FrameBody({ props, view }: { props: AgentKindViewProps | undefined; view: LoadedView }) {
  // before the host's first word: the loading state the view's own feed goes on with
  if (!props) return <AgentReading />;
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

/** AgentChat's props from what the host sent, its verbs calls back over the port. A read that
 *  failed (its own error, or a context the host could not open) stands in its error: the view's
 *  `older` says so, and its feed asks for no page and says nothing of the log. A kind file that
 *  failed to load (`kindFileError`) is no failed read: the log pages on under the Events tab. */
function propsOf(
  held: AgentKindViewInputs,
  host: Host,
  verbs: ReturnType<typeof verbsOf>,
  kindFileError: string | undefined,
): AgentKindViewProps {
  const readFailed = Boolean(held.error || (held.hostError && held.hostError !== kindFileError));
  const older = held.older && { ...held.older, loadOlder: () => void host.loadOlder() };
  return {
    path: held.path,
    context: {
      events: held.events,
      caughtUp: held.caughtUp,
      error: held.error,
      head: held.head,
      older: readFailed ? OLDER_FAILED : older || undefined,
      processors: held.processors,
      presence: held.presence,
      liveState: held.liveState,
      version: held.version,
    },
    error: held.hostError,
    state: held.state,
    ...verbs,
    me: held.me,
    presence: held.presenceOn,
  };
}

/** What the view's props call back over the port. */
function verbsOf(
  host: Host,
): Pick<
  AgentKindViewProps,
  "onStateChange" | "onMessage" | "onAppend" | "signedUrl" | "storeFiles" | "widgetCalls"
> {
  return {
    onStateChange: (patch) => void host.setState(patch),
    onMessage: async (input) => await host.message(input),
    onAppend: async (events) => await host.append(events),
    signedUrl: async (path) => await host.fileUrl(path),
    storeFiles: async (files, key) => await host.storeFiles(files, key),
    widgetCalls: {
      callTool: async (call) => await host.callTool(call),
      readResource: async (read) => await host.readResource(read),
    },
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
