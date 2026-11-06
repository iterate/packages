/** `step` with what it made last held for its next call, so a pass over a growing log redoes only
 *  what grew. A view keeps one for its life (`useState(() => remembered(step))`) and calls it from a
 *  `useMemo`. `step` must take what it made last and answer the same for the same input, since
 *  React can replay a render: a replayed call then finds nothing new. */
export function remembered<Held, Input extends unknown[]>(
  step: (held: Held | undefined, ...input: Input) => Held,
) {
  let held: Held | undefined;
  return (...input: Input) => (held = step(held, ...input));
}
