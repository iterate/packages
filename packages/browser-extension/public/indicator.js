// indicator.js — what the person sees on a tab while the mind's debugger is attached to it: a frame
// on the viewport's edge and a label, top center, with the mind's address, what it does and a Stop
// button. panel.js runs this function as `(<this file>)("<address>")` in the isolated world
// "iterate-indicator" of the top frame: on each page the tab loads while the debugger is attached,
// and on the page that shows when it attaches. The page's own scripts do not see that world, and the
// shadow root is closed, so the page's CSS cannot reach inside it.
//
// The host element is the only thing the panel and this script share: the panel writes its
// attributes from a world of its own. `data-activity="<word> <time>"` means the mind acts now (the
// time makes a repeat of the same word a change); `data-hidden` hides everything while the mind
// takes a screenshot. Stop calls `iterateIndicatorStop`, a CDP binding only this world has.
// `data-alive="<time>"` is the panel's heartbeat, every 4 s: a binding outlives its debugger
// session, so the page cannot tell that the debugger went, and without a heartbeat for 12 s the
// indicator removes itself.
// oxlint-disable-next-line no-unused-vars -- panel.js calls it, by its source text
function iterateIndicator(mind) {
  if (window !== window.top) return;
  /** How long the label says what the mind does, after its last command. */
  const ACTING_MS = 3_000;
  /** The highest z-index: above everything the page draws. */
  const TOP = 2 ** 31 - 1;
  /** How long the indicator stays without a heartbeat (`data-alive` or `data-activity`). */
  const ALIVE_MS = 12_000;

  const css = `
    .root {
      all: initial;
      --iterate: 99 102 241;
    }
    .frame {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: ${TOP};
      box-shadow:
        inset 0 0 0 3px rgb(var(--iterate) / 0.5),
        inset 0 0 10px rgb(var(--iterate) / 0.25);
      transition: box-shadow 0.4s;
    }
    .acting .frame {
      box-shadow:
        inset 0 0 0 5px rgb(var(--iterate)),
        inset 0 0 36px rgb(var(--iterate) / 0.7);
      animation: pulse 1.2s ease-in-out infinite;
    }
    @keyframes pulse {
      50% {
        box-shadow:
          inset 0 0 0 4px rgb(var(--iterate) / 0.9),
          inset 0 0 20px rgb(var(--iterate) / 0.5);
      }
    }
    .label {
      position: fixed;
      top: 8px;
      left: 50%;
      transform: translateX(-50%);
      z-index: ${TOP};
      pointer-events: auto;
      box-sizing: border-box;
      height: 28px;
      max-width: calc(100vw - 16px);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 4px 0 10px;
      border-radius: 14px;
      background: #18181b;
      color: #fafafa;
      font: 500 12px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      white-space: nowrap;
      box-shadow:
        0 2px 10px rgb(0 0 0 / 0.35),
        0 0 0 1px rgb(255 255 255 / 0.14);
    }
    .acting .label {
      box-shadow:
        0 2px 10px rgb(0 0 0 / 0.35),
        0 0 0 2px rgb(var(--iterate));
    }
    .dot {
      flex: none;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: rgb(var(--iterate));
    }
    .acting .dot {
      animation: blink 1s ease-in-out infinite;
    }
    @keyframes blink {
      50% {
        opacity: 0.35;
      }
    }
    .text {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    button {
      all: unset;
      flex: none;
      height: 20px;
      padding: 0 9px;
      border-radius: 10px;
      background: rgb(255 255 255 / 0.15);
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    button:hover {
      background: rgb(255 255 255 / 0.25);
    }
    button:focus-visible {
      outline: 2px solid rgb(var(--iterate));
    }
    button:disabled {
      cursor: default;
      opacity: 0.6;
    }
    .hidden .frame,
    .hidden .label {
      display: none;
    }
    @media (prefers-reduced-motion: reduce) {
      .frame {
        transition: none;
      }
      .acting .frame,
      .acting .dot {
        animation: none;
      }
    }`;

  const install = () => {
    const page = document.documentElement;
    if (!page || page.querySelector(":scope > iterate-indicator")) return;
    const host = document.createElement("iterate-indicator");
    const shadow = host.attachShadow({ mode: "closed" });
    // A constructed sheet, not a <style> element: a page's CSP does not apply to it.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [sheet];
    // Elements, not innerHTML: a page that enforces Trusted Types refuses an HTML string.
    const make = (tag, className) => {
      const made = document.createElement(tag);
      if (className) made.className = className;
      return made;
    };
    const root = make("div", "root");
    const label = make("div", "label");
    label.setAttribute("role", "status");
    const text = make("span", "text");
    const stop = make("button");
    stop.type = "button";
    stop.textContent = "Stop";
    stop.title = `${mind} lets go of this tab, and the tab leaves its group`;
    label.append(make("span", "dot"), text, stop);
    root.append(make("div", "frame"), label);
    shadow.append(root);

    const idle = `${mind} is using this tab`;
    text.textContent = idle;
    let settle;
    const update = () => {
      root.classList.toggle("hidden", host.hasAttribute("data-hidden"));
      const word = (host.getAttribute("data-activity") || "").replace(/ \d+$/, "");
      clearTimeout(settle);
      if (!word) return;
      root.classList.add("acting");
      text.textContent = `${mind} is ${word}`;
      settle = setTimeout(() => {
        root.classList.remove("acting");
        text.textContent = idle;
      }, ACTING_MS);
    };
    // A new page gets its indicator before any heartbeat: the 12 s start at install.
    let alive;
    const live = () => {
      clearTimeout(alive);
      alive = setTimeout(() => {
        watcher.disconnect();
        clearTimeout(settle);
        host.remove();
      }, ALIVE_MS);
    };
    const watcher = new MutationObserver((changes) => {
      const changed = new Set(changes.map((change) => change.attributeName));
      if (changed.has("data-alive") || changed.has("data-activity")) live();
      // `data-hidden` alone must not restart the 3 s of the last action.
      if (changed.has("data-activity")) update();
      else root.classList.toggle("hidden", host.hasAttribute("data-hidden"));
    });
    watcher.observe(host, {
      attributes: true,
      attributeFilter: ["data-activity", "data-alive", "data-hidden"],
    });
    live();

    stop.addEventListener("click", () => {
      stop.disabled = true;
      text.textContent = `${mind} is letting go…`;
      globalThis.iterateIndicatorStop?.("stop");
    });
    page.append(host);
  };

  // A script for a new page runs before the page has elements.
  if (document.readyState === "loading" || !document.documentElement)
    document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
}
