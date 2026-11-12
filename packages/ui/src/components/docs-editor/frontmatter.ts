// Carried over from iterate/docs@fba5c21 (packages/docs-app/src/editor/frontmatter.ts).
// Frontmatter in Rich mode: the YAML between the file's opening `---` fences shows as a block of
// page properties (key, value) instead of lines of markdown that the parser would read as a rule
// and a heading. Markdown mode shows the YAML itself; that's where it's edited.
import { type EditorState, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";

const FRONTMATTER = /^---\n[\s\S]*?\n---(?=\n|$)/;

class PropertiesWidget extends WidgetType {
  yaml: string;
  constructor(yaml: string) {
    super();
    this.yaml = yaml;
  }
  override eq(other: PropertiesWidget) {
    return other.yaml === this.yaml;
  }
  toDOM() {
    const list = document.createElement("dl");
    list.className = "docs-properties";
    list.setAttribute("aria-label", "Properties");
    for (const line of this.yaml.split("\n").slice(1, -1)) {
      const colon = line.indexOf(":");
      if (colon < 1) continue;
      const term = document.createElement("dt");
      term.textContent = line.slice(0, colon).trim();
      const value = document.createElement("dd");
      value.textContent = line.slice(colon + 1).trim();
      list.appendChild(term);
      list.appendChild(value);
    }
    return list;
  }
}

function propertiesBlock(state: EditorState): DecorationSet {
  const match = state.doc.toString().match(FRONTMATTER);
  if (!match) return Decoration.none;
  const widget = new PropertiesWidget(match[0]);
  return Decoration.set([Decoration.replace({ block: true, widget }).range(0, match[0].length)]);
}

/** The block's look, a key column and a value column, with the editor: a page needs no stylesheet
 *  of its own for it. */
const propertiesTheme = EditorView.baseTheme({
  ".docs-properties": {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    gap: "0.125rem 1.25rem",
    margin: "0.5rem 0 1rem",
    fontSize: "0.8125rem",
  },
  ".docs-properties dt": { color: "var(--muted-foreground)" },
});

export const frontmatterProperties = StateField.define<DecorationSet>({
  create: propertiesBlock,
  update: (block, transaction) =>
    transaction.docChanged ? propertiesBlock(transaction.state) : block,
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
    propertiesTheme,
  ],
});
