// THE DEPLOYMENT PAGE WITH NO BACKEND: components/deployment-body.tsx drawn from each moment of a
// recorded install (preview/moments.json, made by preview/record.ts), one after the other, or one
// alone with `?moment=<index>`. For design work on the page: `pnpm page-preview`, then look, change,
// reload. It is not one of the Cloud's routes and never ships.
import "../src/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { DeploymentView } from "@iterate-com/cloud/views";
import { Badge } from "@iterate-com/ui/components/ui/badge";
import { DeploymentBody, type DeploymentActions } from "../src/components/deployment-body.tsx";
import recorded from "./moments.json";

const moments = recorded as unknown as { name: string; state: DeploymentView }[];
const only = new URLSearchParams(location.search).get("moment");
const shown = !only
  ? moments.map((moment, index) => ({ moment, index }))
  : [{ moment: moments[Number(only)]!, index: Number(only) }];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main className="mx-auto flex max-w-3xl flex-col gap-16 px-4 py-8">
      {shown.map(({ moment, index }) => (
        <section key={moment.name} className="flex flex-col gap-4" data-moment={index}>
          <p className="font-mono text-xs text-muted-foreground">
            {index + 1}. {moment.name}
          </p>
          <DeploymentBody
            id={moment.state.record?.id || "dep_"}
            state={moment.state}
            connection={<Badge variant="outline">recorded</Badge>}
            actions={actionsOf(moment.state)}
          />
        </section>
      ))}
    </main>
  </StrictMode>,
);

/** What the buttons do with no backend: a step's lines are the ones the moment kept, the password
 *  is a stand-in, and a request does nothing. */
function actionsOf(state: DeploymentView): DeploymentActions {
  const nothing = () => Promise.resolve(null);
  return {
    requestCreation: nothing,
    prepareAgain: nothing,
    requestRun: nothing,
    readOutput: async (_offset, step) => ({
      lines: state.run?.steps.find((known) => known.name === step)?.tail || [],
    }),
    signInPassword: async () => "password-of-the-preview",
  };
}
