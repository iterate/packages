// @vitest-environment jsdom
// New agent's picker: what it draws and reports, with the vendored Input and Checkbox as the pages
// have them. What it reads from a kind's file is lib/new-agent.test.ts's.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { newAgentOffers, type NewAgentOffer } from "../lib/new-agent.ts";
import { NewAgentPicker } from "./new-agent-picker.tsx";

/** A kind's `newAgent` as its frame reports it: two choices, a field for both and one for the first. */
const ACP = {
  choices: [
    { id: "claude", label: "claude" },
    { id: "codex", label: "codex" },
  ],
  fields: [
    { name: "runner", label: "Runner", defaultValue: "acp.sandbox" },
    {
      name: "remoteControl",
      label: "Remote control",
      type: "checkbox" as const,
      defaultValue: "on",
      choices: ["claude"],
    },
  ],
};

test("the picker draws the picked choice's fields as typed, reports each change, and shows the kind's line with its code", async () => {
  const [claude, codex] = newAgentOffers("acp", ACP) as [NewAgentOffer, NewAgentOffer];
  const said: [string, string][] = [];
  const chosen: (string | undefined)[] = [];
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const draw = (picked: NewAgentOffer | undefined, values: Record<string, string>, line?: string) =>
    act(() =>
      root.render(
        <NewAgentPicker
          offers={[claude, codex]}
          picked={picked}
          values={values}
          onChoice={(choice) => chosen.push(choice)}
          onField={(name, value) => said.push([name, value])}
          line={line}
        />,
      ),
    );
  const box = () => host.querySelector<HTMLElement>('[role="checkbox"]');
  const text = () => host.querySelector<HTMLInputElement>('input[name="runner"]');

  // iterate's own agent: the choices, no field, no line
  await draw(undefined, {});
  expect([...host.querySelectorAll("option")].map((option) => option.textContent)).toEqual([
    "iterate",
    "claude (acp)",
    "codex (acp)",
  ]);
  expect([box(), text(), host.querySelector("[data-new-agent-line]")]).toEqual([null, null, null]);

  // Claude: its runner as typed, its box ticked, and the kind's line, whose code is a <code>
  await draw(
    claude,
    { runner: "acp.misha", remoteControl: "on" },
    "On a computer lent as acp.misha. Run `run.sh` there.",
  );
  expect(text()?.value).toBe("acp.misha");
  expect(box()?.getAttribute("aria-checked")).toBe("true");
  expect(host.querySelector("[data-new-agent-line]")?.textContent).toBe(
    "On a computer lent as acp.misha. Run run.sh there.",
  );
  expect([...host.querySelectorAll("code")].map((code) => code.textContent)).toEqual(["run.sh"]);

  // a click on the box reports it unticked; the page then hands that value back
  await act(() => box()!.click());
  expect(said).toEqual([["remoteControl", ""]]);
  await draw(claude, { runner: "acp.misha", remoteControl: "" });
  expect(box()?.getAttribute("aria-checked")).toBe("false");
  expect(host.querySelector("[data-new-agent-line]")).toBeNull();

  // Codex has the runner and no box
  await draw(codex, { runner: "acp.sandbox" });
  expect([text()?.value, box()]).toEqual(["acp.sandbox", null]);

  // a box that its runner turns off is drawn unticked and cannot be ticked
  const [sandboxed] = newAgentOffers("acp", {
    ...ACP,
    fields: [ACP.fields[0], { ...ACP.fields[1], offWhen: { field: "runner", is: "acp.sandbox" } }],
  }) as [NewAgentOffer];
  await draw(sandboxed, { runner: "acp.sandbox", remoteControl: "" });
  expect([box()?.getAttribute("aria-checked"), box()?.hasAttribute("data-disabled")]).toEqual([
    "false",
    true,
  ]);
  await act(() => box()!.click());
  expect(said).toEqual([["remoteControl", ""]]);
  await draw(sandboxed, { runner: "acp.misha", remoteControl: "on" });
  expect([box()?.getAttribute("aria-checked"), box()?.hasAttribute("data-disabled")]).toEqual([
    "true",
    false,
  ]);

  // picking another kind, and iterate again
  const select = host.querySelector("select")!;
  await act(() => {
    select.value = "acp/claude";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(() => {
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(chosen).toEqual(["acp/claude", undefined]);
  await act(() => root.unmount());
});
