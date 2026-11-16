// One live state in the processors panel — the core reduce's under the name `core`, a hosted
// facet's under its own — Pretty (fields, pretty-state.tsx; the core reduce read as its tables) or
// Raw (YAML), as the panel's toggle says.
import { CorePrettyState, PrettyFields } from "./pretty-state.tsx";
import type { LiveStateView } from "./types.tsx";
import { SerializedObjectCodeBlock } from "#/components/code-block.tsx";
import { LogReading } from "#/components/virtual-log/read-progress.tsx";

export function LiveStateValue({
  state,
  view,
  core,
}: {
  state: LiveStateView;
  view: "pretty" | "raw";
  /** The core reduce: Pretty reads it as its tables. */
  core: boolean;
}) {
  if (state.status === "error")
    return (
      <p data-type="error" className="text-xs text-destructive">
        Live state unavailable: {state.error}
      </p>
    );
  if (state.value === undefined)
    return <LogReading label="Reading the live state" className="font-readme text-xs" />;
  if (view === "raw")
    return (
      <SerializedObjectCodeBlock data={state.value} showToggle={false} className="max-h-[28rem]" />
    );
  return core ? <CorePrettyState state={state.value} /> : <PrettyFields value={state.value} />;
}
