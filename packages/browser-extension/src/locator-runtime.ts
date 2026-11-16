import { Ivya, getByLabelSelector, getByRoleSelector, getByTextSelector } from "ivya";
import { getAriaDisabled, isElementVisible } from "ivya/utils";
import type { Probe, Step } from "./page.ts";

const engine = Ivya.create({ browser: "chromium", testIdAttribute: "data-testid" });
const identities = new WeakMap<Element, number>();
let nextIdentity = 0;

export function probe(steps: Step[], action: string, commitId?: number): Probe {
  const selector = steps
    .map((step) => {
      switch (step.kind) {
        case "css":
          return step.selector;
        case "role":
          return getByRoleSelector(step.role, { exact: false, ...step.options });
        case "text":
          return getByTextSelector(step.text, { exact: false, ...step.options });
        case "label":
          return getByLabelSelector(step.text, { exact: false, ...step.options });
        case "nth":
          return `nth=${step.index}`;
      }
    })
    .join(" >> ");
  let matches: Element[];
  try {
    matches = engine.queryLocatorSelectorAll(selector, document.documentElement);
  } catch (error) {
    return { status: "fatal", detail: String(error) };
  }
  if (action === "count") return { status: "value", value: matches.length };
  if (matches.length > 1)
    return {
      status: "fatal",
      detail: `strict mode violation: ${matches.length} matches for ${selector}: ${matches
        .slice(0, 5)
        .map((el) => el.outerHTML.slice(0, 180))
        .join("\n")}`,
    };
  const el = matches[0];
  if (!el) return { status: "wait", detail: `no match for ${selector}` };
  if (action === "textContent") return { status: "value", value: el.textContent };
  if (el instanceof HTMLIFrameElement)
    return { status: "fatal", detail: "Frame controls are unsupported; use raw CDP." };
  if (!isElementVisible(el)) return { status: "wait", detail: "element is hidden" };
  if (getAriaDisabled(el) || el.matches(":disabled") || inert(el))
    return { status: "wait", detail: "element is disabled or inert" };
  if (action === "fill") {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement))
      return { status: "fatal", detail: "fill supports text inputs and textareas only" };
    if (
      el instanceof HTMLInputElement &&
      !["text", "search", "email", "tel", "url", "password"].includes(el.type)
    )
      return { status: "fatal", detail: `fill does not support input type ${el.type}` };
    if (el.readOnly || el.getAttribute("aria-readonly") === "true")
      return { status: "wait", detail: "element is read-only" };
  }
  el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  const rect = el.getBoundingClientRect();
  const x = (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2;
  const y = (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2;
  if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight)
    return { status: "wait", detail: "element is outside the viewport" };
  let hit = document.elementFromPoint(x, y);
  while (hit?.shadowRoot) {
    const inner = hit.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  if (!contains(el, hit))
    return { status: "wait", detail: `element is covered by ${hit?.tagName || "the viewport"}` };
  const id = identities.get(el) ?? ++nextIdentity;
  identities.set(el, id);
  if (commitId !== undefined) {
    if (id !== commitId) return { status: "wait", detail: "element was replaced" };
    if (action === "fill" || action === "press") {
      if (!(el instanceof HTMLElement))
        return { status: "fatal", detail: "element cannot receive keyboard input" };
      el.focus({ preventScroll: true });
      let active = document.activeElement;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      if (active !== el) return { status: "wait", detail: "element did not receive focus" };
      if (
        action === "fill" &&
        (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)
      )
        el.select();
    }
  }
  return { status: "ready", id, box: [x, y, rect.width, rect.height] };
}

function contains(outer: Element, node: Node | null): boolean {
  for (let current = node; current; current = renderedParent(current))
    if (current === outer) return true;
  return false;
}

function inert(el: Element): boolean {
  for (let current: Node | null = el; current; current = renderedParent(current)) {
    if (current instanceof Element && current.hasAttribute("inert")) return true;
  }
  return false;
}

function renderedParent(node: Node): Node | null {
  const slot = node instanceof Element || node instanceof Text ? node.assignedSlot : null;
  return slot || node.parentNode || (node instanceof ShadowRoot ? node.host : null);
}
