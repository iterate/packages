// The message editor's lazy shell: CodeMirror is browser-only and large enough to matter to the
// Worker upload, so it stays behind the same lazy boundary as packages/ui's CodeEditor.
import { Suspense, lazy, type ComponentType } from "react";
import type { ComposerTextareaProps } from "./composer-textarea.client.tsx";

const LazyComposerTextarea: ComponentType<ComposerTextareaProps> = import.meta.env.SSR
  ? () => null
  : lazy(async () => {
      const module = await import("./composer-textarea.client.tsx");
      return { default: module.ComposerTextareaClient };
    });

export function ComposerTextarea(props: ComposerTextareaProps) {
  return (
    // the editor's own height while it loads, so the composer does not move when it lands
    <Suspense fallback={<div className="min-h-10" aria-label="Loading" aria-busy="true" />}>
      <LazyComposerTextarea {...props} />
    </Suspense>
  );
}
