// serves.ts — WHETHER A MIND SERVES `itx.<root>`, a part that not every stack has (telemetry, the
// vault, the integrations), as the Dash's sidebar, its cards and its pages ask it.
import type { AuthenticatedApp } from "iterate/app";

/** Asked once for the life of the page, whoever asks: a promise a component can `use`. */
const served = new WeakMap<object, Map<string, Promise<boolean>>>();
export function servesOf(itx: AuthenticatedApp["itx"], root: string): Promise<boolean> {
  const known = served.get(itx) || new Map<string, Promise<boolean>>();
  served.set(itx, known);
  let answer = known.get(root);
  if (!answer) {
    answer = Promise.resolve(itx.rewriteRules.get(`itx.${root}`)).then(
      (rule) => Boolean(rule?.target),
      () => false,
    );
    known.set(root, answer);
  }
  return answer;
}
