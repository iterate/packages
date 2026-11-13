"use client";

import { use } from "react";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { formatScript } from "../lib/format-script.ts";
import { CodeBlock, type CodeBlockProps } from "./code-block.client.tsx";

const languages = {
  typescript: javascript({ jsx: true, typescript: true }),
  markdown: markdown(),
};

export type SourceCodeBlockProps = Omit<CodeBlockProps, "language" | "toolbar"> & {
  language: keyof typeof languages;
  /** Show the code prettified (lib/format-script.ts): a model's script often arrives flush left
   *  or on one line. A script that does not parse is shown as it was. */
  prettify?: boolean;
};

/** A source file's code block: `CodeBlock` with the file's grammar. It exists so that the grammars
 *  are imported by the module that also imports the editor, and nowhere beside it. A host that
 *  builds each file apart (esm.sh) gives two files that each import CodeMirror a copy of their own,
 *  and an editor refuses an extension another copy made ("Unrecognized extension value in extension
 *  set"), which unmounts the page. */
export function SourceCodeBlock({ language, prettify, code, ...props }: SourceCodeBlockProps) {
  // Suspends while Prettier loads and formats, under CodeBlock's own Suspense: the block appears
  // once, prettified, and never jumps from the text as given to the prettified one.
  const shown = prettify && language === "typescript" ? use(prettified(code)) : code;
  return <CodeBlock {...props} code={shown} language={languages[language]} />;
}

/** One promise for each script, so a render that suspends finds the same one when it comes back
 *  (React's `use` asks for that). The newest scripts stay; a long chat's oldest are dropped. */
const formatted = new Map<string, Promise<string>>();
function prettified(code: string): Promise<string> {
  let promise = formatted.get(code);
  if (!promise) {
    promise = formatScript(code);
    formatted.set(code, promise);
    if (formatted.size > 200) formatted.delete(formatted.keys().next().value!);
  }
  return promise;
}
