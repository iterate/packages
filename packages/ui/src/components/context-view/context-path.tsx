// A context's path, once, as one plain path, each segment a link up: `/repos/config`, the last
// segment the page's own. The link target is the caller's (`ContextPathLinks`): the UI kit knows
// no routes, so an app says what URL a path opens and, with a client router, takes the plain click
// itself — the way AppShell's `mindHref` and `onNavigate` work.
import type { ReactNode } from "react";
import { cn } from "cn";
import type { ContextPathLinks } from "./context-path-links.ts";
import { ContextPathText } from "#/components/context-path-text.tsx";
import { plainLeftClick } from "#/lib/plain-left-click.ts";

export type { ContextPathLinks };

/** An anchor to a context path: a plain click goes through the app's router, a modified or middle
 *  click is the browser's. */
export function PathLink({
  path,
  links,
  className,
  children,
  ...rest
}: {
  path: string;
  links: ContextPathLinks;
  className?: string;
  children: ReactNode;
  "aria-current"?: "page";
  "aria-label"?: string;
}) {
  const href = links.hrefOf(path);
  return (
    <a
      href={href}
      className={className}
      onClick={(event) => {
        // a link inside an inspectable row opens the path, not the inspector
        event.stopPropagation();
        if (links.onNavigate && plainLeftClick(event)) links.onNavigate(href, event);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

/** `/repos/config`: the path, plain and fixed-width, each segment with its "/" a link up, the
 *  last one the page's. The links' text is the path's own characters, so it reads as one path; a
 *  long one wraps (`ContextPathText`). */
export function ContextPath({
  path,
  links,
  className,
}: {
  path: string;
  links: ContextPathLinks;
  className?: string;
}) {
  const segments = path.split("/").filter(Boolean);
  return (
    <nav aria-label="Context path" className={cn("min-w-0 text-sm", className)}>
      <ContextPathText path={path}>
        {segments.length === 0 ? <span aria-current="page">/</span> : null}
        {segments.map((segment, index) => {
          const to = `/${segments.slice(0, index + 1).join("/")}`;
          return index === segments.length - 1 ? (
            <span key={to} aria-current="page">
              /{segment}
            </span>
          ) : (
            <PathLink key={to} path={to} links={links} className="hover:underline">
              /{segment}
            </PathLink>
          );
        })}
      </ContextPathText>
    </nav>
  );
}
