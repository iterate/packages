// /projects/<slug>/analytics — the project's telemetry (`itx.telemetry.query`, docs/telemetry.md):
// live, its last hour of custom metrics a minute a point, read again every thirty seconds; its last
// day in the warehouse an hour a column; its busiest context paths and event types; how much each
// context stores; a search of its log lines; and a box that runs any SELECT over the same tables,
// cut to this project. Every row of a result opens the raw data under it in the page's sheet.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { cn } from "cn";
import { Button } from "@iterate-com/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@iterate-com/ui/components/ui/card";
import { Input } from "@iterate-com/ui/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@iterate-com/ui/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iterate-com/ui/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@iterate-com/ui/components/ui/tabs";
import { Textarea } from "@iterate-com/ui/components/ui/textarea";
import { TimeChart } from "@iterate-com/ui/components/time-chart";

type Row = Record<string, unknown>;
type Rows = Row[];
/** A query's answer: its rows and the SQL that ran, or why it did not run. */
type Answer = { rows: Rows; sql?: string; error?: string };

/** The live charts' one query: the delivery loop's metrics (core/os/src/metrics.ts), a minute a
 *  row each. The Analytics SQL API weights `sum` by each data point's sample. */
const LIVE_SQL =
  "SELECT intDiv(toUInt32(timestamp), 60) * 60 AS t, blob1 AS name, sum(double1) AS total, quantileWeighted(0.99, double1, sampleInterval) AS p99 FROM metrics WHERE blob1 IN ('subscription.delivered', 'subscription.lag_ms', 'subscription.retries') GROUP BY t, name ORDER BY t";
const LIVE = [
  { title: "Events delivered", unit: "a minute", name: "subscription.delivered", column: "total" },
  { title: "Delivery lag, p99", unit: "ms", name: "subscription.lag_ms", column: "p99" },
  { title: "Retries", unit: "a minute", name: "subscription.retries", column: "total" },
] as const;

const HOURLY = "date_part('epoch', date_trunc('hour', timestamp)) AS t";
/** The rows that happened in the last day: `itx.telemetry` reads the rows that LANDED in it. */
const TODAY = "timestamp > now() - interval '24 hours'";
/** The spans of invocations that failed: a server's or a consumer's, whose outcome is not a success
 *  or the caller leaving, or whose response is a 5xx. A failure counts once, where it was invoked,
 *  and a canceled call, a WebSocket upgrade or an outbound 4xx counts not at all. */
const FAILED_INVOCATION =
  "kind IN ('server', 'consumer') AND (outcome NOT IN ('ok', 'canceled', 'responseStreamDisconnected', 'aborted') OR http_status >= 500)";
/** The last day's charts: each scans the day's files of one table (`itx.telemetry` reads 24 hours
 *  unless asked for more). A row delivered twice counts twice (docs/telemetry.md). */
const DAY = [
  {
    title: "Events committed",
    unit: "an hour",
    column: "events",
    sql: `SELECT ${HOURLY}, count(*) AS events FROM events WHERE ${TODAY} GROUP BY t ORDER BY t`,
  },
  {
    title: "Errors and warnings logged",
    unit: "an hour",
    column: "lines",
    sql: `SELECT ${HOURLY}, count(*) AS lines FROM logs WHERE level IN ('error', 'warn') AND ${TODAY} GROUP BY t ORDER BY t`,
  },
  {
    title: "Failed invocations",
    unit: "an hour",
    column: "invocations",
    sql: `SELECT ${HOURLY}, count(*) AS invocations FROM spans WHERE ${FAILED_INVOCATION} AND ${TODAY} GROUP BY t ORDER BY t`,
  },
];

/** What the Activity section groups the day's events by: their context path or their type. */
type Dimension = "path" | "type";

/** The day's events an hour of the 20 values of `column` with the most events, with each one's
 *  latest. Ties go by value. 20 values of 25 hours are well under the 1,000 rows a query answers. */
