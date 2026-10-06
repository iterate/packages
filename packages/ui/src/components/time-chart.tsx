// time-chart.tsx — telemetry over time, charted with TanStack Charts: the admin app's /telemetry
// panels and the dash's project Analytics page. One component, so both read alike.
import { colorLegend, colorLegendItems, defineChart, lineY, rect } from "@tanstack/charts";
import { Chart } from "@tanstack/charts/react";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scaleOrdinal } from "@tanstack/charts/scales/ordinal";
import { tooltip } from "@tanstack/charts/tooltip";
import { useMemo } from "react";

/** Rows with a bucket `t` (unix seconds), charted from `from` to `to` (milliseconds): a series per
 *  other column, at most five, as lines, or as columns `bucket` seconds wide. A null is a gap; a
 *  missing bucket is none.
 *  Ticks fall on round UTC times. The window is fixed, so a live chart slides as `to` moves. */
export function TimeChart({
  rows,
  from,
  to,
  label,
  bucket,
  height = 200,
  initialWidth = 640,
}: {
  rows: Record<string, unknown>[];
  from: number;
  to: number;
  /** The chart's accessible name: what it shows, with its unit. */
  label: string;
  /** Columns this many seconds wide, each from its `t`, instead of lines. */
  bucket?: number;
  height?: number;
  /** The width the server draws at, near the real one, so hydration does not jump. */
  initialWidth?: number;
}) {
  const definition = useMemo(() => {
    const series = Object.keys(rows[0] ?? {}).filter((column) => column !== "t");
    const points = rows.flatMap((row) =>
      series.map((name) => ({
        t: Number(row.t) * 1000,
        series: name,
        value: row[name] === null ? null : Number(row[name]),
      })),
    );
    const hours = (to - from) / 3_600_000;
    const time = new Intl.DateTimeFormat("en-GB", {
      ...(hours > 24 && { weekday: "short" }),
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    });
    // every ten minutes of an hour, every four hours of a day, each day of a week
    const step = (hours > 24 ? 24 * 60 : Math.max(1, hours) * 10) * 60_000;
    const first = Math.ceil(from / step);
    const ticks = Array.from(
      { length: Math.floor(to / step) - first + 1 },
      (_, i) => (first + i) * step,
    );
    return defineChart({
      marks: [
        bucket
          ? rect(points, {
              x1: "t",
              x2: (point) => point.t + bucket * 1000,
              y1: () => 0,
              y2: "value",
              z: "series",
              inset: 0.5,
              // rounded at the top, square at the baseline
              radius: [2, 2, 0, 0],
            })
          : lineY(points, { x: "t", y: "value", z: "series", points: true }),
      ],
      scales: {
        x: {
          scale: scaleLinear().domain([from, to]),
          axis: { ticks: { values: ticks, format: (ms) => time.format(ms) } },
        },
        y: { scale: scaleLinear, nice: true, grid: true },
      },
      // one series needs no legend: the label names it
      ...(series.length > 1 && {
        color: {
          scale: scaleOrdinal<string, string>()
            .domain(series)
            .range([1, 2, 3, 4, 5].map((slot) => `var(--ts-chart-${slot})`)),
          // labels at their own width, wrapping, so a long one (a context path) is not cut
          legend: colorLegend({ items: colorLegendItems({ justify: "start" }) }),
        },
      }),
      tooltip: {
        use: tooltip,
        formatGroup: ([point]) => `${time.format(Number(point?.xValue))} UTC`,
      },
      svgAnimation: { duration: 400, easing: "ease-out" },
    });
  }, [rows, from, to, bucket]);
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No data yet.</p>;
  return (
    // categorical slots 1 to 5 of the validated default data-viz palette, in its order: every
    // adjacent pair passes the colorblind checks on white, but slots 3 to 5 are under 3:1 contrast,
    // so a chart of more than two series has a table of its values beside it
    <div className="min-w-0 [--ts-chart-1:#2a78d6] [--ts-chart-2:#eb6834] [--ts-chart-3:#1baf7a] [--ts-chart-4:#eda100] [--ts-chart-5:#e87ba4]">
      <Chart
        definition={definition}
        height={height}
        initialWidth={initialWidth}
        ariaLabel={label}
        ariaDescription={`From ${new Date(from).toISOString()} to ${new Date(to).toISOString()}`}
      />
    </div>
  );
}
