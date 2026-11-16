// WHAT AN AGENT'S VIEW SHOWS WHILE ITS LOG IS READ, in the place the view's own parts will have, so
// that nothing moves when they come: the line stands where the first row will stand, and a page
// that has no view yet draws the strip the view will draw.
import { AgentStrip } from "./agent-strip.tsx";
import { LogReading } from "#/components/virtual-log/read-progress.tsx";

/** The chat's loading line, where its first row will stand: under the feed's own 8 px start, with
 *  a row's own 8 px over it. `progress`: how far the older pages have come, from 0 to 1. */
export function ChatReading({ progress }: { progress?: number }) {
  return <LogReading label="Reading the log" progress={progress} className="pt-4 pb-2" />;
}

/** THE LOADING STATE OF AN AGENT'S VIEW BEFORE THERE IS A VIEW: what a page shows while it does not
 *  know yet which view the agent has, or while that view's own document loads. It is what the
 *  view's shell then draws in the same place: the strip, which cannot be pressed yet and says no
 *  count, and the chat's loading line in the feed's column. */
export function AgentReading() {
  return (
    <>
      <div inert>
        <AgentStrip
          status={undefined}
          view={undefined}
          hasChat
          tabs
          held={undefined}
          wholeLogHeld
          onStateChange={nothingToChange}
        />
      </div>
      <div className="mx-auto w-full max-w-3xl px-4 md:px-6">
        <ChatReading />
      </div>
    </>
  );
}

/** The strip of a view that is not there yet has no state to change. */
function nothingToChange() {}
