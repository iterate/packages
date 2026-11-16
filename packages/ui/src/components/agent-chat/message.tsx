"use client";

import { cn } from "cn";
import type { ComponentProps, ComponentType, HTMLAttributes } from "react";
import { Suspense, lazy, memo } from "react";
import type { ExtraProps, StreamdownProps } from "streamdown";
import { AgentChoiceButton } from "./choice-in-words.tsx";
import {
  choiceTagName,
  choicesAsTokens,
  choicesInPlainWords,
  rehypeAgentChoices,
  withoutUnfinishedChoice,
} from "./choice-syntax.ts";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: "user" | "assistant" | "system" | "tool";
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full flex-col gap-2",
      from === "user" ? "is-user ml-auto max-w-[95%] justify-end" : "is-assistant",
      className,
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({ children, className, ...props }: MessageContentProps) => (
  <div
    className={cn(
      "is-user:dark flex w-fit max-w-full min-w-0 flex-col gap-2 text-sm wrap-break-word",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
      "group-[.is-assistant]:text-foreground",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

type MarkdownCodeProps = ComponentProps<"code"> & {
  node?: {
    position?: {
      start?: { line?: number };
      end?: { line?: number };
    };
  };
};

function MessageMarkdownCode({ children, className, node, ...props }: MarkdownCodeProps) {
  const singleLine = node?.position?.start?.line === node?.position?.end?.line;
  if (singleLine) {
    return (
      <code
        className={cn("rounded bg-muted px-1.5 py-0.5 font-mono text-sm", className)}
        {...props}
      >
        {children}
      </code>
    );
  }

  return (
    <div className="my-4 max-w-full overflow-hidden rounded-xl border bg-muted/30">
      {/* wrapped, not scrolled: the feed has one scrollbar, and a line cut off reads as lost */}
      <pre className="whitespace-pre-wrap p-3 text-sm leading-5 wrap-break-word sm:p-4 sm:leading-6">
        <code className={cn("font-mono", className)} {...props}>
          {children}
        </code>
      </pre>
    </div>
  );
}

function PlainMessageResponse({ children, className }: StreamdownProps) {
  return (
    <div className={cn("size-full whitespace-pre-wrap break-words", className)}>
      {children ? choicesInPlainWords(children) : children}
    </div>
  );
}

/** streamdown, with its own rehype steps and then the one that finds an agent's choices. */
const RichMessageResponse: ComponentType<StreamdownProps> = import.meta.env.SSR
  ? PlainMessageResponse
  : lazy(async (): Promise<{ default: ComponentType<StreamdownProps> }> => {
      const { Streamdown, defaultRehypePlugins } = await import("streamdown");
      const rehypePlugins = [...Object.values(defaultRehypePlugins), rehypeAgentChoices];
      const Rich = Streamdown as ComponentType<StreamdownProps>;
      return {
        default: ({ children, ...props }) => (
          <Rich rehypePlugins={rehypePlugins} {...props}>
            {children ? choicesAsTokens(children) : children}
          </Rich>
        ),
      };
    });

/** A link in the words: a link to this page (`#…`) or to the page's own origin opens in place;
 *  any other opens in a new tab. streamdown's own link always opens a new tab. */
function MessageMarkdownLink({
  href,
  children,
  className,
  node: _node,
  // streamdown's rehype step puts target="_blank" on every link; this component decides it
  target: _target,
  rel: _rel,
  ...props
}: ComponentProps<"a"> & ExtraProps) {
  // streamdown names a link whose markdown has not finished streaming yet with this href
  const incomplete = href === "streamdown:incomplete-link";
  const here = Boolean(href) && !incomplete && typeof window !== "undefined" && isSameOrigin(href!);
  return (
    <a
      {...props}
      className={cn("wrap-anywhere font-medium text-primary underline", className)}
      data-incomplete={incomplete}
      data-streamdown="link"
      href={incomplete ? undefined : href}
      {...(here ? {} : { target: "_blank", rel: "noreferrer" })}
    >
      {children}
    </a>
  );
}

function isSameOrigin(href: string): boolean {
  if (href.startsWith("#")) return true;
  try {
    return new URL(href, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/** An agent's words as Markdown. A choice (`[[kind:value|label]]`, choice-in-words.tsx) is a button
 *  when an `AgentChoiceProvider` above handles a press, else its plain words. A draft (any mode but
 *  "static") hides a choice that has not ended yet. */
export const MessageResponse = memo(
  ({ className, components, children, ...props }: StreamdownProps) => {
    const text = children && props.mode !== "static" ? withoutUnfinishedChoice(children) : children;
    return (
      <Suspense
        fallback={
          <PlainMessageResponse className={className} {...props}>
            {text}
          </PlainMessageResponse>
        }
      >
        <RichMessageResponse
          className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
          // A link opens when clicked, with no "Open external link?" question first. A page that
          // wants the question passes `linkSafety` itself.
          linkSafety={{ enabled: false }}
          components={{
            a: MessageMarkdownLink,
            code: MessageMarkdownCode,
            // MessageMarkdownCode draws a block's own <pre>.
            pre: ({ children }: ComponentProps<"pre"> & ExtraProps) => children,
            [choiceTagName]: AgentChoiceButton,
            ...components,
          }}
          {...props}
        >
          {text}
        </RichMessageResponse>
      </Suspense>
    );
  },
  (prevProps, nextProps) => prevProps.children === nextProps.children,
);

MessageResponse.displayName = "MessageResponse";
