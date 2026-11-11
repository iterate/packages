import type { ReactNode } from "react";
import { ThemeProvider } from "#/components/mode-toggle.tsx";
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
    // The app's theme, for every page, signed in or not: light, dark, or as the system is.
    <ThemeProvider>
      <TooltipProvider delay={0}>
        {props.children}
        {/* the vendored Toaster asks next-themes for the theme */}
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}
