// change-my-mind.ts — `<change-my-mind>`, the "Change my mind" button for a page with no React (a
// plain HTML blog): one script tag defines it, and it brings no React and no stylesheet.
//
//   <script type="module" src="https://esm.iterate.com/@iterate-com/ui@<version>/change-my-mind"></script>
//   <change-my-mind source="https://blog.example.com/a-post"></change-my-mind>
//
// Attributes: `source` (the post; by default this page without query or hash), `scope="blog"` (the
// whole blog: its feed and README), `instructions` (the exact text; the element's own text does the
// same), `size="sm"` (for a list), `variant="outline"` (the kit's outline Button, quieter), `align="end"` (the tooltip and the card line up with the right
// edge). It dispatches `change-my-mind-copy` ({ copied, text }) after each press.
//
// It looks like the kit's ChangeMyMindButton (components/change-my-mind-button.tsx) and says the
// same words (lib/change-my-mind.ts). Its shadow DOM reads the kit's tokens (`--primary`, `--radius`,
// …) when the page has them, so a page with the kit's stylesheet and its `dark` class gets its look;
// on any other page it takes shadcn's neutral values: dark on a page whose color-scheme is dark,
// light on any other, as the kit's look is light unless the page says otherwise. It takes the
// page's font.
import {
  changeMyMindInstructions,
  changeMyMindText,
  changeMyMindTimes,
  copyToClipboard,
  currentPageSource,
  iterateMark,
  type ChangeMyMindScope,
} from "#/lib/change-my-mind.ts";

const markSvg = `<svg viewBox="${iterateMark.viewBox}" aria-hidden="true" focusable="false" fill="currentColor">${iterateMark.paths.map((path) => `<path d="${path}"/>`).join("")}</svg>`;
// lucide's "check" (https://lucide.dev, ISC license), the icon the React button shows
const checkSvg = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
const fonts = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
const hoverDelay = 300;

