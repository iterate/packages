import { connectMind } from "iterate/node";

/** One connection to the mind named by MIND, its address (`example.com`), signed in as the
 *  CLI signs in (`iterate login <address>`, or ITERATE_MIND_TOKEN). Dispose it to close its
 *  socket. */
export async function connect() {
  const address = process.env.MIND;
  if (!address) throw new Error("MIND is required: the mind's address, like example.com");
  return await connectMind({ address });
}
