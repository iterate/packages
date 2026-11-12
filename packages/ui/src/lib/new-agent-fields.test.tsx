// @vitest-environment jsdom
// New agent's fields as the picker draws them (the vendored Input and Checkbox), and their values
// as the start reads them.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { newAgentFieldValues } from "./new-agent-fields.ts";
import { Checkbox } from "#/components/ui/checkbox.tsx";
import { Input } from "#/components/ui/input.tsx";

test("a text field is read as typed, and a tick box as 'on' when ticked and nothing when not", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  await act(() =>
    root.render(
      <div>
        <Input name="runner" defaultValue="acp.sandbox" />
        <label>
          <Checkbox name="remoteControl" defaultChecked />
          Remote control
        </label>
        <label>
          <Checkbox name="quiet" />
          Quiet
        </label>
      </div>,
    ),
  );
  expect(newAgentFieldValues(host)).toEqual({
    runner: "acp.sandbox",
    remoteControl: "on",
    quiet: "",
  });
  // a person unticks the first box by its label, and ticks the second
  const [remote, quiet] = [...host.querySelectorAll<HTMLElement>('[role="checkbox"]')];
  await act(() => remote!.click());
  await act(() => quiet!.click());
  expect(newAgentFieldValues(host)).toEqual({
    runner: "acp.sandbox",
    remoteControl: "",
    quiet: "on",
  });
  // nothing drawn: no values
  expect(newAgentFieldValues(null)).toEqual({});
  await act(() => root.unmount());
});
