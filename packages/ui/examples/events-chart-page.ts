// events-chart-page.ts — A NO-BUILD PAGE THAT MIXES SOMEONE ELSE'S REACT LIBRARY WITH ITERATE'S
// (packages/ui/AGENTS.md "Another React library"): a context's events charted over time by recharts,
// above the same context in ContextView, iterate's own viewer. One live read feeds both, so an event
// appended in the viewer raises a bar. recharts comes from esm.sh with `?external=react,react-dom`,
// which leaves its `react` imports for the import map, so it uses the React @iterate-com/ui brings.
// Copy this file into a project's config repo beside worker.ts, and route a slug to it in `fetch`:
//
//   if (routingSlug === "activity") {
//     const denied = this.auth.require(request);
//     if (denied) return denied;
//     using itx = this.getItx();
//     return await eventsChartPage(itx); // awaited: `using` releases itx when the function returns
//   }
//
// It is then `activity--<project>.iterate.app` (or `/projects/<project>/activity/` where projects
// are paths). test/playwright/ui/third-party-library.spec.ts commits it to a fresh project and opens
// it. A page you keep pins an exact version of @iterate-com/ui in place of `@main`.

/** The page, with what only the worker knows written into it: which project this host is, and its
 *  contexts (the `project` facet's registry), for the path box. */
