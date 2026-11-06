/** A parsed itx expression as the call it spells: `["itx","builtins",["get","x"],"run"]` →
 *  `itx.builtins.get("x").run`. Anything else, as compact JSON. */
export function printExpression(expression: unknown): string {
  if (typeof expression === "string") return expression;
  if (!Array.isArray(expression)) return compactJson(expression, 240);
  const steps: string[] = [];
  for (const step of expression) {
    if (typeof step === "string") steps.push(step);
    else if (Array.isArray(step) && typeof step[0] === "string")
      steps.push(
        `${step[0]}(${step
          .slice(1)
          .map((arg) => compactJson(arg, 80))
          .join(", ")})`,
      );
    else return compactJson(expression, 240);
  }
  return steps.join(".");
}

/** A value as one line of JSON, cut at `max` characters. */
export function compactJson(value: unknown, max: number): string {
  let text: string;
  try {
    text = JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    );
  } catch {
    text = String(value);
  }
  text ||= String(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
