// cloudflare-button.tsx — the button that sends someone to Cloudflare (its consent page, its
// dashboard): Cloudflare's orange with its cloud in white, whatever the page's look. And the cloud on
// its own, in its colours, to mark what Cloudflare said or did.
import type { ComponentProps } from "react";
import { cn } from "cn";

// oxlint-disable-next-line iterate/no-shouting-constants -- a long SVG path, named so that the markup stays readable
const CLOUD =
  "M33.204 20.4C33.365 19.974 33.422 19.516 33.37 19.064C33.317 18.611 33.158 18.178 32.904 17.8C32.644 17.488 32.324 17.23 31.964 17.041C31.603 16.852 31.209 16.736 30.804 16.7L13.404 16.5C13.304 16.5 13.204 16.4 13.104 16.4C13.081 16.383 13.062 16.36 13.049 16.334C13.036 16.308 13.029 16.279 13.029 16.25C13.029 16.221 13.036 16.192 13.049 16.166C13.062 16.14 13.081 16.118 13.104 16.1C13.204 15.9 13.304 15.8 13.504 15.8L31.004 15.6C32.115 15.477 33.173 15.06 34.07 14.392C34.966 13.724 35.668 12.829 36.104 11.8L37.104 9.2C37.104 9.1 37.204 9 37.104 8.9C36.56 6.478 35.241 4.301 33.347 2.697C31.452 1.094 29.086 0.153 26.608 0.017C24.13 -0.119 21.675 0.558 19.617 1.945C17.558 3.332 16.009 5.352 15.204 7.7C14.159 6.954 12.884 6.6 11.604 6.7C10.429 6.831 9.334 7.358 8.498 8.194C7.662 9.03 7.135 10.125 7.004 11.3C6.937 11.901 6.971 12.51 7.104 13.1C5.203 13.153 3.397 13.945 2.071 15.308C0.746 16.671 0.004 18.498 0.004 20.4C-0.012 20.77 0.021 21.14 0.104 21.5C0.109 21.578 0.142 21.652 0.197 21.707C0.252 21.762 0.326 21.795 0.404 21.8H32.504C32.704 21.8 32.904 21.7 32.904 21.5L33.204 20.4Z";
// oxlint-disable-next-line iterate/no-shouting-constants -- a long SVG path, named so that the markup stays readable
const ARC =
  "M38.704 9.2H38.204C38.104 9.2 38.004 9.3 37.904 9.4L37.204 11.8C37.043 12.226 36.986 12.684 37.039 13.136C37.091 13.589 37.25 14.022 37.504 14.4C37.765 14.712 38.084 14.97 38.445 15.159C38.805 15.348 39.199 15.464 39.604 15.5L43.304 15.7C43.404 15.7 43.504 15.8 43.604 15.8C43.627 15.818 43.646 15.84 43.659 15.866C43.672 15.892 43.679 15.921 43.679 15.95C43.679 15.979 43.672 16.008 43.659 16.034C43.646 16.06 43.627 16.083 43.604 16.1C43.504 16.3 43.404 16.4 43.204 16.4L39.404 16.6C38.293 16.723 37.235 17.14 36.339 17.808C35.442 18.476 34.74 19.371 34.304 20.4L34.104 21.3C34.004 21.4 34.104 21.6 34.304 21.6H47.504C47.545 21.606 47.586 21.602 47.625 21.589C47.664 21.576 47.7 21.554 47.729 21.525C47.758 21.496 47.78 21.46 47.793 21.421C47.806 21.382 47.81 21.341 47.804 21.3C48.042 20.453 48.176 19.58 48.204 18.7C48.188 16.185 47.182 13.778 45.404 12C43.626 10.222 41.219 9.216 38.704 9.2Z";

/** Cloudflare's cloud: in its two oranges, or one colour (`currentColor`) with `mono`. */
export function CloudflareMark({
  mono = false,
  className,
  ...props
}: ComponentProps<"svg"> & { mono?: boolean }) {
  return (
    <svg viewBox="0 0 49 22" aria-hidden className={cn("w-5 shrink-0", className)} {...props}>
      <path d={CLOUD} className={mono ? "fill-current" : "fill-cloudflare"} />
      <path d={ARC} className={mono ? "fill-current" : "fill-cloudflare-glow"} />
    </svg>
  );
}

/** A link to Cloudflare, as a button: its orange, its cloud in white, then the label. */
export function CloudflareButton({
  size = "default",
  className,
  children,
  ...props
}: ComponentProps<"a"> & { size?: "default" | "sm" }) {
  return (
    <a
      data-slot="cloudflare-button"
      data-size={size}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg bg-cloudflare text-sm font-medium whitespace-nowrap text-white shadow-xs transition-colors select-none hover:bg-cloudflare/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground",
        size === "sm" ? "h-7 gap-1.5 px-2.5" : "h-9 gap-2 px-3.5",
        className,
      )}
      {...props}
    >
      <CloudflareMark mono className={size === "sm" ? "w-4" : "w-5.5"} />
      {children}
    </a>
  );
}
