"use client";

import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { CodeBlock, type CodeBlockProps } from "./code-block.client.tsx";

const languages = {
  typescript: javascript({ jsx: true, typescript: true }),
  markdown: markdown(),
};

export type SourceCodeBlockProps = Omit<CodeBlockProps, "language" | "toolbar"> & {
  language: keyof typeof languages;
};

/** A source file's code block: `CodeBlock` with the file's grammar. It exists so that the grammars
 *  are imported by the module that also imports the editor, and nowhere beside it. A host that
 *  builds each file apart (esm.sh) gives two files that each import CodeMirror a copy of their own,
 *  and an editor refuses an extension another copy made ("Unrecognized extension value in extension
 *  set"), which unmounts the page. */
export function SourceCodeBlock({ language, ...props }: SourceCodeBlockProps) {
  return <CodeBlock {...props} language={languages[language]} />;
}
