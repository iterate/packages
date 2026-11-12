// NEW AGENT'S RULES: what a page that starts agents reads from a kind's file (its `newAgent`, as
// the kind's frame reports it), with no React in it. The picker that draws them is
// components/new-agent-picker.tsx. The hosted Agents app and the no-build Agents app in a mind's
// config repo both import these, so a kind's file means the same in both.

/** A field beside the picker, as a kind's file says it (agent-kind-view/types.ts
 *  `AgentKindNewAgentField`): a line of text, or a tick box, whose value is "on" when ticked and
 *  "" when not. */
export type NewAgentField = {
  name: string;
  label: string;
  defaultValue: string;
  type?: "text" | "checkbox";
  /** The ids of the choices that show the field; none: every choice of the kind. */
  choices?: string[];
  /** A first value made for the person who looks: `{name}` is their first name
   *  (`viewerNameOf`), so `"{name}.laptop"` opens as `misha.laptop`. For someone with no such
   *  name the field opens with `defaultValue`. */
  viewerDefault?: string;
  /** A tick box that another field turns off: while the field named `field` has the value `is`,
   *  this box's value is "" and it is drawn unticked and disabled (Remote control, which a
   *  sandbox cannot have). */
  offWhen?: { field: string; is: string };
};

/** Another kind's choice for a new agent, as the picker lists it. */
export type NewAgentOffer = {
  /** `<kind>/<choice>` */
  value: string;
  /** "opencode (acp)" */
  label: string;
  kind: string;
  /** The kind's own id for the choice. */
  choice: string;
  /** The kind's word that this choice's agents may live in a person's folder
   *  (agent-kind-view/types.ts `byPerson`). Without it they are born at `/agents/<kind>/…`. */
  byPerson: boolean;
  /** The fields this choice shows: the kind's, less those for its other choices. */
  fields: NewAgentField[];
};

/** One kind's offers, from what its file reports as `newAgent` (none: no offers). */
export function newAgentOffers(
  kind: string,
  newAgent:
    | { choices: { id: string; label: string; byPerson?: boolean }[]; fields?: NewAgentField[] }
    | undefined,
): NewAgentOffer[] {
  return (newAgent?.choices || []).map((option) => ({
    value: `${kind}/${option.id}`,
    // a choice named as its kind is said once: "claude", not "claude (claude)"
    label: option.label === kind ? option.label : `${option.label} (${kind})`,
    kind,
    choice: option.id,
    byPerson: option.byPerson === true,
    fields: (newAgent?.fields || []).filter(
      (field) => !field.choices || field.choices.includes(option.id),
    ),
  }));
}

/** A person's first name for a field's first value (`viewerDefault`), from their folder name
 *  (lib/agent-summary.ts `personOf`: the local part of the address they sign in with): the part
 *  before its first "-", so `misha-k-work` is `misha`. Nothing when that part does not start with
 *  a letter: the name goes into a lend's name, whose parts are identifiers. */
export function viewerNameOf(person: string | undefined): string | undefined {
  const first = person?.split("-")[0] || "";
  return /^[a-z][a-z0-9]*$/.test(first) ? first : undefined;
}

/** Whether another field's value turns this tick box off (`offWhen`), given every field's value. */
export function newAgentFieldOff(field: NewAgentField, values: Record<string, string>): boolean {
  return Boolean(field.offWhen) && values[field.offWhen!.field] === field.offWhen!.is;
}

/** The picked offer's fields, each by its name: what the person typed (`typed(name)`, nothing
 *  when they typed none), else the field's own first value, which may be made for `person`
 *  (`viewerDefault`). A box that another field turns off is "" whatever was typed (`offWhen`).
 *  These are what the kind's `start` and `describe` are given. */
export function newAgentValues(
  offer: NewAgentOffer | undefined,
  typed: (name: string) => string | null | undefined,
  person?: string,
): Record<string, string> {
  const name = viewerNameOf(person);
  const fields = offer?.fields || [];
  const values = Object.fromEntries(
    fields.map((field) => {
      const first =
        name && field.viewerDefault
          ? field.viewerDefault.replaceAll("{name}", name)
          : field.defaultValue;
      return [field.name, typed(field.name) ?? first];
    }),
  );
  return Object.fromEntries(
    fields.map((field) => [field.name, newAgentFieldOff(field, values) ? "" : values[field.name]!]),
  );
}

/** A kind's line about a choice, in its parts in order: plain text, and code (what the kind put
 *  between `backticks`). `at` is where the part starts in the line. */
export function newAgentLineParts(line: string): { at: number; text: string; code: boolean }[] {
  let at = 0;
  return line.split("`").flatMap((text, index) => {
    const part = { at, text, code: index % 2 === 1 };
    // the next part starts after this one and the backtick that ended it
    at += text.length + 1;
    return text ? [part] : [];
  });
}
