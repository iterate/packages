// face.tsx — WHO SPOKE, as a small round mark: iterate's mark for the agent, else the person's
// initials on the person's own colour (`colourOf`), the same on every page.
import { cn } from "cn";
import { colourOf, initialsOf, inkOf } from "./spoken-lines.ts";
import { Avatar, AvatarFallback } from "#/components/ui/avatar.tsx";
import { IterateLogo } from "#/components/iterate-logo.tsx";

/** `who` is a speaker's address, or the agent's name: `agent` (default `"iterate"`) is drawn as
 *  iterate's mark. `who` gives the colour, so it must never change for one person; `name`, when
 *  given, gives the initials in its place (a guest's `who` is their actor id, their initials come
 *  from the name they typed: lib/principal-label.ts `faceOf`). Its size is `size-8`, or `size-5`
 *  when `small`; `className` changes it. `label` is what the face says in words, as a tooltip and
 *  to a screen reader: without it the face is decoration beside a name that the page writes. */
export function Face({
  who,
  agent = "iterate",
  className,
  small = false,
  label,
  name,
}: {
  who: string;
  name?: string;
  agent?: string;
  className?: string;
  small?: boolean;
  label?: string;
}) {
  const size = small ? "size-5" : "size-8";
  if (who === agent) return <IterateLogo alt={agent} className={cn(size, className)} />;
  return (
    <Avatar
      className={cn(size, "shrink-0", className)}
      title={label}
      aria-label={label}
      role={label ? "img" : undefined}
      aria-hidden={label ? undefined : true}
    >
      {/* The two colours that are not tokens: a hue computed from the person, so no stylesheet can
          name it, and the ink that reads best on it. Neither depends on the theme. */}
      <AvatarFallback
        style={{ background: colourOf(who), color: inkOf(who) }}
        className={cn("font-medium", small ? "text-2xs" : "text-xs")}
      >
        {initialsOf(name || who)}
      </AvatarFallback>
    </Avatar>
  );
}
