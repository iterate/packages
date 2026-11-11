// connect-project.tsx — POINT AN APP AT A PROJECT: one field, the project's address. Every app
// serves it at `/connect` (iterate/app-server `CONNECT_PAGE_PATH`). The form posts to the app's own
// `/.auth/connect`, a same-origin POST, which is the only way a browser is bound to a project. The
// gate finds the project's sign-in provider and answers where to sign in, or why it cannot.
import { useEffect, useId, useState } from "react";
import { z } from "zod";
import { IterateLogo } from "#/components/iterate-logo.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Field, FieldDescription, FieldError, FieldLabel } from "#/components/ui/field.tsx";
import { Input } from "#/components/ui/input.tsx";

const GateAnswer = z.union([z.object({ location: z.string() }), z.object({ error: z.string() })]);

export function ConnectProject({
  app,
  project = "",
  next,
}: {
  /** the app's name, above the form */
  app: string;
  /** the address to fill in: the gate sends a browser here for a project it is not connected to */
  project?: string;
  /** where the browser lands once signed in; by default the project's own page */
  next?: string;
}) {
  const fieldId = useId();
  const [address, setAddress] = useState(project);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // back from the issuer with the browser's back button, a page out of the back/forward cache is
  // still connecting
  useEffect(() => {
    const again = () => setConnecting(false);
    window.addEventListener("pageshow", again);
    return () => window.removeEventListener("pageshow", again);
  }, []);

  const connect = async () => {
    setConnecting(true);
    setError(null);
    const form = new FormData();
    form.set("project", address);
    if (next) form.set("next", next);
    try {
      // react-doctor-disable-next-line react-doctor/no-fetch-response-used-without-status-check -- checked on the next line: a 400 is the gate's refusal, and its body is the reason
      const response = await fetch("/.auth/connect", { method: "POST", body: form });
      if (!response.ok && response.status !== 400) throw new Error(`gate ${response.status}`);
      const answer = GateAnswer.safeParse(await response.json());
      if (!answer.success) throw new Error("not the gate's answer");
      if ("location" in answer.data) {
        window.location.assign(answer.data.location);
        return;
      }
      setError(answer.data.error);
    } catch {
      setError("This app could not connect just now. Try again.");
    }
    setConnecting(false);
  };

  return (
    <main className="flex min-h-svh flex-col items-center justify-center p-6">
      <form
        className="flex w-full max-w-sm flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
      >
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-md bg-black">
            <IterateLogo alt="" className="size-7" />
          </span>
          <div className="flex flex-col">
            <h1 className="text-lg font-semibold">Connect a project</h1>
            <span className="text-sm text-muted-foreground">{app}</span>
          </div>
        </div>
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor={fieldId}>Project address</FieldLabel>
          <Input
            id={fieldId}
            name="project"
            className="h-11 sm:h-9"
            placeholder="iterate.example.com"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            aria-invalid={error ? true : undefined}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="url"
            spellCheck={false}
            inputMode="url"
            enterKeyHint="go"
            required
          />
          <FieldDescription>
            Type the project&apos;s address, like iterate.example.com. The domain alone works too.
          </FieldDescription>
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
        <Button type="submit" className="h-11 sm:h-9" disabled={connecting || !address.trim()}>
          {connecting ? "Connecting…" : "Connect"}
        </Button>
      </form>
    </main>
  );
}
