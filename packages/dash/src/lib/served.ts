import type { AuthenticatedApp } from "iterate/app";

/** WHETHER THE PROJECT SERVES `itx.<root>`: its root context's own row for the name, an implicit
 *  one for a root its host serves or a rewrite rule its config added, and not a mask. The Agents
 *  app asks the same of `itx.agents`. A page whose root the project does not serve yet says so
 *  (`NotServedYet`) and calls nothing on it. */
export async function servesRoot(read: AuthenticatedApp["read"], root: string): Promise<boolean> {
  const row = await read((itx) => itx.rewriteRules.get(`itx.${root}`));
  return Boolean(row?.target);
}
