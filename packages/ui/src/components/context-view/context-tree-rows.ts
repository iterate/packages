export type TreeRow = { path: string; name: string; depth: number; context: boolean };

/** The paths as tree rows, depth first in segment order; every ancestor a row, `/` the first. */
export function contextTreeRows(paths: readonly string[]): TreeRow[] {
  const known = new Set(["/", ...paths]);
  const all = new Set<string>(["/"]);
  for (const path of known) {
    const segments = path.split("/").filter(Boolean);
    for (let at = 1; at <= segments.length; at++) all.add(`/${segments.slice(0, at).join("/")}`);
  }
  return [...all]
    .map((path) => path.split("/").filter(Boolean))
    .sort((a, b) => {
      for (let at = 0; at < Math.min(a.length, b.length); at++)
        if (a[at] !== b[at]) return a[at]! < b[at]! ? -1 : 1;
      return a.length - b.length;
    })
    .map((segments) => {
      const path = `/${segments.join("/")}`;
      return {
        path,
        name: segments.at(-1) ?? "/",
        depth: segments.length,
        context: known.has(path),
      };
    });
}
