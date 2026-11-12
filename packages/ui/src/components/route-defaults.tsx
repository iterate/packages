import { useEffect, type ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { Button } from "#/components/ui/button.tsx";
import { capturePosthogException } from "#/components/posthog.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";

export function DefaultPendingComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner className="size-8" />
    </div>
  );
}

type NotFoundFallbackProps = {
  action?: ReactNode;
  [key: string]: unknown;
};

export function DefaultNotFoundComponent({ action }: NotFoundFallbackProps = {}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="font-readme max-w-md text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist.
        </p>
      </div>
      {action}
    </div>
  );
}

type ErrorFallbackProps = {
  error: unknown;
  /** What failed, in the page's words. */
  title?: string;
  secondaryAction?: ReactNode;
  [key: string]: unknown;
};

/** A route's error page. "Try again" loads the route again: `router.invalidate()` runs the
 *  loaders that failed and resets the error boundary, where the boundary's own `reset` would
 *  show the same failed load again. */
export function DefaultErrorComponent({
  error,
  title = "Something went wrong",
  secondaryAction,
}: ErrorFallbackProps) {
  const router = useRouter();
  const message = error instanceof Error ? error.message : "An unexpected error occurred";
  useEffect(() => capturePosthogException(error), [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-4 text-center">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p data-type="error" className="font-readme max-w-md text-sm text-muted-foreground">
          {message}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={() => void router.invalidate()}>
          Try again
        </Button>
        {secondaryAction}
      </div>
    </div>
  );
}
