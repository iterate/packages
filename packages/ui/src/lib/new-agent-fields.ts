// The values of New agent's fields, read from the page when the first message is sent: the hosted
// Agents app's picker keeps them in the DOM (components/agents-home.tsx).

/** Each field drawn inside `within`, by its name: a line of text as typed, and a tick box "on"
 *  when ticked and "" when not. A tick box's own `value` is "on" whether it is ticked or not, so
 *  it is read by `checked`. */
export function newAgentFieldValues(
  within: Pick<ParentNode, "querySelectorAll"> | null,
): Record<string, string> {
  return Object.fromEntries(
    [...(within?.querySelectorAll<HTMLInputElement>("input[name]") || [])].map((field) => {
      const ticked = field.checked ? "on" : "";
      return [field.name, field.type === "checkbox" ? ticked : field.value];
    }),
  );
}
