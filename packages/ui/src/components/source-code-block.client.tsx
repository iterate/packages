"use client";

import { useMemo } from "react";
import { javascript } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, indentRange } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { CodeBlock, type CodeBlockProps } from "./code-block.client.tsx";

const languages = {
  typescript: javascript({ jsx: true, typescript: true }),
  markdown: markdown(),
};

export type SourceCodeBlockProps = Omit<CodeBlockProps, "language" | "toolbar"> & {
  language: keyof typeof languages;
  /** Indent every line by the grammar's own rules, as an editor's "reindent" does: a model's
   *  script often arrives flush left. Lines keep their breaks and their text. */
  reindent?: boolean;
};

/** A source file's code block: `CodeBlock` with the file's grammar. It exists so that the grammars
 *  are imported by the module that also imports the editor, and nowhere beside it. A host that
 *  builds each file apart (esm.sh) gives two files that each import CodeMirror a copy of their own,
 *  and an editor refuses an extension another copy made ("Unrecognized extension value in extension
 *  set"), which unmounts the page. */
export function SourceCodeBlock({ language, reindent, code, ...props }: SourceCodeBlockProps) {
  const shown = useMemo(
    () => (reindent ? reindentSource(code, language) : code),
    [code, language, reindent],
  );
  return <CodeBlock {...props} code={shown} language={languages[language]} />;
}

/** `code` with each line indented as the grammar says (two spaces a level). The code as given when
 *  the parse does not finish within its deadline. */
export function reindentSource(code: string, language: keyof typeof languages): string {
  const created = EditorState.create({ doc: code, extensions: languages[language] });
  if (!ensureSyntaxTree(created, created.doc.length, 5_000)) return code;
  // The finished parse lives in the state's parse context; `indentRange` reads the state's tree,
  // which an empty update adopts from it (as CodeMirror's own `forceParsing` does).
  const state = created.update({}).state;
  return state.update({ changes: indentRange(state, 0, state.doc.length) }).state.doc.toString();
}
