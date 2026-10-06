// /telemetry — the platform's custom metrics (docs/telemetry.md): each panel one SQL API query over
// the hours the URL names, read through the Worker's Analytics SQL binding, charted with TanStack
// Charts, and footed with what the query read.
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { startAppConfigOf } from "@iterate-com/shared/start-app-config";
import { TimeChart } from "@iterate-com/ui/components/time-chart";
import { NativeSelect, NativeSelectOption } from "@iterate-com/ui/components/ui/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@iterate-com/ui/components/ui/table";

declare global {
  namespace Cloudflare {
    interface Env {
      /** The Analytics SQL binding the page reads its account's custom metrics through, where the
       *  Worker has one (scripts/lib/start-app.ts `analyticsSql`): every deployment, not local dev. */
      TELEMETRY_ANALYTICS_SQL?: AnalyticsSQLBinding;
    }
  }
}

/** THE PANELS, each a SQL API query over the Workers Analytics Engine dataset `iterate_metrics`,
 *  the data points core/os writes (core/os/src/metrics.ts): blob1 the name, blob2 the Worker,
 *  blob3 the project, blob4 the path, blob5 the label (here the subscription), double1 the value.
 *  The dataset is sampled: the SQL API weights `count` and `sum` by each data point's
 *  `sampleInterval` unasked, a quantile takes it as its weight, and a maximum is `APPROX_MAX`.
 *  `$start` is the start of the range; a chart's bucket `t`, in unix seconds, is the range's hours
 *  in minutes, so a range is 60 buckets and the one it starts inside. The bucket is a literal: the
 *  SQL API types a `$param` in that expression as a string. */
const PANELS: { title: string; sql: (hours: number) => string }[] = [
  {
    title: "subscription.lag_ms p50 and p99 (ms)",
    sql: (hours) =>
      `SELECT ${bucket(hours)}, quantileWeighted(0.5, double1, sampleInterval) AS p50, quantileWeighted(0.99, double1, sampleInterval) AS p99 FROM events.analyticsEngine.iterate_metrics WHERE blob1 = 'subscription.lag_ms' AND timestamp >= $start GROUP BY t ORDER BY t LIMIT 61`,
  },
  {
    // every Worker writes to the one dataset, PR previews' tests included: each row names its own
    title: "subscription.backlog, the ten deepest subscriptions",
    sql: () =>
      "SELECT blob2 AS worker, blob3 AS project_id, blob4 AS path, blob5 AS subscription, APPROX_MAX(double1) AS backlog FROM events.analyticsEngine.iterate_metrics WHERE blob1 = 'subscription.backlog' AND timestamp >= $start GROUP BY worker, project_id, path, subscription HAVING APPROX_MAX(double1) > 0 ORDER BY backlog DESC LIMIT 10",
  },
  {
    title: "Subscriptions that halted or dead-lettered an event",
    sql: () =>
      "SELECT blob2 AS worker, blob3 AS project_id, blob4 AS path, blob5 AS subscription, sumIf(double1, blob1 = 'subscription.halts') AS halts, sumIf(double1, blob1 = 'subscription.dead_letters') AS dead_letters FROM events.analyticsEngine.iterate_metrics WHERE blob1 IN ('subscription.halts', 'subscription.dead_letters') AND timestamp >= $start GROUP BY worker, project_id, path, subscription ORDER BY halts DESC, dead_letters DESC LIMIT 10",
  },
  {
    title: "subscription.retries per minute",
    sql: (hours) =>
      `SELECT ${bucket(hours)}, sum(double1) / ${hours} AS retries FROM events.analyticsEngine.iterate_metrics WHERE blob1 = 'subscription.retries' AND timestamp >= $start GROUP BY t ORDER BY t LIMIT 61`,
  },
  {
    // each context measures itself at its wakes (core/os iterate-context-durable-object.ts)
    title: "The largest contexts, SQLite bytes (Cloudflare caps a Durable Object at 10 GB)",
    sql: () =>
      "SELECT blob2 AS worker, blob3 AS project_id, blob4 AS path, APPROX_MAX(double1) AS bytes FROM events.analyticsEngine.iterate_metrics WHERE blob1 = 'context.size' AND timestamp >= $start GROUP BY worker, project_id, path ORDER BY bytes DESC LIMIT 10",
  },
  {
    title: "The longest streams, head offset (events committed, ephemeral ones included)",
    sql: () =>
      "SELECT blob2 AS worker, blob3 AS project_id, blob4 AS path, APPROX_MAX(double2) AS events FROM events.analyticsEngine.iterate_metrics WHERE blob1 = 'context.size' AND timestamp >= $start GROUP BY worker, project_id, path ORDER BY events DESC LIMIT 10",
  },
  {
    title: "Data points per Worker",
    sql: () =>
      "SELECT blob2 AS worker, count() AS data_points FROM events.analyticsEngine.iterate_metrics WHERE timestamp >= $start GROUP BY worker ORDER BY data_points DESC LIMIT 20",
  },
];

