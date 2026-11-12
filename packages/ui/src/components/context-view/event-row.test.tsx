// The rows of the log as they are drawn: an event's type as it is stored and a glance at its
// payload, in the page's own font; a run as one line that says how many of what.
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { EventRow } from "./event-row.tsx";
import { RunRow } from "./feed-rows.tsx";
import type { ContextViewEvent } from "./types.tsx";

test("a row is the offset, the time, the type as stored and the payload's fields: no sentence, no badge, no second font", () => {
  const row = renderToStaticMarkup(
    <EventRow
      event={event(14, "events.iterate.com/agent/created", {
        path: "/agents/voice/web-e11a546f1347",
        role: "developer",
      })}
      showWho={false}
      onOpen={() => {}}
    />,
  );
  // the type without the prefix that every platform type has, and whole in its title
  expect(row).toContain(
    `title="events.iterate.com/agent/created" data-event-type="true">agent/created</span>`,
  );
  expect(
    row
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  ).toMatch(
    /^#14 \d\d:\d\d:\d\d agent\/created path \/agents\/voice\/web-e11a546f1347 · role developer$/,
  );
  // one font and no dressing: a path is plain text
  expect(row).not.toMatch(/font-mono|font-readme|uppercase|<strong|<code|rounded bg-/);
});

test("a type of an app's own is shown whole, and an event with no payload is its type alone", () => {
  const row = renderToStaticMarkup(
    <EventRow event={event(3, "guestbook/entry-written")} showWho={false} onOpen={() => {}} />,
  );
  expect(
    row
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  ).toMatch(/^#3 \d\d:\d\d:\d\d guestbook\/entry-written$/);
});

test("a run is one line: its types as stored with their counts, and whether it is open", () => {
  const run = (open: boolean) =>
    renderToStaticMarkup(
      <RunRow
        itemKey="run:7"
        events={[7, 8, 9, 10].map((offset) =>
          event(offset, "events.iterate.com/itx/subscription-configured", { name: `s${offset}` }),
        )}
        showWho={false}
        open={open}
        onToggle={() => {}}
      />,
    );
  expect(
    run(false)
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  ).toMatch(/^#7 \d\d:\d\d:\d\d itx\/subscription-configured ×4$/);
  expect(run(false)).toContain(`aria-expanded="false"`);
  expect(run(true)).toContain(`aria-expanded="true"`);
  expect(run(false)).not.toMatch(/font-mono|housekeeping/);
});

function event(offset: number, type: string, payload?: unknown): ContextViewEvent {
  return { offset, type, createdAt: "2026-09-21T19:00:00.000Z", payload };
}
