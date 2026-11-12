// copy-text.tsx — a value to copy (a password, a command), in full, with a button that copies it.
// `label` names the value for a screen reader ("Copy password"), where a page has several.
// CopyButton is the button alone, for a value already on the page in another shape (a log).
import { useState, type ComponentProps } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "cn";
import { Button } from "#/components/ui/button.tsx";

export function CopyText({
  text,
  label,
  className,
  ...props
}: ComponentProps<"div"> & { text: string; label?: string }) {
  return (
    <div
      data-slot="copy-text"
      className={cn(
        "flex min-w-0 items-center gap-1 rounded-lg border bg-muted/50 py-1 pr-1 pl-3",
        className,
      )}
      {...props}
    >
      <code className="min-w-0 flex-1 truncate font-mono text-xs select-all" title={text}>
        {text}
      </code>
      <CopyButton text={text} label={label} />
    </div>
  );
}

/** An icon that copies `text`, or the icon and the words in `children`. */
export function CopyButton({
  text,
  label,
  children,
  ...props
}: ComponentProps<typeof Button> & { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return; // no clipboard here (an insecure page, a refusal): the value is on the page to select
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const Icon = copied ? Check : Copy;
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      title={copied ? "Copied" : label ? `Copy ${label}` : "Copy"}
      {...props}
      onClick={copy}
    >
      <Icon data-icon={children ? "inline-start" : undefined} />
      {children && (copied ? "Copied" : children)}
    </Button>
  );
}
