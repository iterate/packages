// stylesheet-order.ts — ONE STYLESHEET HOLDS ANOTHER, IN ITS ORDER. dist/docs-editor.css is a page's
// whole stylesheet, linked in place of dist/styles.css (src/browser/docs-editor.css says why): it
// must have every rule of styles.css, in the same at-rules and the same order, so that every element
// computes what it computes with styles.css, and the docs editor's own rules only add to that. Two
// sheets in one `@layer utilities` would not: the later sheet's plain `.hidden` beats the earlier
// sheet's `md:block`. scripts/check-docs-editor-css.ts runs `rulesMissingInOrder` after the build.
import postcss, { type ChildNode, type Container } from "postcss";

/** At-rules that only group the rules inside them. */
const GROUPING = new Set(["layer", "media", "supports", "container", "starting-style"]);

/** The rules of `sheet` that `whole` lacks, or has only out of `sheet`'s order: none when `whole`
 *  holds `sheet`. A rule counts as held when `whole` has, later than the last one matched, a rule at
 *  the same place (selector and the at-rules around it) with at least its declarations: a bigger
 *  build lists more custom properties in its theme and its `@property` fallbacks. Pure. */
export function rulesMissingInOrder(input: { sheet: string; whole: string }) {
  const whole = leavesOf(postcss.parse(input.whole));
  const missing: string[] = [];
  let at = 0;
  for (const leaf of leavesOf(postcss.parse(input.sheet))) {
    let found = at;
    while (
      found < whole.length &&
      !(
        whole[found]!.place === leaf.place &&
        [...leaf.declarations].every((d) => whole[found]!.declarations.has(d))
      )
    )
      found++;
    if (found === whole.length) missing.push(leaf.place);
    else at = found + 1;
  }
  return missing;
}

/** Each rule with its own declarations, by its place: the at-rules and selectors around it, and its
 *  selector. An at-rule that is not a grouping one (`@property`, `@keyframes`, `@font-face`) is a
 *  place of its own, its whole text. */
function leavesOf(
  container: Container,
  path: string[] = [],
): { place: string; declarations: Set<string> }[] {
  return (container.nodes || []).flatMap((node: ChildNode) => {
    if (node.type === "comment" || node.type === "decl") return [];
    if (node.type === "atrule" && GROUPING.has(node.name) && node.nodes)
      return leavesOf(node, [...path, `@${node.name} ${node.params}`]);
    if (node.type === "rule") {
      const inner = [...path, node.selector];
      const declarations = new Set(
        (node.nodes || []).flatMap((child) =>
          child.type === "decl"
            ? [`${child.prop}:${child.value}${child.important ? "!important" : ""}`]
            : [],
        ),
      );
      return [{ place: inner.join("\n"), declarations }, ...leavesOf(node, inner)];
    }
    const clone = node.clone();
    clone.cleanRaws();
    return [{ place: [...path, clone.toString()].join("\n"), declarations: new Set<string>() }];
  });
}
