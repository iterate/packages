// iterate-look.ts — ITERATE'S LOOK, THREE WAYS, FROM ONE FILE. src/styles/iterate.css is the look as
// a Tailwind build reads it: the apps import it after globals.css. The other two ways are cut from it,
// so none can say something the file does not:
//
// - dist/iterate.css, for a no-build page, linked after dist/styles.css (scripts/build-iterate-css.ts).
//   `overlayCss` compiles both stylesheets and keeps the rules of the look's that the neutral one does
//   not have: the custom properties, and every utility whose value Tailwind wrote into the rule
//   (`rounded-full`, the shadows, `font-readme`). Each sits in the same @layer as the rule it replaces
//   and comes later, so it wins. The font files go beside it in dist/fonts, named by relative url()s,
//   so the overlay works from any host of the package (esm.sh, jsDelivr, pkg.pr.new).
// - The registry's `theme` item, for an app that installs from the shadcn registry
//   (scripts/ci/shadcn-registry.ts writes it into registry.json; Lint and Typecheck fails when it is
//   stale). `themeItem` turns the file into the item's fields, as shadcn 4.21's `add` applies them:
//   `cssVars.theme` into the app's `@theme inline`, `cssVars.light` into its `:root`, each replacing
//   the app's own value, and `css` as written (an `@import "<package>"` after the app's last import,
//   and `@layer base` rules with their `@apply`).
//
// test/playwright/ui/iterate-look.spec.ts holds the three to one look: the same elements, styled each
// way, compute the same styles.
import postcss, { type ChildNode, type Container } from "postcss";

/** The look's file, by its path in packages/ui. */
export const LOOK_SOURCE = "src/styles/iterate.css";

/** At-rules that only group the rules inside them. */
const GROUPING = new Set(["layer", "media", "supports", "container", "starting-style"]);

/** dist/iterate.css: what a build of the look (`look`) has that the neutral build (`neutral`) does
 *  not, each rule in the at-rules it sits in. Pure. */
export function overlayCss(input: { neutral: string; look: string }) {
  const known = new Set(
    leavesOf(postcss.parse(input.neutral)).map((leaf) => leafKey(leaf.path, leaf.node)),
  );
  const out = postcss.root();
  let open: { path: string; container: Container } = { path: "", container: out };
  for (const { path, node } of leavesOf(postcss.parse(input.look))) {
    if (known.has(leafKey(path, node))) continue;
    if (open.path !== path.join("\n")) {
      let container: Container = out;
      for (const wrapper of path) {
        const [, name, params] = /^@(\S+) ?(.*)$/s.exec(wrapper)!;
        const atRule = postcss.atRule({ name: name!, params: params! });
        container.append(atRule);
        container = atRule;
      }
      open = { path: path.join("\n"), container };
    }
    open.container.append(node.clone());
  }
  return out.toString();
}

/** Every rule or ungrouped at-rule, with the grouping at-rules around it. */
function leavesOf(
  container: Container,
  path: string[] = [],
): { path: string[]; node: ChildNode }[] {
  return (container.nodes || []).flatMap((node) => {
    if (node.type === "comment") return [];
    if (node.type === "atrule" && GROUPING.has(node.name) && node.nodes)
      return leavesOf(node, [...path, `@${node.name} ${node.params}`]);
    return [{ path, node }];
  });
}

function leafKey(path: string[], node: ChildNode) {
  const clone = node.clone();
  clone.cleanRaws();
  return [...path, clone.toString()].join("\n");
}

/** `overlay` with each @font-face's `src` cut to its woff2 file, named beside the stylesheet in
 *  `fonts/`, and the files it names. A font package's faces name `./files/<file>` (fontsource's
 *  layout), relative to the package. Pure. */
export function withFontsBeside(overlay: string) {
  const root = postcss.parse(overlay);
  const files: string[] = [];
  root.walkAtRules("font-face", (face) => {
    face.walkDecls("src", (src) => {
      const woff2 = woff2Of(src.value);
      files.push(woff2);
      src.value = `url(./fonts/${woff2}) format("woff2")`;
    });
  });
  return { css: root.toString(), files };
}

/** The woff2 files the font packages the look's file (`css`) imports name, which the overlay
 *  ships in dist/fonts and the published package exports one by one (esm.sh serves a file by an
 *  export only when the export names it). `read` gives an imported file's text. Pure. */
export function fontFilesOf(input: { css: string; read: (specifier: string) => string }) {
  const files: string[] = [];
  postcss.parse(input.css).walkAtRules("import", (atRule) => {
    const specifier = unquote(atRule.params);
    if (specifier.startsWith("iterate/")) return;
    postcss
      .parse(input.read(specifier))
      .walkAtRules("font-face", (face) =>
        face.walkDecls("src", (src) => void files.push(woff2Of(src.value))),
      );
  });
  return [...new Set(files)].sort();
}

