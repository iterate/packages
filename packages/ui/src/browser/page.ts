// What a no-build page needs to render this package's components with the React they use: htm's
// `html` tag over React's createElement, `render` into an element, and React's API.
//
//   import { html, render, useState } from "@iterate-com/ui/page";
//   import { ContextView } from "@iterate-com/ui/components/context-view/context-view";
//   render(html`<${ContextView} … />`, document.getElementById("root"));
import htm from "htm";
import { createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

export * from "./react.ts";
export const html = htm.bind(createElement);

export function render(node: ReactNode, element: Element) {
  createRoot(element).render(node);
}
