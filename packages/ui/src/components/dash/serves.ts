// serves.ts — WHETHER A MIND SERVES `itx.<root>`, a part that not every stack has (telemetry, the
// vault, the integrations), as the Dash's sidebar, its cards and its pages ask it.
import type { AuthenticatedApp } from "iterate/app";
import { keptRead, type KeptRead } from "#/lib/itx-session.ts";

/** Asked once for the life of the page, whoever asks: a promise a component can `use`, the same
 *  one at every render. An ask that failed answers no. That answer stands too, and is asked
 *  again only when the session it failed with was gone and a new one has opened (`keptRead`). */
const served = new WeakMap<object, Map<string, KeptRead<boolean>>>();
export function servesOf(itx: AuthenticatedApp["itx"], root: string): Promise<boolean> {
  const known = served.get(itx) || new Map<string, KeptRead<boolean>>();
  served.set(itx, known);
  const asked = keptRead(itx, known.get(root), (failed) =>
    Promise.resolve(itx.rewriteRules.get(`itx.${root}`)).then(
      (rule) => Boolean(rule?.target),
      () => {
        failed();
        return false;
      },
    ),
  );
  known.set(root, asked);
  return asked.answer;
}