function woff2Of(src: string) {
  const woff2 = /url\(["']?\.\/files\/([\w.-]+\.woff2)["']?\)/.exec(src)?.[1];
  if (!woff2) throw new Error(`a font face with no ./files/*.woff2 source: ${src}`);
  return woff2;
}

/** The packages the look's file imports (the font). */
export function packagesOf(css: string) {
  const packages = new Set<string>();
  postcss.parse(css).walkAtRules("import", (atRule) => {
    const specifier = unquote(atRule.params);
    if (!specifier.startsWith("iterate/")) packages.add(packageOf(specifier));
  });
  return [...packages].sort();
}

/** The registry's `theme` item's fields, from the look's file (`css`). `read` gives the text of a
 *  file it imports from `iterate` (tokens.css), which the item carries as values: an app outside this
 *  repo need not install `iterate` for its colours. Throws on anything the item cannot carry. Pure. */
export function themeItem(input: { css: string; read: (specifier: string) => string }) {
  const theme: Record<string, string> = {};
  const light: Record<string, string> = {};
  const css: Record<string, Record<string, Record<string, Record<string, never> | string>>> = {};
  const addLight = (container: Container) =>
    container.each((node) => {
      if (node.type === "decl") light[node.prop.replace(/^--/, "")] = node.value;
    });
  postcss.parse(input.css).each((node) => {
    if (node.type === "comment") return;
    if (node.type === "atrule" && node.name === "import") {
      const specifier = unquote(node.params);
      if (specifier.startsWith("iterate/"))
        return void postcss.parse(input.read(specifier)).walkRules(":root", addLight);
      css[`@import "${specifier}"`] = {};
      return;
    }
    if (node.type === "rule" && node.selector === ":root") return void addLight(node);
    if (node.type === "atrule" && node.name === "theme" && node.params === "inline")
      return void node.each((child) => {
        if (child.type === "decl") theme[child.prop.replace(/^--/, "")] = child.value;
      });
    if (node.type === "atrule" && node.name === "layer") {
      const layer = (css[`@layer ${node.params}`] ||= {});
      return void node.each((rule) => {
        if (rule.type === "comment") return;
        if (rule.type !== "rule") throw new Error(`${LOOK_SOURCE}: @layer holds ${rule.type}`);
        const body: Record<string, Record<string, never> | string> = {};
        rule.each((child) => {
          if (child.type === "atrule" && child.name === "apply")
            body[`@apply ${child.params}`] = {};
          else if (child.type === "decl") body[child.prop] = child.value;
          else if (child.type !== "comment")
            throw new Error(`${LOOK_SOURCE}: ${rule.selector} holds ${child.toString()}`);
        });
        layer[rule.selector.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")")] = body;
      });
    }
    throw new Error(`${LOOK_SOURCE}: a registry theme item cannot carry ${node.toString()}`);
  });
  // A colour that names another (`--sidebar: var(--background)`) goes as the other's value: shadcn
  // maps a light value it does not take for a colour into `@theme inline` under its own name, which
  // for `var(--background)` writes `--sidebar: var(--sidebar)`.
  for (const [name, value] of Object.entries(light)) {
    const alias = /^var\(--([\w-]+)\)$/.exec(value)?.[1];
    if (alias && alias in light) light[name] = light[alias]!;
  }
  return {
    dependencies: packagesOf(input.css),
    cssVars: { theme, light },
    css,
  };
}

function unquote(params: string) {
  return params.replace(/^(["'])(.*)\1$/, "$2");
}

function packageOf(specifier: string) {
  return specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");
}

/** What `shadcn add` of the theme item (`item`) left out of the app's stylesheet (`css`, after the
 *  add): each theme value in its `@theme inline`, each light value in its `:root`, each import and
 *  each base rule. Empty when the app has the look. Pure. */
export function themeAppliedProblems(input: { item: ReturnType<typeof themeItem>; css: string }) {
  const root = postcss.parse(input.css);
  const declsOf = (containers: Container[]) =>
    new Map(
      containers.flatMap((container) =>
        (container.nodes || []).flatMap((node) =>
          node.type === "decl" ? [[node.prop.replace(/^--/, ""), node.value] as const] : [],
        ),
      ),
    );
  const theme = declsOf(
    (root.nodes || []).filter(
      (node): node is Container & ChildNode =>
        node.type === "atrule" && node.name === "theme" && node.params === "inline",
    ),
  );
  const light = declsOf(
    (root.nodes || []).filter(
      (node): node is Container & ChildNode => node.type === "rule" && node.selector === ":root",
    ),
  );
  const imports = new Set<string>();
  root.walkAtRules("import", (atRule) => void imports.add(`@import ${atRule.params}`));
  const baseRules = new Map<string, string>();
  root.walkAtRules("layer", (layer) => {
    if (layer.params === "base")
      layer.walkRules((rule) => void baseRules.set(rule.selector, rule.toString()));
  });
  const problems: string[] = [];
  for (const [name, value] of Object.entries(input.item.cssVars.theme))
    if (theme.get(name) !== value) problems.push(`@theme inline --${name}: ${theme.get(name)}`);
  for (const [name, value] of Object.entries(input.item.cssVars.light))
    if (light.get(name) !== value) problems.push(`:root --${name}: ${light.get(name)}`);
  for (const [key, rules] of Object.entries(input.item.css)) {
    if (key.startsWith("@import ")) {
      if (!imports.has(key)) problems.push(`${key} missing`);
      continue;
    }
    for (const [selector, body] of Object.entries(rules))
      for (const line of Object.keys(body))
        if (!baseRules.get(selector)?.includes(line)) problems.push(`${selector} lacks ${line}`);
  }
  return problems;
}
