// What one context says about itself, behind a button beside its path: its description (which a
// person can write here), whether it works now, when it was made and last active, how much it
// holds, its last events, the processors on it, every event type its log has seen with a count,
// and its metadata. ⌘K's preview (context-palette.tsx) shows the same facts.
// Pure: the catalog's row for the context and what "Save" does are props.
import { useState } from "react";
import { InfoIcon } from "lucide-react";
import {
  activeAtOf,
  eventRunsOf,
  formatBytes,
  shortEventType,
  type ContextListing,
} from "./context-catalog-rows.ts";
import { AwakeDot } from "#/components/context-view/awake-dot.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";

export function ContextAbout({
  row,
  onDescribe,
}: {
  /** The catalog's row for the context shown; undefined when the catalog has none yet. */
  row: ContextListing | undefined;
  /** Writes the context's description (it appends `events.iterate.com/itx/described` there).
   *  Without it the description is read-only. */
  onDescribe?: (description: string) => Promise<unknown>;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="ghost" size="sm" className="h-7 max-w-64 gap-1.5 px-2 text-xs">
            <AwakeDot awake={Boolean(row?.awake)} />
            <span className="truncate text-muted-foreground">
              {row?.description || "About this context"}
            </span>
            <InfoIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </Button>
        }
      />
      <PopoverContent align="start" className="max-h-[70svh] w-96 gap-3 overflow-y-auto text-xs">
        <DescriptionField
          // a fresh draft for each description the catalog shows
          key={row?.description || ""}
          description={row?.description || ""}
          onDescribe={onDescribe}
        />
        {row ? (
          <ContextFacts row={row} />
        ) : (
          <p className="text-muted-foreground">Not listed yet.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function DescriptionField({
  description,
  onDescribe,
}: {
  description: string;
  onDescribe: ((description: string) => Promise<unknown>) | undefined;
}) {
  const [draft, setDraft] = useState(description);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  if (!onDescribe) return <p className="whitespace-pre-wrap">{description || "No description."}</p>;
  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await onDescribe(draft.trim());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
    setSaving(false);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Textarea
        aria-label="Description"
        placeholder="What is this context for?"
        className="min-h-16 text-xs md:text-xs"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={saving || draft.trim() === description}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save description"}
        </Button>
        {error ? (
          <span role="alert" className="truncate text-destructive" title={error}>
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** The facts of one row, each under its own small heading. `typeLimit` shows only that many
 *  event types, the most frequent, and a line that counts the rest. */
export function ContextFacts({ row, typeLimit }: { row: ContextListing; typeLimit?: number }) {
  const types = Object.entries(row.eventTypes).toSorted(
    ([leftType, left], [rightType, right]) => right - left || leftType.localeCompare(rightType),
  );
  const shownTypes = typeLimit === undefined ? types : types.slice(0, typeLimit);
  const runs = eventRunsOf(row.recentTypes);
  const lastActive = activeAtOf(row);
  const facts: [string, string | undefined][] = [
    ["Working", row.awake ? `since ${new Date(row.awake.since).toLocaleTimeString()}` : "no"],
    ["Last active", lastActive && new Date(lastActive).toLocaleString()],
    ["Created", row.createdAt && new Date(row.createdAt).toLocaleString()],
    ["Events", String(row.eventCount)],
    ["Storage", row.storageBytes === undefined ? undefined : formatBytes(row.storageBytes)],
  ];
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {facts.map(([name, value]) =>
          value ? (
            <div key={name} className="contents">
              <dt className="text-muted-foreground">{name}</dt>
              <dd className="truncate tabular-nums">{value}</dd>
            </div>
          ) : null,
        )}
      </dl>
      {runs.length ? (
        <Section title="Last events, newest first">
          <ul className="flex flex-col gap-0.5 font-mono text-2xs">
            {runs.map(({ type, count, at }) => (
              <li key={at} className="flex min-w-0 gap-2">
                <span className="min-w-0 truncate" title={type}>
                  {shortEventType(type)}
                </span>
                {count > 1 ? (
                  <span className="shrink-0 text-muted-foreground tabular-nums">×{count}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section title={`Processors (${String(row.processors.length)})`}>
        {row.processors.length ? (
          <div className="flex flex-wrap gap-1">
            {row.processors.map((name) => (
              <Badge key={name} variant="secondary" className="text-2xs">
                {name}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">None.</p>
        )}
      </Section>
      <Section title={`Event types (${String(types.length)})`}>
        <ul className="flex flex-col gap-0.5">
          {shownTypes.map(([type, count]) => (
            <li key={type} className="flex min-w-0 gap-2">
              <span className="min-w-0 flex-1 truncate" title={type}>
                {shortEventType(type)}
              </span>
              <span className="shrink-0 text-muted-foreground tabular-nums">{count}</span>
            </li>
          ))}
        </ul>
        {shownTypes.length < types.length ? (
          <p className="text-muted-foreground">
            {String(types.length - shownTypes.length)} more types.
          </p>
        ) : null}
      </Section>
      {row.metadata ? (
        <Section title="Metadata">
          <pre className="overflow-x-auto rounded-md bg-muted p-2 text-2xs">
            {JSON.stringify(row.metadata, null, 2)}
          </pre>
        </Section>
      ) : null}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-2xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}
