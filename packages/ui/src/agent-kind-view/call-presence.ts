// call-presence.ts — WHO IS IN AN AGENT'S CALL, for the faces of who is here: the call's live
// state (lib/call-rules.ts `CallLive`) read by actor. The Dash's agent page loads it with the
// call's other parts (./dash-call.tsx), only where calls are on.
import type { InCall } from "#/components/agent-chat/presence-line.tsx";
import { CallLive } from "#/lib/call-rules.ts";

/** Who is in the call, by actor, and whether they send a camera or a screen from any of their
 *  pages; undefined while the call's live state is not there. */
export function inCallOf(liveValue: unknown): InCall | undefined {
  const live = CallLive.safeParse(liveValue);
  if (!live.success) return undefined;
  const people = new Map<string, { camera: boolean; screen: boolean }>();
  for (const { who, tracks } of Object.values(live.data.inCall)) {
    const held = people.get(who.actor);
    people.set(who.actor, {
      camera: Boolean(held?.camera) || "camera" in tracks,
      screen: Boolean(held?.screen) || "screen" in tracks,
    });
  }
  return people;
}