export async function eventsChartPage(itx: {
  whoami(): Promise<{ projectId: string; projectSlug: string }>;
  facets: { get(name: "project"): { snapshot(): Promise<{ state: { contexts?: object } }> } };
}) {
  const { projectId, projectSlug } = await itx.whoami();
  const { state } = await itx.facets.get("project").snapshot();
  const project = {
    id: projectId,
    slug: projectSlug,
    paths: ["/", ...Object.keys(state.contexts || {}).sort()],
  };
  // JSON inside a script element, `<` escaped so no value can close the element
  const data = JSON.stringify(project).replaceAll("<", "\\u003c");
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Activity</title>
    <script type="importmap">
      {
        "imports": {
          "@iterate-com/ui/": "https://esm.sh/@iterate-com/ui@main/",
          "react": "https://esm.sh/@iterate-com/ui@main/react",
          "react/": "https://esm.sh/@iterate-com/ui@main/react/",
          "react-dom": "https://esm.sh/@iterate-com/ui@main/react-dom",
          "react-dom/": "https://esm.sh/@iterate-com/ui@main/react-dom/",
          "recharts": "https://esm.sh/recharts@3.10.1?external=react,react-dom"
        }
      }
    </script>
    <link rel="stylesheet" href="https://esm.sh/@iterate-com/ui@main/styles.css" />
    <script type="application/json" id="project">${data}</script>
  </head>
  <body>
    <div id="root"><p class="p-4 text-sm text-muted-foreground">Connecting…</p></div>
    <script type="module">
      import { html, render, useState } from "@iterate-com/ui/page";
      import { ContextView } from "@iterate-com/ui/components/context-view/context-view";
      import { Button } from "@iterate-com/ui/components/ui/button";
      import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@iterate-com/ui/components/ui/card";
      import { Input } from "@iterate-com/ui/components/ui/input";
      import { createIterateClient, useContextStub, useIterateContext } from "@iterate-com/ui/live";
      import { Bar, BarChart, CartesianGrid, Legend, Rectangle, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

      // what the worker knows and the page doesn't: which project this host is, and its contexts
      const project = JSON.parse(document.getElementById("project").textContent);
      // the session this host's sign-in set (the worker only serves a signed-in member)
      const { api, info } = await createIterateClient().authenticate(location.href);

      // THE CHART'S SERIES: who wrote an event, in a fixed order with a colour each, so a colour
      // means the same writer whichever of them a context has.
      const WRITERS = [
        { name: "People and apps", colour: "#2a78d6", wrote: (source) => !source.processor && !source.platform && Boolean(source.principal) },
        { name: "Processors", colour: "#eb6834", wrote: (source) => Boolean(source.processor) },
        { name: "The platform", colour: "#1baf7a", wrote: () => true },
      ];
      // A bar's span of time: the shortest that shows the events in no more than 48 bars.
      const SPANS = [
        { ms: 60_000, unit: "a minute", label: { hour: "numeric", minute: "2-digit" } },
        { ms: 3_600_000, unit: "an hour", label: { weekday: "short", hour: "numeric" } },
        { ms: 86_400_000, unit: "a day", label: { month: "short", day: "numeric" } },
      ];

      /** A bar for each span of time from the first event to the last, counting each writer's. */
      function barsOf(events) {
        const times = events.map((event) => Date.parse(event.createdAt));
        const span = SPANS.find(({ ms }) => (times.at(-1) - times[0]) / ms < 48) || SPANS.at(-1);
        const bars = new Map();
        for (let time = Math.floor(times[0] / span.ms) * span.ms; time <= times.at(-1); time += span.ms)
          bars.set(time, { time });
        events.forEach((event, index) => {
          const bar = bars.get(Math.floor(times[index] / span.ms) * span.ms);
          const { name } = WRITERS.find((writer) => writer.wrote(event.source));
          bar[name] = (bar[name] || 0) + 1;
        });
        // the series on top of each bar, whose end is rounded; a span with no events has none
        for (const bar of bars.values()) bar.top = WRITERS.findLast(({ name }) => bar[name] > 0)?.name;
        return { span, bars: [...bars.values()] };
      }

      const swatch = (colour) => html\`<span class="inline-block" style=\${{ width: 10, height: 10, borderRadius: 2, background: colour }} />\`;

      function BarTooltip({ active, payload, label, format }) {
        if (!active || !payload || !payload.length) return null;
        return html\`<div class="rounded-lg border bg-background p-2 text-xs shadow-md">
          <div class="font-medium">\${format(label)}</div>
          \${payload.toReversed().map((item) => html\`<div key=\${item.dataKey} class="flex items-center gap-2">
            \${swatch(item.color)}<span class="text-muted-foreground">\${item.dataKey}</span>
            <span class="tabular-nums" style=\${{ marginLeft: "auto" }}>\${item.value}</span>
          </div>\`)}
        </div>\`;
      }

      // recharts, with nothing of iterate's in it but the colours of the stylesheet
      function Activity({ path, events }) {
        if (!events.length) return null;
        const { span, bars } = barsOf(events);
        const format = (time) => new Intl.DateTimeFormat(undefined, span.label).format(new Date(time));
        const axis = { fill: "var(--muted-foreground)", fontSize: 12 };
        return html\`<\${Card}>
          <\${CardHeader}>
            <\${CardTitle}>Activity<//>
            <\${CardDescription}>\${events.length} events of \${path}, a bar \${span.unit}, by who wrote them.<//>
          <//>
          <\${CardContent}>
            <div style=\${{ height: 220 }}>
              <\${ResponsiveContainer} width="100%" height="100%">
                <\${BarChart} data=\${bars} margin=\${{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap=\${1} maxBarSize=\${48}>
                  <\${CartesianGrid} vertical=\${false} stroke="var(--border)" />
                  <\${XAxis} dataKey="time" tickFormatter=\${format} minTickGap=\${24} tickLine=\${false} axisLine=\${false} tick=\${axis} />
                  <\${YAxis} allowDecimals=\${false} width=\${40} tickLine=\${false} axisLine=\${false} tick=\${axis} />
                  <\${Tooltip} cursor=\${{ fill: "var(--muted)" }} content=\${(props) => html\`<\${BarTooltip} ...\${props} format=\${format} />\`} />
                  <\${Legend} iconType="square" iconSize=\${10} itemSorter=\${null} formatter=\${(name) => html\`<span class="text-sm text-foreground">\${name}</span>\`} />
                  \${WRITERS.map(({ name, colour }) => html\`<\${Bar}
                    key=\${name}
                    dataKey=\${name}
                    stackId="events"
                    fill=\${colour}
                    stroke="var(--background)"
                    strokeWidth=\${1}
                    isAnimationActive=\${false}
                    shape=\${(bar) => html\`<\${Rectangle} ...\${bar} radius=\${bar.payload.top === name ? [3, 3, 0, 0] : 0} />\`}
                  />\`)}
                <//>
              <//>
            </div>
          <//>
        <//>\`;
      }

      function Context({ path }) {
        // the view's own state: the open inspector, the search, the filters
        const [state, setState] = useState({});
        const root = useContextStub(() => api.projects.get(project.id), []);
        const shown = useContextStub(root.stub ? () => root.stub.cd(path) : null, [root.stub, path]);
        // ONE live read of the context, for recharts' chart and for iterate's viewer
        const context = useIterateContext(shown.stub);
        return html\`<div class="flex flex-col gap-4">
          <\${Activity} path=\${path} events=\${context.events} />
          <div class="flex flex-col overflow-hidden rounded-lg border" style=\${{ height: 480 }}>
            <\${ContextView}
              title=\${path}
              context=\${context}
              error=\${root.error || shown.error}
              state=\${state}
              onStateChange=\${(patch) => setState((previous) => ({ ...previous, ...patch }))}
              onAppend=\${shown.stub ? (events) => shown.stub.append(...events) : undefined}
              className="min-h-0 flex-1"
            />
          </div>
        </div>\`;
      }

      function App() {
        const [path, setPath] = useState(new URLSearchParams(location.search).get("path") || "/");
        const open = (event) => {
          event.preventDefault();
          const next = String(new FormData(event.currentTarget).get("path") || "/");
          history.replaceState(null, "", "?path=" + encodeURIComponent(next));
          setPath(next);
        };
        // Sign out is the host's: it ends the session on a POST to /.auth/logout and sends the
        // browser back here, to sign in again.
        return html\`<main class="mx-auto flex max-w-4xl flex-col gap-4 p-4">
          <header class="flex flex-wrap items-center gap-3 text-sm">
            <span class="font-medium">\${project.slug}</span>
            <span class="text-muted-foreground">as \${info.principal.email || info.principal.actor}</span>
            <form class="ml-auto flex items-center gap-2" onSubmit=\${open}>
              <\${Input} name="path" list="paths" defaultValue=\${path} aria-label="Context" className="h-8 w-64 font-mono" />
              <datalist id="paths">\${project.paths.map((option) => html\`<option key=\${option} value=\${option} />\`)}</datalist>
              <\${Button} type="submit" size="sm">Open<//>
            </form>
            <form method="post" action="/.auth/logout">
              <\${Button} type="submit" variant="outline" size="sm">Sign out<//>
            </form>
          </header>
          <\${Context} key=\${path} path=\${path} />
        </main>\`;
      }

      render(html\`<\${App} />\`, document.getElementById("root"));
    </script>
  </body>
</html>
`,
    {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    },
  );
}
