import { Suspense, lazy, type ComponentType } from "react";
import { cn } from "cn";
import type { CodeEditorProps } from "./code-editor.client.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";

export type { CodeEditorProps } from "./code-editor.client.tsx";

// Keeps CodeMirror out of the server bundle, as code-block.tsx explains.
const LazyEditor: ComponentType<CodeEditorProps> = import.meta.env.SSR
  ? () => null
  : lazy(async () => {
      const module = await import("./code-editor.client.tsx");
      return { default: module.CodeEditor };
    });

export function CodeEditor(props: CodeEditorProps) {
  return (
    // the editor's chunks can take seconds on a slow network: say so, not an empty space
    <Suspense
      fallback={
        <div
          className={cn("flex items-center gap-2 text-xs text-muted-foreground", props.className)}
          data-spinner="true"
        >
          <Spinner className="size-3.5" />
          <span>Loading editor…</span>
        </div>
      }
    >
      <LazyEditor {...props} />
    </Suspense>
  );
}
