// copy-text.tsx — a value to copy (a password, a command), in full, with a button that copies it.
// `label` names the value for a screen reader ("Copy password"), where a page has several.
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
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={copy}
        title={copied ? "Copied" : label ? `Copy ${label}` : "Copy"}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}
