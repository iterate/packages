// face.tsx — WHO SPOKE, as a small round mark: iterate's mark for the agent, else the person's
// initials on the person's own colour (`colourOf`), the same on every page.
import { cn } from "cn";
import { colourOf, initialsOf } from "./spoken-lines.ts";
import { Avatar, AvatarFallback } from "#/components/ui/avatar.tsx";
import { IterateLogo } from "#/components/iterate-logo.tsx";

/** `who` is a speaker's address, or the agent's name: `agent` (default `"iterate"`) is drawn as
 *  iterate's mark. Its size is `size-8`; `className` changes it. */
export function Face({
  who,
  agent = "iterate",
  className,
}: {
  who: string;
  agent?: string;
  className?: string;
}) {
  if (who === agent) return <IterateLogo alt={agent} className={cn("size-8", className)} />;
  return (
    <Avatar className={cn("size-8 shrink-0", className)}>
      {/* The one colour that is not a token: a hue computed from the person, so no stylesheet can
          name it. Its lightness is fixed, so the initials on it are white in every theme. */}
      <AvatarFallback
        style={{ background: colourOf(who), color: "white" }}
        className="text-xs font-medium"
      >
        {initialsOf(who)}
      </AvatarFallback>
    </Avatar>
  );
}
