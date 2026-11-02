import type { ReactNode } from "react";
import { initPosthog } from "#/components/posthog.tsx";
import { Toaster } from "#/components/ui/sonner.tsx";
import { TooltipProvider } from "#/components/ui/tooltip.tsx";

/** Every client app's root providers. PostHog starts when the app has a key (envs.ts hands one to
 *  prd only). */
export function AppProviders(props: { children: ReactNode; posthogApiKey?: string }) {
  initPosthog(props.posthogApiKey);

  return (
    // Base UI tooltips are intended to share a provider; setting delay=0
    // here makes hover tooltips feel immediate across the app.
    // First-party docs:
    // https://github.com/mui/base-ui/blob/master/docs/src/app/(docs)/react/components/tooltip/page.mdx
    <TooltipProvider delay={0}>
      {props.children}
      {/* light or dark as the OS is: the vendored Toaster asks next-themes, and with no
          ThemeProvider mounted that is "system" */}
      <Toaster />
    </TooltipProvider>
  );
}