/** A chart's bucket `t`: unix seconds, `hours` minutes wide. */
function bucket(hours: number) {
  return `intDiv(toUnixTimestamp(timestamp), ${hours * 60}) * ${hours * 60} AS t`;
}

const Hours = z.number().int().min(1).max(168);
type Row = Record<string, string | number | null>;

/** Every panel's rows and what its query read, or null where the Worker has no Analytics SQL
 *  binding, for a platform admin alone: this browser's session at the deployment's own issuer holds
 *  the `admin` scope, which that issuer grants to its `admins` only (core/os consent.ts). A session
 *  connected to another issuer could hold any scope. */
const readPanels = createServerFn({ method: "GET" })
  .inputValidator(Hours)
  .handler(async ({ data: hours }) => {
    const { env } = await import("cloudflare:workers");
    const { getRequest } = await import("@tanstack/react-start/server");
    const { appSession } = await import("iterate/app-server");
    const config = startAppConfigOf(env);
    const session = appSession(env.BROWSER_SESSION, getRequest());
    const [host, scopes, bearer] = await Promise.all([
      session?.host(),
      session?.scopes(),
      session?.bearer(),
    ]);
    if (host?.issuer !== config.urls.os || !scopes?.includes("admin") || !bearer)
      throw new Error("Telemetry is for platform admins: sign in with the admin scope.");
    const analyticsSql = env.TELEMETRY_ANALYTICS_SQL;
    if (!analyticsSql) return null;
    // the charts end at the moment of the read, on the server and in the browser alike
    const at = Date.now();
    const start = new Date(at - hours * 3_600_000).toISOString();
    const panels = await Promise.all(
      PANELS.map(async ({ title, sql }) => {
        // one attempt: a failed read fails the page, which names the panel, and a reload reads again
        const { data, statistics } = await analyticsSql
          .query<Row>({ query: sql(hours), params: { start } })
          .catch((error: unknown) => {
            throw new Error(`${title}: ${String(error)}`, { cause: error });
          });
        return { rows: data, statistics };
      }),
    );
    return { at, panels };
  });

export const Route = createFileRoute("/_auth/telemetry")({
  validateSearch: z.object({ hours: Hours.default(1).catch(1) }),
  loaderDeps: ({ search }) => ({ hours: search.hours }),
  loader: ({ deps }) => readPanels({ data: deps.hours }),
  head: () => ({ meta: [{ title: "Telemetry · Admin" }] }),
  component: TelemetryPage,
});

function TelemetryPage() {
  const read = Route.useLoaderData();
  const { hours } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-4 md:p-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Telemetry</h1>
        <NativeSelect
          aria-label="Time range"
          value={hours}
          onChange={(event) => void navigate({ search: { hours: Number(event.target.value) } })}
        >
          <NativeSelectOption value={1}>Last hour</NativeSelectOption>
          <NativeSelectOption value={6}>Last 6 hours</NativeSelectOption>
          <NativeSelectOption value={24}>Last 24 hours</NativeSelectOption>
          <NativeSelectOption value={168}>Last 7 days</NativeSelectOption>
        </NativeSelect>
      </div>
      {read ? (
        PANELS.map(({ title }, index) => {
          const { rows, statistics } = read.panels[index]!;
          return (
            <section key={title} className="flex flex-col gap-2">
              <h2 className="text-sm font-medium">{title}</h2>
              <Panel title={title} rows={rows} hours={hours} at={read.at} />
              <p className="text-xs text-muted-foreground">
                read {format(statistics.rows_read)} rows, {format(statistics.bytes_read / 1e6)} MB,
                in {format(statistics.elapsed_ms)} ms
              </p>
            </section>
          );
        })
      ) : (
        <p className="text-sm text-muted-foreground">
          This deployment reads no custom metrics: its Worker has no Analytics SQL binding.
        </p>
      )}
    </div>
  );
}

/** A panel's rows as a table or, when they have a bucket `t` (unix seconds), as one line per other
 *  column across the range up to the read. */
function Panel({
  title,
  rows,
  hours,
  at,
}: {
  title: string;
  rows: Row[];
  hours: number;
  at: number;
}) {
  if (rows[0] && "t" in rows[0])
    return (
      <TimeChart
        rows={rows}
        from={at - hours * 3_600_000}
        to={at}
        label={title}
        height={220}
        initialWidth={960}
      />
    );
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No data points.</p>;
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
        {rows.map((row, index) => (
          <TableRow key={index}>
            {columns.map((column) => (
              <TableCell key={column} className="font-mono text-xs">
                {format(row[column])}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function format(value: Row[string]) {
  return typeof value === "number"
    ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : String(value || "");
}
