import { createFileRoute } from "@tanstack/react-router";
import { ChangeDeploymentLink } from "@iterate-com/ui/components/change-deployment";
import { LogInWithIterate } from "@iterate-com/ui/components/log-in-with-iterate";
export const Route = createFileRoute("/")({
  component: () => (
    <main className="flex min-h-svh flex-col items-center justify-center gap-2 p-6">
      <LogInWithIterate next="/projects" />
      <ChangeDeploymentLink next="/projects" />
    </main>
  ),
});
