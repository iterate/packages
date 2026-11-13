// change-my-mind-button.tsx — the "Change my mind" button, for any page of any mind: it copies
// instructions that a reader pastes to their own iterate mind, which reads this post (or this blog)
// and offers to make the same change. The text and the words are in lib/change-my-mind.ts, shared
// with the custom element `<change-my-mind>` (src/browser/change-my-mind.ts) for a page with no
// React.
//
// The look is the kit's default Button with the iterate mark in a square of its own at the left,
// as the old "Connect with Facebook" button had its "f".
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Check } from "lucide-react";
import { cn } from "cn";
import { Button } from "#/components/ui/button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "#/components/ui/popover.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "#/components/ui/tooltip.tsx";
import {
  changeMyMindInstructions,
  changeMyMindText,
  changeMyMindTimes,
  copyToClipboard,
  currentPageSource,
  iterateMark,
  type ChangeMyMindScope,
} from "#/lib/change-my-mind.ts";

/** The iterate "i" in `currentColor`. */
export function IterateMark({ className, ...props }: ComponentProps<"svg">) {
  return (
    <svg
      viewBox={iterateMark.viewBox}
      fill="currentColor"
      aria-hidden
      focusable="false"
      className={className}
      {...props}
    >
      {iterateMark.paths.map((path) => (
        <path key={path} d={path} />
      ))}
    </svg>
  );
}

export function ChangeMyMindButton({
  source,
  scope = "post",
  instructions,
  size = "default",
  variant = "default",
  className,
}: {
  /** the post's URL; by default this page's, without its query or hash */
  source?: string;
  /** "blog": the text is about the whole blog (its feed and README), not one post */
  scope?: ChangeMyMindScope;
  /** the exact text to copy, in place of the built one */
  instructions?: string;
  /** "sm" for a list */
  size?: "default" | "sm";
  /** "outline", the kit's outline Button, for a quieter button (a list of posts) */
  variant?: "default" | "outline";
  className?: string;
}) {
  // `copies` counts the presses, so that a second press starts the timers again
  const [copies, setCopies] = useState(0);
  const [labelCopied, setLabelCopied] = useState(false);
  const [note, setNote] = useState<{ copied: boolean; text: string } | null>(null);
  const [holding, setHolding] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const textBox = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!labelCopied) return;
    const timer = setTimeout(() => setLabelCopied(false), changeMyMindTimes.label);
    return () => clearTimeout(timer);
  }, [labelCopied, copies]);

  // A copied note closes by itself unless the pointer or the focus is in it; a failed one holds its
  // text box until Escape or a click elsewhere.
  useEffect(() => {
    if (!note?.copied || holding) return;
    const timer = setTimeout(() => setNote(null), changeMyMindTimes.note);
    return () => clearTimeout(timer);
  }, [note, holding, copies]);

  const copy = async () => {
    const text =
      instructions?.trim() ||
      changeMyMindInstructions({ source: source || currentPageSource(), scope });
    const copied = await copyToClipboard(text);
    setCopies((count) => count + 1);
    setLabelCopied(copied);
    setHolding(false);
    setNote({ copied, text });
  };

  const small = size === "sm";
  return (
    <span data-slot="change-my-mind" className={cn("inline-flex", className)}>
      <Popover
        open={Boolean(note)}
        onOpenChange={(open, details) => {
          // the button's own press copies (again); it neither opens nor closes the note itself
          if (!open && details.reason !== "trigger-press") setNote(null);
        }}
      >
        <Tooltip open={tooltipOpen && !note} onOpenChange={setTooltipOpen}>
          <TooltipTrigger
            delay={300}
            render={
              <PopoverTrigger
                nativeButton
                render={
                  <Button
                    size={small ? "sm" : "default"}
                    variant={variant}
                    className="gap-0 overflow-hidden p-0 motion-reduce:transition-none"
                    onClick={() => void copy()}
                  />
                }
              />
            }
          >
            <span
              className={cn(
                "flex h-full shrink-0 items-center justify-center border-r",
                variant === "outline"
                  ? "border-border text-foreground dark:border-input"
                  : "border-primary-foreground/20",
                small ? "w-7" : "w-8",
              )}
            >
              <IterateMark className={small ? "size-3.5" : "size-4"} />
            </span>
            {/* both labels in one cell, so the button keeps its width when the label changes */}
            <span className={cn("grid", small ? "px-2" : "px-2.5")}>
              <span className={cn("col-start-1 row-start-1", labelCopied && "invisible")}>
                {changeMyMindText.label}
              </span>
              <span
                className={cn(
                  "col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5",
                  !labelCopied && "invisible",
                )}
              >
                <Check />
                {changeMyMindText.copied}
              </span>
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-64 motion-reduce:animate-none">
            {changeMyMindText.tooltip}
          </TooltipContent>
        </Tooltip>
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={6}
          initialFocus={note?.copied === false ? textBox : false}
          className={cn(
            "gap-1.5 motion-reduce:animate-none",
            note?.copied === false ? "w-96 max-w-[calc(100vw-2rem)]" : "w-auto max-w-72",
          )}
          onPointerEnter={() => setHolding(true)}
          onPointerLeave={() => setHolding(false)}
          onFocus={() => setHolding(true)}
          onBlur={() => setHolding(false)}
        >
          <p>
            {note?.copied === false ? changeMyMindText.uncopiedNote : changeMyMindText.copiedNote}
          </p>
          {note?.copied === false && (
            <Textarea
              ref={textBox}
              readOnly
              value={note.text}
              aria-label={changeMyMindText.textBoxLabel}
              onFocus={(event) => event.currentTarget.select()}
              className="h-36 resize-y font-mono text-xs"
            />
          )}
          <a
            href={changeMyMindText.getOneHref}
            target="_blank"
            rel="noopener"
            className="w-fit text-muted-foreground underline underline-offset-3 hover:text-foreground"
          >
            {changeMyMindText.getOne}
          </a>
        </PopoverContent>
      </Popover>
      <span role="status" aria-live="polite" className="sr-only">
        {note && (note.copied ? changeMyMindText.copiedNote : changeMyMindText.uncopiedNote)}
      </span>
    </span>
  );
}
