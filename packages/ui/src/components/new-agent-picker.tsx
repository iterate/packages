// NEW AGENT'S PICKER, the one copy for every page that starts agents: the hosted Agents app's
// home page (agents-home.tsx), and the no-build Agents app in a mind's config repo, which imports
// this module by its name in the published package. What a kind's file may ask of the picker (a
// field for some of its choices, a tick box, a line about the choice) is read and drawn here, so
// the two pages cannot drift apart.
//
// It fetches nothing and keeps no state. The page keeps what the person typed (in its URL or its
// own state), asks the kind for its line (`newAgent.describe`, through the kind's frame) and
// hands both in. The rules that read a kind's file are lib/new-agent.ts.
import { Checkbox } from "#/components/ui/checkbox.tsx";
import { Input } from "#/components/ui/input.tsx";
import { NativeSelect, NativeSelectOption } from "#/components/ui/native-select.tsx";
import {
  newAgentFieldOff,
  newAgentLineParts,
  type NewAgentField,
  type NewAgentOffer,
} from "#/lib/new-agent.ts";

export function NewAgentPicker({
  offers,
  picked,
  values,
  onChoice,
  onField,
  line,
}: {
  offers: NewAgentOffer[];
  /** The picked offer, or none for iterate's own agent. */
  picked: NewAgentOffer | undefined;
  /** The picked offer's fields (`newAgentValues`). */
  values: Record<string, string>;
  /** An offer's `value`, or nothing for iterate. */
  onChoice: (choice: string | undefined) => void;
  onField: (name: string, value: string) => void;
  /** The kind's line about the choice as typed (`newAgent.describe`), where `backticks` mark
   *  code a person may copy. None: no line. */
  line?: string | null;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          size="sm"
          aria-label="Kind of agent"
          value={picked?.value || ""}
          onChange={(event) => onChoice(event.target.value || undefined)}
        >
          <NativeSelectOption value="">iterate</NativeSelectOption>
          {offers.map((offer) => (
            <NativeSelectOption key={offer.value} value={offer.value}>
              {offer.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {picked?.fields.map((field) => (
          <NewAgentFieldInput
            key={`${picked.value}/${field.name}`}
            field={field}
            values={values}
            onField={onField}
          />
        ))}
      </div>
      {picked && line ? (
        <p className="text-xs text-muted-foreground" data-new-agent-line>
          {newAgentLineParts(line).map((part) =>
            part.code ? (
              // code, which a click selects whole
              <code key={part.at} className="rounded bg-muted px-1 font-mono select-all">
                {part.text}
              </code>
            ) : (
              part.text
            ),
          )}
        </p>
      ) : null}
    </>
  );
}

/** One field of the picked choice: a tick box, a list, or a line of text. */
function NewAgentFieldInput({
  field,
  values,
  onField,
}: {
  field: NewAgentField;
  values: Record<string, string>;
  onField: (name: string, value: string) => void;
}) {
  if (field.type === "checkbox")
    return (
      // a box another field turns off (`offWhen`) is there, unticked, and cannot be ticked
      <label className="flex h-7 items-center gap-1.5 text-xs has-disabled:text-muted-foreground">
        <Checkbox
          name={field.name}
          checked={values[field.name] === "on"}
          disabled={newAgentFieldOff(field, values)}
          onCheckedChange={(ticked) => onField(field.name, ticked ? "on" : "")}
        />
        {field.label}
      </label>
    );
  if (field.type === "select" && field.options?.length)
    return (
      <NativeSelect
        size="sm"
        name={field.name}
        aria-label={field.label}
        value={values[field.name] || ""}
        onChange={(event) => onField(field.name, event.target.value)}
        className="font-mono text-xs"
      >
        {field.options.map((option) => (
          <NativeSelectOption key={option} value={option}>
            {option}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    );
  return (
    <Input
      name={field.name}
      aria-label={field.label}
      placeholder={field.label}
      value={values[field.name] || ""}
      onChange={(event) => onField(field.name, event.target.value)}
      className="h-7 w-40 font-mono text-xs"
    />
  );
}
