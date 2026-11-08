// scripts/cloud-state.ts — A DEPLOYMENT AS THE CLOUD RECORDS IT: its origin, admin bearer and owner,
// from the Cloud's state (the deployment facet's snapshot), read with the caller's own CLI login to
// the Cloud's platform (a member of its project) and handed back in-process, never printed.
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { z } from "zod";

export const CloudDeployment = z.object({
  origin: z.url(),
  bearer: z.string().min(1),
  owner: z.email(),
});
export type CloudDeployment = z.infer<typeof CloudDeployment>;

export function cloudDeployment(
  cloud: { config: string; project: string },
  id: string,
): CloudDeployment {
  const childEnv = { ...process.env };
  delete childEnv.ITERATE_BEARER_TOKEN;
  delete childEnv.ITERATE_ADMIN_BEARER;
  const script = `const { state } = await itx.cd(${JSON.stringify(`/deployments/${id}`)}).facets.get("cloud-deployment").snapshot();
    return JSON.stringify({ origin: state.url ? new URL(state.url).origin : null, bearer: state.config?.adminBearer || null, owner: state.record?.owner?.email || null });`;
  const out = execFileSync(
    "iterate",
    ["--config", cloud.config, "itx", "run", "--project", cloud.project, "--eval", script],
    {
      cwd: tmpdir(),
      env: childEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    },
  ).trim();
  // the CLI prints a returned string as it is
  const read = CloudDeployment.safeParse(JSON.parse(out.slice(out.indexOf("{"))));
  if (!read.success) throw new Error(`Deployment ${id} has no URL, admin bearer or owner yet`);
  return read.data;
}
