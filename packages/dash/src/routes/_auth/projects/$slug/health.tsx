// /projects/<slug>/health — the project's health from its telemetry (`itx.telemetry.query`,
// docs/telemetry.md): live, its last hour of custom metrics a minute a point, read again every ten
// seconds; its last day in the warehouse an hour a column; a search of its log lines; and a box that
// runs any SELECT over the same tables, cut to this project, and shows the SQL that ran.
import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iterate-com/ui/components/ui/table";
import { Textarea } from "@iterate-com/ui/components/ui/textarea";
import { TimeChart } from "@iterate-com/ui/components/time-chart";

type Rows = Record<string, unknown>[];

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
    title: "Failed spans",
    unit: "an hour",
    column: "spans",
    sql: `SELECT ${HOURLY}, count(*) AS spans FROM spans WHERE status = 'error' AND ${TODAY} GROUP BY t ORDER BY t`,
  },
];

export const Route = createFileRoute("/_auth/projects/$slug/health")({
  loader: async ({ context }) => {
    const { telemetry } = context.api.projects.get(context.project.id);
    const at = Date.now();
    const day = await Promise.all(
      DAY.map(({ sql }) =>
        telemetry.query(sql).then(
          ({ rows }): { rows: Rows; error?: string } => ({ rows }),
          (error: unknown) => ({ rows: [], error: messageOf(error) }),
        ),
      ),
    );
    return { at, day };
  },
  staticData: { page: "Health" },
  head: ({ params }) => ({ meta: [{ title: `Health · ${params.slug} · Dash` }] }),
  component: ProjectHealth,
});

function ProjectHealth() {
  const { at, day } = Route.useLoaderData();
  const live = useLive();
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-4 md:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Health</h1>
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-medium">Live: the last hour</h2>
          <p className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="live">
            <span className="size-2 animate-pulse rounded-full bg-emerald-500" />
            {live ? `read ${new Date(live.at).toISOString().slice(11, 19)} UTC` : "reading…"}, again
            each 10 s
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
      <LogSearch />
      <Query />
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
  children: React.ReactNode;
}) {
  return (
    <Card data-testid="health-chart" className="min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{unit}</CardDescription>
        {headline && !error && (
          <p className="text-xl font-semibold tabular-nums" data-testid="headline">
            {headline}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {error ? <p className="text-sm text-muted-foreground">Unavailable: {error}</p> : children}
      </CardContent>
    </Card>
  );
}

/** The live query's rows and when they were read, again ten seconds after each read answers, while
 *  the page is shown: a hidden tab reads nothing, and no two reads overlap. */
function useLive() {
  const { api, project } = Route.useRouteContext();
  const [live, setLive] = useState<{ rows: Rows; at: number; error?: string }>();
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      if (!document.hidden) {
        const at = Date.now();
        const next = await api.projects
          .get(project.id)
          .telemetry.query(LIVE_SQL, { hours: 1 })
          .then(
            ({ rows }): { rows: Rows; at: number; error?: string } => ({ rows, at }),
            (error: unknown) => ({ rows: [], at, error: messageOf(error) }),
          );
        if (stopped) return;
        setLive(next);
      }
      timer = setTimeout(() => void read(), 10_000);
    };
    void read();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [api, project.id]);
  return live;
}

/** The project's log lines of the last day whose text has the words, newest first. */
function LogSearch() {
  const [text, setText] = useState("");
  const { running, answer, error, run } = useQuery();
  const search = () =>
    run(
      `SELECT timestamp, level, path, body FROM logs WHERE body ILIKE '%${text.replaceAll("'", "''")}%' ORDER BY timestamp DESC LIMIT 100`,
    );
  return (
    <Card data-testid="log-search">
      <CardHeader>
        <CardTitle>Search logs</CardTitle>
        <CardDescription>
          The last 24 hours of this project's log lines, newest first.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <Input
            aria-label="Log text"
            placeholder="error, a path, a word in the message"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit" disabled={running}>
            {running ? "Searching…" : "Search"}
          </Button>
        </form>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {answer && <RowsTable rows={answer.rows} />}
      </CardContent>
    </Card>
  );
}

/** Any SELECT over `events`, `logs`, `spans`, or `metrics` alone, run for this project: its rows,
 *  and the SQL that ran, which shows the project's cut. */
function Query() {
  const [sql, setSql] = useState(
    "SELECT type, count(*) AS n FROM events GROUP BY type ORDER BY n DESC LIMIT 10",
  );
  const { running, answer, error, run } = useQuery();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Query</CardTitle>
        <CardDescription>
          One SELECT over <code>events</code>, <code>logs</code> and <code>spans</code>, or{" "}
          <code>metrics</code> alone: this project's rows of the last 24 hours.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Textarea
          aria-label="SQL"
          value={sql}
          onChange={(event) => setSql(event.target.value)}
          className="font-mono text-xs"
          rows={3}
        />
        <Button className="self-start" onClick={() => void run(sql)} disabled={running}>
          {running ? "Running…" : "Run"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {answer && (
          <>
            <pre className="overflow-x-auto rounded-md bg-muted p-2 text-xs" data-testid="ran">
              {answer.sql}
            </pre>
            <RowsTable rows={answer.rows} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function useQuery() {
  const { api, project } = Route.useRouteContext();
  const [answer, setAnswer] = useState<{ rows: Rows; sql: string }>();
  const [error, setError] = useState<string>();
  const [running, setRunning] = useState(false);
  const run = async (sql: string) => {
    setRunning(true);
    setError(undefined);
    setAnswer(undefined);
    try {
      setAnswer(await api.projects.get(project.id).telemetry.query(sql));
    } catch (thrown) {
      setError(messageOf(thrown));
    } finally {
      setRunning(false);
    }
  };
  return { running, answer, error, run };
}

function RowsTable({ rows }: { rows: Rows }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No rows.</p>;
  const columns = Object.keys(rows[0]!);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column}>{column}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.slice(0, 100).map((row, i) => (
          <TableRow key={i}>
            {columns.map((column) => (
              <TableCell key={column} className="max-w-md truncate font-mono text-xs">
                {String(row[column])}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function sum(rows: Rows, column: string) {
  return rows.reduce((total, row) => total + Number(row[column] || 0), 0);
}

function format(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
