import { connectProject } from "iterate/node";

/** One connection to the project named by PROJECT, its address (`example.com`), signed in as the
 *  CLI signs in (`iterate login <address>`, or ITERATE_PROJECT_TOKEN). Dispose it to close its
 *  socket. */
export async function connect() {
  const address = process.env.PROJECT;
  if (!address) throw new Error("PROJECT is required: the project's address, like example.com");
  return await connectProject({ address });
}
