// cloud/alchemy.ts — WHAT A RUN READS OF ALCHEMY: its CLI prints one JSON record a line with
// `--log-format json` (alchemy 2.0.0-beta.85 src/Util/LogRecord.ts), and a record of
// `kind: "event"` carries one event of its engine (src/Events.ts). Each event becomes one
// `cloud/alchemy-reported`, and the deployment's processor folds them into the run's resources
// here. A record of another kind is a text line of the alchemy step. Only the fields the fold reads
// are parsed; no copy of Alchemy's union, and no dependency on alchemy. Browser-safe: zod only.
import { z } from "zod";
import { AlchemyEvent, type Resource } from "./records.ts";

/** What one line of the alchemy step's output is: an event of Alchemy's, a text line, or nothing
 *  worth keeping (a record that says nothing). A line that is not a record is text as it stands. */
export function readAlchemyLine(line: string): { event: AlchemyEvent } | { text: string } | null {
  if (!line.startsWith("{")) return { text: line };
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { text: line };
  }
  const record = LogRecord.safeParse(parsed);
  if (!record.success) return { text: line };
  const { kind, level, data } = record.data;
  if (kind === "event") {
    const event = AlchemyEvent.safeParse(data);
    return event.success ? { event: event.data } : { text: line };
  }
  if (kind === "run") return null;
  const text = TextData.safeParse(data);
  if (!text.success) return { text: line };
  const said = text.data.message || text.data.text || "";
  if (!said) return null;
  return { text: level === "error" || level === "warn" ? `${level}: ${said}` : said };
}

/** `resources` after `event`: a resource the plan starts on gets its row, a planned one its action, a status changes its row
 *  (and its note, to the status's message), and a note changes the note. Events of other types leave the list as it is. */
export function foldAlchemyEvent(resources: Resource[], event: AlchemyEvent): Resource[] {
  // the plan names each resource when it starts to diff it, and its action when it is done
  const planning = PlanStarted.safeParse(event);
  if (planning.success) {
    const { fqn, logicalId, resourceType } = planning.data;
    return upsert(resources, fqn, { id: logicalId, type: resourceType });
  }
  const planned = PlanCompleted.safeParse(event);
  if (planned.success) {
    const { fqn, logicalId, resourceType, action } = planned.data;
    return upsert(resources, fqn, { id: logicalId, type: resourceType, action });
  }
  const status = StatusChanged.safeParse(event);
  if (status.success) {
    const { fqn, id, resourceType, status: now, message } = status.data;
    // a new status starts its note afresh: the note of `creating` does not hang on `created`
    return upsert(resources, fqn, { id, type: resourceType, status: now, note: message || null });
  }
  const note = Note.safeParse(event);
  // `output` notes are a tool's verbatim lines, not a status of the resource
  if (note.success && note.data.kind !== "output")
    return upsert(resources, note.data.fqn, { id: note.data.id, note: note.data.message });
  return resources;
}

function upsert(resources: Resource[], fqn: string, change: Partial<Resource>): Resource[] {
  const at = resources.findIndex((resource) => resource.fqn === fqn);
  if (at < 0)
    return [
      ...resources,
      { fqn, id: fqn, type: "", action: null, status: null, note: null, ...change },
    ];
  return resources.map((resource, index) => (index === at ? { ...resource, ...change } : resource));
}

// the envelope every record shares (LogRecord.ts `Envelope`), as far as a run reads it
const LogRecord = z.object({
  kind: z.enum(["log", "event", "output", "run"]),
  level: z.string(),
  data: z.unknown(),
});
// a `log` record's data is `{ message, cause }`, an `output` record's `{ stream, text }`
const TextData = z.object({ message: z.string().optional(), text: z.string().optional() });

const PlanStarted = z.object({
  type: z.literal("plan.resource.started"),
  fqn: z.string(),
  logicalId: z.string(),
  resourceType: z.string(),
});
const PlanCompleted = z.object({
  type: z.literal("plan.resource.completed"),
  fqn: z.string(),
  logicalId: z.string(),
  resourceType: z.string(),
  action: z.string(),
});
const StatusChanged = z.object({
  type: z.literal("apply.resource.status"),
  fqn: z.string(),
  id: z.string(),
  resourceType: z.string(),
  status: z.string(),
  message: z.string().optional(),
});
const Note = z.object({
  type: z.literal("apply.resource.note"),
  fqn: z.string(),
  id: z.string(),
  message: z.string(),
  kind: z.string().optional(),
});
