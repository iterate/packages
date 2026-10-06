// app-shell-platform.ts — WHICH PLATFORM the app talks to, for the line at the bottom of the
// shell's sidebar. The app's sign-in gate knows (iterate/app-server `/.auth/session.json`): the
// issuer this browser's session is bound to, and the app's own default issuer.
import { z } from "zod";

const GateSession = z.object({ issuer: z.url().nullable(), defaultIssuer: z.url() });

/** The platform by host, and whether it is the app's own default. Not the default: a person
 *  connected the app to another platform on purpose (a self-hosted one, through `/.auth/connect`). */
export type ConnectedPlatform = { host: string; defaultHost: string; isDefault: boolean };

/** The gate's answer as the line shows it; null for anything that is not one. A session bound to
 *  no issuer sends its requests to the default (`appAuth`'s `/api`), so it is connected there. */
export function connectedPlatformOf(answer: unknown): ConnectedPlatform | null {
  const parsed = GateSession.safeParse(answer);
  if (!parsed.success) return null;
  const connected = new URL(parsed.data.issuer || parsed.data.defaultIssuer);
  const own = new URL(parsed.data.defaultIssuer);
  return {
    host: connected.host,
    defaultHost: own.host,
    isDefault: connected.origin === own.origin,
  };
}

/** Ask the gate. `/.auth/*` is at the root of the page's origin in every app, a proxied one's
 *  included (packages/ui/src/apps/base-path.ts). Null when the gate does not answer as one. */
export async function readConnectedPlatform(signal: AbortSignal) {
  const response = await fetch("/.auth/session.json", {
    headers: { accept: "application/json" },
    signal,
  });
  return response.ok ? connectedPlatformOf(await response.json()) : null;
}
