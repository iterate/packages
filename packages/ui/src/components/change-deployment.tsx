// change-deployment.tsx — CHANGE THE DEPLOYMENT AN APP TALKS TO, from the app: the deployments this
// browser knows, and an address box for one it does not. An app offers it from the account menu
// (`AppShell`'s `deploymentHome`) and from any page a signed-out person sees (`ChangeDeploymentLink`).
import { useEffect, useRef, useState } from "react";
import { CheckIcon } from "lucide-react";
import {
  connectTo,
  deploymentChoices,
  deploymentOriginOf,
  rememberedDeployments,
  useConnectedPlatform,
} from "./app-shell-platform.ts";
import { Button } from "#/components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog.tsx";
import { Input } from "#/components/ui/input.tsx";

/** `next` is where a person lands on the new deployment: a page every deployment has, since the
 *  one they are on may name a project the new one lacks. */
export function ChangeDeploymentDialog({
  open,
  onOpenChange,
  next,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  next: string;
}) {
  const platform = useConnectedPlatform();
  const popupRef = useRef<HTMLDivElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const [address, setAddress] = useState("");
  const [connecting, setConnecting] = useState(false);
  const typed = deploymentOriginOf(address);
  const choices = open ? deploymentChoices(platform, rememberedDeployments()) : [];

  // back from the gate's refusal, a page out of the back/forward cache is still connecting
  useEffect(() => {
    const again = () => setConnecting(false);
    window.addEventListener("pageshow", again);
    return () => window.removeEventListener("pageshow", again);
  }, []);

  // PostHog needs no reset here: the gate may refuse, and a new person resets it on sign-in
  const connect = (origin: string) => {
    setConnecting(true);
    connectTo(origin, next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* one column that may shrink, so that a long host truncates. The cursor waits in the address
          box, but for a touch screen, whose keyboard would cover the rows a person came to press. */}
      <DialogContent
        ref={popupRef}
        className="grid-cols-1"
        initialFocus={() =>
          globalThis.matchMedia?.("(pointer: coarse)").matches
            ? popupRef.current
            : addressRef.current
        }
      >
        <DialogHeader>
          <DialogTitle>Change deployment</DialogTitle>
          <DialogDescription>
            You sign in there, and this app shows what it holds. Connect only to a deployment you
            trust.
          </DialogDescription>
        </DialogHeader>
        {choices.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {choices.map((choice) => (
              <li key={choice.origin}>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-full justify-between gap-3 disabled:opacity-100 sm:h-9"
                  disabled={choice.current || connecting}
                  aria-current={choice.current ? "true" : undefined}
                  onClick={() => connect(choice.origin)}
                >
                  <span className="min-w-0 truncate">{choice.host}</span>
                  <DeploymentMark current={choice.current} isDefault={choice.isDefault} />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (typed) connect(typed);
          }}
        >
          <Input
            ref={addressRef}
            className="h-11 sm:h-9"
            aria-label="Another deployment's address"
            placeholder="iterate.example.com"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
            enterKeyHint="go"
          />
          <Button type="submit" className="h-11 sm:h-9" disabled={!typed || connecting}>
            Connect
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeploymentMark({ current, isDefault }: { current: boolean; isDefault: boolean }) {
  if (current)
    return (
      <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <CheckIcon aria-hidden className="size-3.5" />
        Current
      </span>
    );
  return isDefault ? <span className="shrink-0 text-xs text-muted-foreground">Default</span> : null;
}

/** For a page with no account menu: the signed-out landing page, whose sign-in goes to the app's
 *  default, and a deployment with nothing to show. */
export function ChangeDeploymentLink({ next }: { next: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="link"
        className="h-11 text-muted-foreground sm:h-8"
        onClick={() => setOpen(true)}
      >
        Use another deployment
      </Button>
      <ChangeDeploymentDialog open={open} onOpenChange={setOpen} next={next} />
    </>
  );
}