const busiest = (column: Dimension) =>
  `SELECT ${HOURLY}, ${column} AS key, count(*) AS events, max(timestamp) AS last FROM events WHERE ${TODAY} AND ${column} IN (SELECT ${column} FROM events WHERE ${TODAY} GROUP BY ${column} ORDER BY count(*) DESC, ${column} LIMIT 20) GROUP BY t, ${column}`;

/** The Activity section's two queries, oldest hour first: the busiest event types, and the busiest
 *  context paths, each hour's row with its path's log lines and failed invocations of the day. */
const ACTIVITY = {
  path: `SELECT e.*, l.lines, l.problems, f.failed FROM (${busiest("path")}) e LEFT JOIN (SELECT path, count(*) AS lines, sum(CASE WHEN level IN ('error', 'warn') THEN 1 ELSE 0 END) AS problems FROM logs WHERE ${TODAY} GROUP BY path) l ON l.path = e.key LEFT JOIN (SELECT path, count(*) AS failed FROM spans WHERE ${FAILED_INVOCATION} AND ${TODAY} GROUP BY path) f ON f.path = e.key ORDER BY e.t`,
  type: `${busiest("type")} ORDER BY t`,
};

/** The 20 largest contexts of the last 30 days (`context.size`, core/os `#measureSize`). The
 *  dataset is sampled, so a maximum is `approx_max`. */
const STORAGE_SQL =
  "SELECT blob4 AS path, approx_max(double1) AS bytes, approx_max(double2) AS events FROM metrics WHERE blob1 = 'context.size' GROUP BY path ORDER BY bytes DESC LIMIT 20";

/** What a Durable Object can store, so what a context can: Cloudflare's 10 GB, read as 10^10 bytes. */
const CONTEXT_STORAGE_LIMIT = 10e9;

/** The columns whose text is JSON (docs/telemetry.md), shown parsed where they parse. */
const JSON_COLUMNS = new Set(["payload", "body", "attributes", "actor", "cause_chain"]);

export const Route = createFileRoute("/_auth/projects/$slug/analytics")({
  // the day's charts and the storage table; the Activity section reads once the page shows
  loader: ({ context }) =>
    context.read(async (api) => {
      using project = api.projects.get(context.project.id);
      const at = Date.now();
      const [day, storage] = await Promise.all([
        Promise.all(DAY.map(({ sql }) => queryOf(project, sql))),
        queryOf(project, STORAGE_SQL, 720),
      ]);
      return { at, day, storage };
    }),
  staticData: { page: "Analytics" },
  head: ({ params }) => ({ meta: [{ title: `Analytics · ${params.slug} · Dash` }] }),
  component: ProjectAnalytics,
});

/** One query of a project's telemetry over its last `hours`: the rows and the SQL that ran, or why
 *  it did not run. */
