// @vitest-environment jsdom
// <change-my-mind> copies what the React button copies.
import "./change-my-mind.ts";
import { expect, test, vi } from "vitest";
import { changeMyMindInstructions } from "#/lib/change-my-mind.ts";

test("the element copies the built instructions, or its own text, and says so", async () => {
  const writeText = vi.fn(() => Promise.resolve());
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const element = document.createElement("change-my-mind");
  element.setAttribute("source", "https://blog.example.com/");
  element.setAttribute("scope", "blog");
  element.setAttribute("variant", "outline");
  document.body.append(element);
  const copies: unknown[] = [];
  element.addEventListener("change-my-mind-copy", (event) =>
    copies.push((event as CustomEvent).detail),
  );

  element.shadowRoot!.querySelector("button")!.click();
  await vi.waitFor(() => expect(copies).toHaveLength(1));
  const text = changeMyMindInstructions({ source: "https://blog.example.com/", scope: "blog" });
  expect(writeText).toHaveBeenCalledWith(text);
  expect(copies[0]).toEqual({ copied: true, text });
  expect(element.shadowRoot!.querySelector("[role=status]")?.textContent).toBe(
    "Copied to clipboard. Paste it to your iterate mind.",
  );

  element.textContent = "Make me a cup of tea.";
  element.shadowRoot!.querySelector("button")!.click();
  await vi.waitFor(() => expect(copies).toHaveLength(2));
  expect(writeText).toHaveBeenLastCalledWith("Make me a cup of tea.");
  element.remove();
});
