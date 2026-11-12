// What the Events tab's inspector shows for an event of the agent loop (iterate/agents
// contract.ts), above the event as JSON: the words themselves, whole. The rows of the log are the
// context view's own, and the same for every type.
import type { EventInspectors } from "#/components/context-view/types.tsx";
import { record, str } from "#/components/context-view/payload-readers.ts";

/** The role a context item was added as (the model's conversation has four), as plain text. */
const role = (name: string) => <span className="text-xs text-muted-foreground">{name}</span>;

/** Prose as the model saw or said it, whole, wrapped — never a sideways scroll. */
const prose = (text: string) => <p className="text-sm whitespace-pre-wrap break-words">{text}</p>;

/** The inspector's rich bodies: the words themselves, whole. */
export const agentEventInspectors: EventInspectors = {
  "events.iterate.com/agent/context-added": (e) => {
    const p = record(e.payload);
    return (
      <div className="flex flex-col gap-2">
        <div>{role(str(p.role, "?"))}</div>
        {prose(str(p.content))}
      </div>
    );
  },
  "events.iterate.com/agent/web-message-sent": (e) => prose(str(record(e.payload).message)),
  "events.iterate.com/agent/llm-request-settled": (e) => {
    const result = record(record(e.payload).result);
    if (result.status === "succeeded") return prose(str(result.text));
    if (result.status === "failed")
      return (
        <div className="flex flex-col gap-2">
          <p data-type="error" className="text-sm text-destructive">
            {str(result.errorMessage)}
          </p>
          {result.partialText ? prose(str(result.partialText)) : null}
        </div>
      );
    return result.partialText ? prose(str(result.partialText)) : null;
  },
};