async function queryOf(
  project: {
    telemetry: { query(sql: string, options: { hours: number }): PromiseLike<Answer> };
  },
  sql: string,
  hours = 24,
): Promise<Answer> {
  try {
    return await project.telemetry.query(sql, { hours });
  } catch (error) {
    return { rows: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/** `queryOf` this page's project, addressed through the session's current connection on each call,
 *  so a reconnect between calls costs nothing. */
function useTelemetry() {
  const { api, project } = Route.useRouteContext();
  return useCallback(
    async (sql: string, hours?: number) => {
      using context = api.projects.get(project.id);
      return await queryOf(context, sql, hours);
    },
    [api, project.id],
  );
}

/** What a result row opens: a raw row's own fields, or the latest events of a context path or an
 *  event type. */
type RowTarget = { row: Row } | { column: Dimension; value: string };

/** Opens a result row in the page's one sheet. */
const OpenRow = createContext<(target: RowTarget) => void>(() => {});

function ProjectAnalytics() {
  const { at, day, storage } = Route.useLoaderData();
  const live = useLive();
  // the sheet keeps its target while it closes, so its content stays put as it slides away
  const [opened, setOpened] = useState<{ target: RowTarget; open: boolean }>();
  const target = opened?.target;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-4 md:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-medium">Live: the last hour</h2>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="size-2 animate-pulse rounded-full bg-emerald-500" />
            {live ? `read ${new Date(live.at).toISOString().slice(11, 19)} UTC` : "reading…"}, again
            each 30 s
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {LIVE.map(({ title, unit, name, column }) => {
            const rows = (live?.rows || [])
              .filter((row) => row.name === name)
              .map((row) => ({ t: row.t, [column]: row[column] }));
            const counts = column === "total";
            return (
              <Chart
                key={title}
                title={title}
                unit={unit}
                error={live?.error}
                headline={
                  live &&
                  (counts
                    ? `${format(sum(rows, column))} in the last hour`
                    : `${format(Number(rows.at(-1)?.[column] || 0))} ms, the latest minute`)
                }
              >
                {live && (
                  <TimeChart
                    rows={rows}
                    from={live.at - 3_600_000}
                    to={live.at}
                    label={`${title}, ${unit}`}
                    bucket={counts ? 60 : undefined}
                    height={160}
                    initialWidth={300}
                  />
                )}
              </Chart>
            );
          })}
        </div>
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="font-medium">The last 24 hours</h2>
        <p className="text-sm text-muted-foreground">
          Rows reach the warehouse a minute or two after they happen.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          {DAY.map(({ title, unit, column }, index) => (
            <Chart
              key={title}
              title={title}
              unit={unit}
              error={day[index]!.error}
              headline={`${format(sum(day[index]!.rows, column))} in the last 24 hours`}
            >
              <TimeChart
                rows={day[index]!.rows}
                from={at - 86_400_000}
                to={at}
                label={`${title}, ${unit}`}
                bucket={3600}
                height={160}
                initialWidth={300}
              />
            </Chart>
          ))}
        </div>
      </section>
      <OpenRow value={(next) => setOpened({ target: next, open: true })}>
        <Activity />
        <Storage answer={storage} />
        <QueryPanel
          title="Search logs"
          testId="log-search"
          description="The last 24 hours of this project's log lines, newest first. A row opens all its fields."
          verbs={["Search", "Searching…"]}
          sql={(text) =>
            `SELECT timestamp, level, path, body FROM logs WHERE body ILIKE '%${text.replaceAll("'", "''")}%' ORDER BY timestamp DESC LIMIT 100`
          }
          input={(field) => (
            <Input
              aria-label="Log text"
              placeholder="error, a path, a word in the message"
              {...field}
            />
          )}
        />
        <QueryPanel
          title="Query"
          testId="query"
          description={
            <>
              One SELECT over <code>events</code>, <code>logs</code> and <code>spans</code>, or{" "}
              <code>metrics</code> alone: this project's rows of the last 24 hours. A row opens all
              its fields.
            </>
          }
          initial="SELECT type, count(*) AS n FROM events GROUP BY type ORDER BY n DESC LIMIT 10"
          verbs={["Run", "Running…"]}
          sql={(text) => text}
          input={(field) => (
            <Textarea aria-label="SQL" className="font-mono text-xs" rows={3} {...field} />
          )}
        />
      </OpenRow>
      <Sheet
        open={Boolean(opened?.open)}
        onOpenChange={(open) => setOpened((last) => last && { ...last, open })}
      >
        <SheetContent
          side="right"
          className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
        >
          {target && "row" in target && (
            <>
              <SheetHeader>
                <SheetTitle>Row</SheetTitle>
                <SheetDescription>All its fields, its JSON parsed.</SheetDescription>
              </SheetHeader>
              <div className="px-4 pb-4">
                <RowJson row={target.row} />
              </div>
            </>
          )}
          {target && "column" in target && (
            <LatestEvents column={target.column} value={target.value} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** One chart's card: its title and unit, the number that sums it up, and the chart. */
function Chart({
  title,
  unit,
  headline,
  error,
  children,
}: {
  title: string;
  unit: string;
  headline?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <Card data-testid="chart" className="min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{unit}</CardDescription>
        {headline && !error && <p className="text-xl font-semibold tabular-nums">{headline}</p>}
      </CardHeader>
      <CardContent>
        {error ? <p className="text-sm text-muted-foreground">Unavailable: {error}</p> : children}
      </CardContent>
    </Card>
  );
}

/** The live query's rows and when they were read, again thirty seconds after each read answers,
 *  while the page is shown: a hidden tab reads nothing, and no two reads overlap. */
function useLive() {
  const query = useTelemetry();
  const [live, setLive] = useState<Answer & { at: number }>();
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      if (!document.hidden) {
        const at = Date.now();
        const next = await query(LIVE_SQL, 1);
        if (stopped) return;
        setLive({ ...next, at });
      }
      timer = setTimeout(() => void read(), 30_000);
    };
    void read();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [query]);
  return live;
}

/** The day's events by context path or by event type, both read at once so the toggle reads
 *  nothing. */
function Activity() {
  const query = useTelemetry();
  const [read, setRead] = useState<{ at: number; path: Answer; type: Answer }>();
  useEffect(() => {
    const at = Date.now();
    void Promise.all([query(ACTIVITY.path), query(ACTIVITY.type)]).then(([path, type]) =>
      setRead({ at, path, type }),
    );
  }, [query]);
  return (
    <Card data-testid="activity">
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>
          The last 24 hours of this project's events: the five busiest an hour, and the 20 busiest.
          A row opens its latest events.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="path">
          <TabsList aria-label="Group events by">
            <TabsTrigger value="path">Context path</TabsTrigger>
            <TabsTrigger value="type">Event type</TabsTrigger>
          </TabsList>
          {read ? (
            (["path", "type"] as const).map((dimension) => (
              <TabsContent key={dimension} value={dimension}>
                <Busiest dimension={dimension} at={read.at} answer={read[dimension]} />
              </TabsContent>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Reading…</p>
          )}
        </Tabs>
      </CardContent>
    </Card>
  );
}

/** One dimension's 20 busiest values from `ACTIVITY`: the five busiest an hour, as lines, and all
 *  20 in a table, a path's with its log lines and failed invocations. */
function Busiest({ dimension, at, answer }: { dimension: Dimension; at: number; answer: Answer }) {
  if (answer.error)
    return <p className="text-sm text-muted-foreground">Unavailable: {answer.error}</p>;
  // the rows come oldest hour first, so a value's last row has its latest event
  const totals = new Map<string, Row & { events: number }>();
  const hourly = new Map<string, number>();
  for (const row of answer.rows) {
    const key = String(row.key);
    totals.set(key, { ...row, events: (totals.get(key)?.events ?? 0) + Number(row.events) });
    hourly.set(`${Number(row.t)} ${key}`, Number(row.events));
  }
  if (totals.size === 0)
    return <p className="text-sm text-muted-foreground">No events in the last 24 hours.</p>;
  const ranked = [...totals.values()].sort(
    (x, y) => y.events - x.events || String(x.key).localeCompare(String(y.key)),
  );
  // every hour of the window, so a quiet hour is a zero in the line, not a gap
  const first = Math.floor((at - 86_400_000) / 3_600_000);
  const top = ranked.slice(0, 5).map((row) => String(row.key));
  const chart = Array.from({ length: Math.floor(at / 3_600_000) - first + 1 }, (_, i) => {
    const t = (first + i) * 3600;
    return { t, ...Object.fromEntries(top.map((key) => [key, hourly.get(`${t} ${key}`) ?? 0])) };
  });
  const paths = dimension === "path";
  return (
    <div className="flex flex-col gap-3 pt-2">
      <TimeChart
        rows={chart}
        from={first * 3_600_000}
        to={at}
        label={`Events an hour of the five busiest ${paths ? "context paths" : "event types"}`}
        height={220}
        initialWidth={880}
      />
      <ResultTable
        rows={ranked}
        target={(row) => ({ column: dimension, value: String(row.key) })}
        columns={[
          { head: paths ? "Context path" : "Event type", cell: (row) => String(row.key) },
          count("Events", "events"),
          ...(paths
            ? [
                count("Log lines", "lines"),
                count("Errors and warnings", "problems"),
                count("Failed invocations", "failed"),
              ]
            : []),
          {
            head: "Last event",
            numeric: true,
            cell: (row) => <span title={String(row.last)}>{ago(String(row.last), at)}</span>,
          },
        ]}
      />
    </div>
  );
}

/** Each context's database, the 20 largest of the last 30 days, against what a context can store;
 *  a row opens the context's latest events. */
function Storage({ answer }: { answer: Answer }) {
  return (
    <Card data-testid="storage">
      <CardHeader>
        <CardTitle>Storage</CardTitle>
        <CardDescription>
          The 20 largest contexts of the last 30 days: each one's database, measured at its birth,
          when it wakes and at most hourly after, against the 10 GB a context can store, and the
          events it committed. A busy moment can drop a measurement, so a context can be missing
          until it is measured again.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {answer.error ? (
          <p className="text-sm text-muted-foreground">Unavailable: {answer.error}</p>
        ) : (
          <ResultTable
            rows={answer.rows}
            empty="No context has measured its size yet."
            target={(row) => ({ column: "path", value: String(row.path) })}
            columns={[
              { head: "Context path", cell: (row) => String(row.path) },
              { head: "Size", numeric: true, cell: (row) => bytesOf(Number(row.bytes)) },
              { head: "Of 10 GB", cell: (row) => <Share bytes={Number(row.bytes)} /> },
              count("Events", "events"),
            ]}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** A context's share of what it can store: a thin meter, slot 1 of the data-viz palette on its own
 *  lighter step, and the percentage. */
function Share({ bytes }: { bytes: number }) {
  const percent = (bytes / CONTEXT_STORAGE_LIMIT) * 100;
  return (
    <div className="flex items-center gap-2">
      <div aria-hidden className="h-1.5 w-24 rounded-full bg-[#cde2fb]">
        <div
          className="h-full rounded-full bg-[#2a78d6]"
          style={{ width: `max(2px, ${Math.min(percent, 100)}%)` }}
        />
      </div>
      <span className="text-muted-foreground tabular-nums">
        {percent > 0 && percent < 0.01
          ? "<0.01%"
          : `${percent.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`}
      </span>
    </div>
  );
}

/** A query the person runs from a form: `sql` of what they typed into `input`, its answer with the
 *  SQL that ran, which shows the project's cut, and the first 100 rows, each opening its fields. */
function QueryPanel({
  title,
  testId,
  description,
  initial = "",
  verbs: [verb, running],
  sql,
  input,
}: {
  title: string;
  testId: string;
  description: ReactNode;
  initial?: string;
  /** The button's label, idle and while the query runs. */
  verbs: [string, string];
  sql: (text: string) => string;
  input: (field: {
    value: string;
    onChange: (event: { target: { value: string } }) => void;
  }) => ReactNode;
}) {
  const query = useTelemetry();
  const [text, setText] = useState(initial);
  const [answer, setAnswer] = useState<Answer>();
  const [pending, setPending] = useState(false);
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-start"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setAnswer(undefined);
            setAnswer(await query(sql(text)));
            setPending(false);
          }}
        >
          {input({ value: text, onChange: (event) => setText(event.target.value) })}
          <Button type="submit" className="self-start" disabled={pending}>
            {pending ? running : verb}
          </Button>
        </form>
        {answer?.error && <p className="text-sm text-destructive">{answer.error}</p>}
        {answer?.sql && (
          <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs">{answer.sql}</pre>
        )}
        {answer?.sql && (
          <ResultTable
            rows={answer.rows.slice(0, 100)}
            target={(row) => ({ row })}
            columns={Object.keys(answer.rows[0] || {}).map((column) => ({
              head: column,
              cell: (row) => String(row[column]),
            }))}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** A result table's column: its heading and each row's cell. A numeric one is right-aligned in
 *  tabular figures; the others are monospace. */
type Column = { head: string; cell: (row: Row) => ReactNode; numeric?: boolean };

/** A column of the count in each row's `key`. */
const count = (head: string, key: string): Column => ({
  head,
  numeric: true,
  cell: (row) => format(Number(row[key]) || 0),
});

/** Result rows, each opening `target(row)` in the page's sheet, or `empty` when there are none. The
 *  first cell is a button, so the keyboard can open a row too: its click reaches the row's handler. */
function ResultTable({
  rows,
  empty = "No rows.",
  columns,
  target,
}: {
  rows: Rows;
  empty?: string;
  columns: Column[];
  target: (row: Row) => RowTarget;
}) {
  const open = useContext(OpenRow);
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map(({ head, numeric }) => (
            <TableHead key={head} className={cn(numeric && "text-right")}>
              {head}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow key={i} className="cursor-pointer" onClick={() => open(target(row))}>
            {columns.map(({ head, cell, numeric }, c) => (
              <TableCell
                key={head}
                className={cn(
                  "max-w-md truncate",
                  numeric ? "text-right tabular-nums" : "font-mono text-xs",
                )}
              >
                {c === 0 ? (
                  <button
                    type="button"
                    className="max-w-full truncate text-left underline-offset-2 outline-none hover:underline focus-visible:underline"
                  >
                    {cell(row)}
                  </button>
                ) : (
                  cell(row)
                )}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/** The latest 50 events of a context path or an event type in the last 24 hours, newest first,
 *  read when the sheet opens, with the SQL that ran. */
function LatestEvents({ column, value }: { column: Dimension; value: string }) {
  const query = useTelemetry();
  const sql = `SELECT * FROM events WHERE ${column} = '${value.replaceAll("'", "''")}' ORDER BY timestamp DESC LIMIT 50`;
  const [read, setRead] = useState<{ sql: string; answer: Answer }>();
  useEffect(() => {
    void query(sql).then((answer) => setRead({ sql, answer }));
  }, [query, sql]);
  // an answer to an earlier row's query is not this row's
  const answer = read?.sql === sql ? read.answer : undefined;
  return (
    <>
      <SheetHeader>
        <SheetTitle className="pr-8 font-mono break-all">{value}</SheetTitle>
        <SheetDescription>
          The latest 50 events of this {column === "path" ? "context path" : "event type"} in the
          last 24 hours, newest first.
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-3 px-4 pb-4">
        {!answer && <p className="text-sm text-muted-foreground">Reading its events…</p>}
        {answer?.error && <p className="text-sm text-destructive">{answer.error}</p>}
        {answer?.sql && (
          <pre className="rounded-md bg-muted p-2 text-xs break-all whitespace-pre-wrap">
            {answer.sql}
          </pre>
        )}
        {answer?.sql && answer.rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No events in the last 24 hours.</p>
        )}
        {answer?.rows.map((row, i) => (
          <RowJson key={i} row={row} />
        ))}
      </div>
    </>
  );
}

/** One row as pretty JSON, its JSON columns parsed where they parse. */
function RowJson({ row }: { row: Row }) {
  const fields = Object.entries(row).map(([column, value]) => {
    if (!JSON_COLUMNS.has(column) || typeof value !== "string") return [column, value];
    try {
      return [column, JSON.parse(value)];
    } catch {
      return [column, value];
    }
  });
  return (
    <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
      {JSON.stringify(Object.fromEntries(fields), null, 2)}
    </pre>
  );
}

function sum(rows: Rows, column: string) {
  return rows.reduce((total, row) => total + Number(row[column] || 0), 0);
}

function format(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/** How long before `now` a timestamp was: "now", "12 min ago", "5 h ago". */
function ago(timestamp: string, now: number) {
  const minutes = Math.floor((now - Date.parse(timestamp)) / 60_000);
  if (minutes < 1) return "now";
  return minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`;
}

/** A size in bytes in powers of 1,000, as the 10 GB limit is: "512 B", "3.4 MB". */
function bytesOf(bytes: number) {
  const power = Math.min(3, Math.max(0, Math.floor(Math.log10(bytes) / 3)));
  const scaled = (bytes / 1000 ** power).toLocaleString("en-US", { maximumFractionDigits: 1 });
  return `${scaled} ${["B", "KB", "MB", "GB"][power]}`;
}
