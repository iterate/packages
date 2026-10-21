import type { ReactNode } from "react";
import { cn } from "cn";

/** The frame of a page outside any app's shell, such as the Dash's secret collection link. It is the
 *  issuer's (core/os `StandalonePage`), so the page reads as the sign-in pages and www.iterate.com
 *  do: one centred column, its content left-aligned, with nothing drawn around it. The space above
 *  and below is padding: a margin would collapse through `body` and push its `min-h-svh` down the
 *  page, so a page shorter than the window would scroll. */
export function StandalonePage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main className={cn("mx-auto flex max-w-210 flex-col gap-6 px-5 pt-14 pb-26", className)}>
      {children}
    </main>
  );
}

/** A refusal or failure shown where the person acted. */
export function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <p role="alert" data-type="error" className="text-sm text-destructive">
      {children}
    </p>
  );
}
