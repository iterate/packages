// app-shell-platform.ts — WHICH PLATFORM the app talks to, for the line at the bottom of the
// shell's sidebar, and how a person changes it. The app's sign-in gate knows
// (iterate/app-server `/.auth/session.json`): the issuer this browser's session is bound to, and the
// app's own default issuer. Its `/.auth/connect` binds the browser to another.
import { useSyncExternalStore } from "react";
import { z } from "zod";

const GateSession = z.object({ issuer: z.url().nullable(), defaultIssuer: z.url() });

/** The platform, and whether it is the app's own default. Not the default: a person connected the
 *  app to another platform on purpose (a self-hosted one, through `/.auth/connect`). */
export type ConnectedPlatform = {
  origin: string;
  host: string;
  defaultOrigin: string;
  defaultHost: string;
  isDefault: boolean;
};

/** The gate's answer as the line shows it; null for anything that is not one. A session bound to
 *  no issuer sends its requests to the default (`appAuth`'s `/api`), so it is connected there. */
export function connectedPlatformOf(answer: unknown): ConnectedPlatform | null {
  const parsed = GateSession.safeParse(answer);
  if (!parsed.success) return null;
  const connected = new URL(parsed.data.issuer || parsed.data.defaultIssuer);
  const own = new URL(parsed.data.defaultIssuer);
  return {
    origin: connected.origin,
    host: connected.host,
    defaultOrigin: own.origin,
    defaultHost: own.host,
    isDefault: connected.origin === own.origin,
  };
}

/** Ask the gate. `/.auth/*` is at the root of the page's origin in every app, a proxied one's
 *  included (packages/ui/src/apps/base-path.ts). Null when the gate does not answer as one. */
async function readConnectedPlatform(signal: AbortSignal) {
  const response = await fetch("/.auth/session.json", {
    headers: { accept: "application/json" },
    signal,
  });
  return response.ok ? connectedPlatformOf(await response.json()) : null;
}

/** The page's one read of the gate, and its answer once it has one. */
let platformRead: Promise<void> | undefined;
let platformAnswer: ConnectedPlatform | null = null;

/** Connecting to another platform is a full page load (`/.auth/connect`), so the page reads once,
 *  including while the account loads. A remounted shell has the answer at once. */
function subscribeToPlatform(changed: () => void) {
  let subscribed = true;
  platformRead ||= readConnectedPlatform(AbortSignal.timeout(10_000)).then(
    (answer) => {
      platformAnswer = answer;
      if (answer && !answer.isDefault) rememberDeployment(answer.origin);
    },
    () => {},
  );
  void platformRead.then(() => subscribed && changed());
  return () => {
    subscribed = false;
  };
}

export function useConnectedPlatform() {
  return useSyncExternalStore(
    subscribeToPlatform,
    () => platformAnswer,
    () => null,
  );
}

const REMEMBERED_KEY = "iterate.deployments";
const Remembered = z.array(z.url());

/** The other deployments this browser has connected this app to, the longest known first, so that
 *  each stays where a person last saw it. Only this browser knows them: no list of a person's
 *  deployments exists anywhere else, and the gate tells a page about one issuer at a time. */
export function rememberedDeployments(): string[] {
  try {
    const parsed = Remembered.safeParse(JSON.parse(localStorage.getItem(REMEMBERED_KEY) ?? "[]"));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function rememberDeployment(origin: string) {
  const known = rememberedDeployments();
  if (known.includes(origin)) return;
  try {
    localStorage.setItem(REMEMBERED_KEY, JSON.stringify([...known, origin].slice(-8)));
  } catch {
    // storage refused: the deployment is still connected, and the address box still reaches it
  }
}

export type DeploymentChoice = {
  origin: string;
  host: string;
  current: boolean;
  isDefault: boolean;
};

/** What a person can change to: the app's default first, then the others in the order this browser
 *  met them, so that a change moves no row. */
export function deploymentChoices(
  platform: ConnectedPlatform | null,
  remembered: readonly string[],
): DeploymentChoice[] {
  if (!platform) return [];
  return [...new Set([platform.defaultOrigin, ...remembered, platform.origin])].map((origin) => ({
    origin,
    host: new URL(origin).host,
    current: origin === platform.origin,
    isDefault: origin === platform.defaultOrigin,
  }));
}

/** The origin a person's typing names, or null while it names none. A bare host means https. The
 *  gate decides whether it may be connected to, and says why not on its own page. */
export function deploymentOriginOf(typed: string): string | null {
  const address = typed.trim();
  if (!address) return null;
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(address) ? address : `https://${address}`;
  if (!URL.canParse(url)) return null;
  const { origin } = new URL(url);
  if (origin === "null") return null;
  return origin;
}

/** The POST the gate's connect page makes. The gate takes it from this origin alone, so no other
 *  page can bind a browser this way, and it checks the deployment answers before it ends the sign-in
 *  this browser holds. With no `scope` it asks for what the app always asks for. */
export function connectTo(origin: string, next: string) {
  const form = document.createElement("form");
  form.method = "post";
  form.action = "/.auth/connect";
  form.hidden = true;
  for (const [name, value] of Object.entries({ issuer: origin, next })) {
    const field = document.createElement("input");
    field.type = "hidden";
    field.name = name;
    field.value = value;
    form.appendChild(field);
  }
  document.body.appendChild(form);
  form.submit();
}