// The kit's Button (default variant), Tooltip and Popover, in plain CSS: each value is the kit's
// token, with shadcn's neutral value (globals.css) for a page that has none.
const css = `
:host{display:inline-block;vertical-align:middle;font-family:inherit;letter-spacing:normal;text-align:left;line-height:normal}
.wrap{position:relative;display:inline-block;
  --p:var(--primary,light-dark(oklch(.205 0 0),oklch(.922 0 0)));--pf:var(--primary-foreground,light-dark(oklch(.985 0 0),oklch(.205 0 0)));
  --fg:var(--foreground,light-dark(oklch(.145 0 0),oklch(.985 0 0)));--bg:var(--background,light-dark(oklch(1 0 0),oklch(.145 0 0)));
  --pop:var(--popover,light-dark(oklch(1 0 0),oklch(.205 0 0)));--popf:var(--popover-foreground,light-dark(oklch(.145 0 0),oklch(.985 0 0)));
  --muted:var(--muted-foreground,light-dark(oklch(.556 0 0),oklch(.708 0 0)));--line:var(--border,light-dark(oklch(.922 0 0),oklch(1 0 0/10%)));
  --ring-c:var(--ring,light-dark(oklch(.708 0 0),oklch(.556 0 0)));
  --in:var(--input,light-dark(oklch(.922 0 0),oklch(1 0 0/15%)));--mbg:var(--muted,light-dark(oklch(.97 0 0),oklch(.269 0 0)));--o-line:light-dark(var(--line),var(--in));--r:var(--radius,.625rem)}
*{box-sizing:border-box}
button{all:unset;box-sizing:border-box;display:inline-flex;align-items:stretch;height:2rem;border:1px solid transparent;background-clip:padding-box;border-radius:var(--r);overflow:hidden;
  background:var(--p);color:var(--pf);font-family:inherit;font-size:.875rem;font-weight:500;line-height:1.25rem;white-space:nowrap;cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent;
  transition:all .15s cubic-bezier(.4,0,.2,1)}
button:hover{background:color-mix(in oklab,var(--p) 80%,transparent)}
button:active{translate:0 1px}
button:focus-visible{border-color:var(--ring-c);box-shadow:0 0 0 3px color-mix(in oklab,var(--ring-c) 50%,transparent)}
.mark{display:flex;align-items:center;justify-content:center;width:2rem;flex:none;border-right:1px solid color-mix(in oklab,var(--pf) 20%,transparent)}
.mark svg{width:1rem;height:1rem;display:block}
.label{display:grid;padding:0 .625rem}
.label>span{grid-area:1/1;display:inline-flex;align-items:center;justify-content:center;gap:.375rem}
.label svg{width:1rem;height:1rem;flex:none}
.copied .label .idle,.label .done{visibility:hidden}
.copied .label .done{visibility:visible}
:host([variant=outline]) button{background:light-dark(var(--bg),color-mix(in oklab,var(--in) 30%,transparent));border-color:var(--o-line);color:var(--fg)}
:host([variant=outline]) button:hover,:host([variant=outline]) .open button{background:light-dark(var(--mbg),color-mix(in oklab,var(--in) 50%,transparent));color:var(--fg)}
:host([variant=outline]) button:focus-visible{border-color:var(--ring-c)}
:host([variant=outline]) .mark{border-right-color:var(--o-line);color:var(--fg)}
:host([size=sm]) button{height:1.75rem;font-size:.8rem;border-radius:min(calc(var(--r) - 2px),12px)}
:host([size=sm]) .mark{width:1.75rem}
:host([size=sm]) .mark svg,:host([size=sm]) .label svg{width:.875rem;height:.875rem}
:host([size=sm]) .label{padding:0 .5rem}
.pop{position:absolute;left:0;z-index:9999;width:max-content;opacity:0;visibility:hidden;pointer-events:none;
  transition:opacity .1s,visibility .1s,scale .1s;scale:.95;font-family:inherit;text-align:left}
:host([align=end]) .pop{left:auto;right:0}
.tip{bottom:calc(100% + 6px);transform-origin:bottom left;max-width:min(16rem,calc(100vw - 2rem));padding:.375rem .75rem;border-radius:calc(var(--r) - 2px);background:var(--fg);color:var(--bg);font-size:.75rem;line-height:1rem;font-weight:400}
.wrap.hover:not(.quiet):not(.open) .tip,.wrap:not(.quiet):not(.open) button:focus-visible~.tip{opacity:1;visibility:visible;scale:1}
.note{top:calc(100% + 6px);transform-origin:top left;display:flex;flex-direction:column;gap:.375rem;max-width:min(18rem,calc(100vw - 2rem));padding:.625rem;border-radius:var(--r);
  background:var(--pop);color:var(--popf);box-shadow:0 0 0 1px color-mix(in oklab,var(--fg) 10%,transparent),0 4px 6px -1px rgb(0 0 0/.1),0 2px 4px -2px rgb(0 0 0/.1);
  font-size:.875rem;line-height:1.25rem;font-weight:400}
.open .note{opacity:1;visibility:visible;pointer-events:auto;scale:1}
.note p{margin:0}
.note a{width:fit-content;color:var(--muted);text-decoration:underline;text-underline-offset:3px}
.note a:hover{color:var(--popf)}
.note a:focus-visible{outline:2px solid var(--ring-c);outline-offset:2px;border-radius:2px}
.note.wide{max-width:min(24rem,calc(100vw - 2rem))}
.note textarea{display:block;width:min(22.75rem,calc(100vw - 3.25rem));height:9rem;padding:.5rem .625rem;border:1px solid var(--line);border-radius:var(--r);
  font:.75rem/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--popf);background:transparent;resize:vertical}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@media (prefers-reduced-motion:reduce){button,.pop{transition:none}}
`;

let count = 0;

// Outside a browser (a test, a server render) the module still loads.
// the cast: the empty class stands in for HTMLElement only where no element is ever made
const Base = globalThis.HTMLElement || (class {} as typeof HTMLElement);

export class ChangeMyMindElement extends Base {
  #wrap?: HTMLElement;
  #note?: HTMLElement;
  #status?: HTMLElement;
  #hover?: ReturnType<typeof setTimeout>;
  #labelTimer?: ReturnType<typeof setTimeout>;
  #noteTimer?: ReturnType<typeof setTimeout>;
  #away = (event: PointerEvent) => {
    if (!event.composedPath().includes(this)) this.#close();
  };

  connectedCallback() {
    if (this.shadowRoot) return;
    const id = `change-my-mind-${++count}`;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${css}</style><span class="wrap"><button type="button" part="button" aria-describedby="${id}"><span class="mark">${markSvg}</span><span class="label"><span class="idle">${changeMyMindText.label}</span><span class="done">${checkSvg}${changeMyMindText.copied}</span></span></button><div class="pop tip" id="${id}" role="tooltip" part="tooltip">${changeMyMindText.tooltip}</div><div class="pop note" part="note"></div><span class="sr" role="status" aria-live="polite"></span></span>`;
    const wrap = root.querySelector<HTMLElement>(".wrap")!;
    const button = root.querySelector("button")!;
    this.#wrap = wrap;
    this.#note = root.querySelector<HTMLElement>(".note")!;
    this.#status = root.querySelector<HTMLElement>(".sr")!;
    const style = getComputedStyle(this);
    // the page's font, unless the page set none (the browser's default serif)
    if (/^"?(Times|serif)/i.test(style.fontFamily)) wrap.style.fontFamily = fonts;
    button.addEventListener("click", () => void this.copy());
    // the tooltip: after a short delay for a mouse, at once on keyboard focus (CSS), never on touch
    button.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "mouse") return;
      clearTimeout(this.#hover);
      this.#hover = setTimeout(() => wrap.classList.add("hover"), hoverDelay);
    });
    button.addEventListener("pointerleave", () => {
      clearTimeout(this.#hover);
      wrap.classList.remove("hover", "quiet");
    });
    button.addEventListener("blur", () => wrap.classList.remove("quiet"));
    this.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      wrap.classList.add("quiet");
      this.#close();
    });
    // the card stays while the pointer or the focus is in it, so that its link can be reached
    this.#note.addEventListener("pointerenter", () => clearTimeout(this.#noteTimer));
    this.#note.addEventListener("focusin", () => clearTimeout(this.#noteTimer));
    this.#note.addEventListener("pointerleave", () => this.#closeLater());
    this.#note.addEventListener("focusout", () => this.#closeLater());
  }

  disconnectedCallback() {
    document.removeEventListener("pointerdown", this.#away);
    clearTimeout(this.#hover);
    clearTimeout(this.#labelTimer);
    clearTimeout(this.#noteTimer);
  }

  /** The text a press copies: the `instructions` attribute, the element's text, or the built one. */
  get instructions(): string {
    const given = (this.getAttribute("instructions") || this.textContent || "").trim();
    const scope: ChangeMyMindScope = this.getAttribute("scope") === "blog" ? "blog" : "post";
    return (
      given ||
      changeMyMindInstructions({
        source: this.getAttribute("source") || currentPageSource(),
        scope,
      })
    );
  }

  async copy(): Promise<boolean> {
    const text = this.instructions;
    const copied = await copyToClipboard(text);
    this.#open(copied, text);
    this.dispatchEvent(
      new CustomEvent("change-my-mind-copy", {
        bubbles: true,
        composed: true,
        detail: { copied, text },
      }),
    );
    return copied;
  }

  #open(copied: boolean, text: string) {
    const wrap = this.#wrap!;
    const note = this.#note!;
    clearTimeout(this.#hover);
    clearTimeout(this.#labelTimer);
    wrap.classList.remove("hover");
    wrap.classList.toggle("copied", copied);
    if (copied)
      this.#labelTimer = setTimeout(() => wrap.classList.remove("copied"), changeMyMindTimes.label);
    const words = copied ? changeMyMindText.copiedNote : changeMyMindText.uncopiedNote;
    const paragraph = document.createElement("p");
    paragraph.textContent = words;
    note.replaceChildren(paragraph);
    note.classList.toggle("wide", !copied);
    if (!copied) {
      const box = document.createElement("textarea");
      box.readOnly = true;
      box.value = text;
      box.setAttribute("aria-label", changeMyMindText.textBoxLabel);
      note.append(box);
      requestAnimationFrame(() => {
        box.focus();
        box.select();
      });
    }
    const link = document.createElement("a");
    link.href = changeMyMindText.getOneHref;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = changeMyMindText.getOne;
    note.append(link);
    this.#status!.textContent = words;
    wrap.classList.add("open");
    document.removeEventListener("pointerdown", this.#away);
    setTimeout(() => document.addEventListener("pointerdown", this.#away));
    // a failed copy keeps its text box until Escape or a click elsewhere
    if (copied) this.#closeLater();
  }

  #closeLater() {
    clearTimeout(this.#noteTimer);
    if (this.#note?.classList.contains("wide")) return;
    this.#noteTimer = setTimeout(() => this.#close(), changeMyMindTimes.note);
  }

  #close() {
    clearTimeout(this.#noteTimer);
    document.removeEventListener("pointerdown", this.#away);
    this.#wrap?.classList.remove("open");
    if (this.#status) this.#status.textContent = "";
  }
}

if (globalThis.customElements && !customElements.get("change-my-mind"))
  customElements.define("change-my-mind", ChangeMyMindElement);
