import { useState, type ComponentProps, type ReactNode } from "react";
import { Button } from "#/components/ui/button.tsx";
import { Spinner } from "#/components/ui/spinner.tsx";

/** A connect answer's link pointed somewhere other than the platform the app is signed in to. */
export class ForeignStartLinkError extends Error {}

/** The link a connect answered, as the href to follow — only when it is an absolute http(s) URL on
 *  `platformOrigin`, the platform (issuer) this app's session is bound to. Every connect answers
 *  that platform's own start link (core/os secret-oauth-start.ts), never the provider's URL, so a
 *  link anywhere else — another origin, a relative path the app would resolve against its own
 *  origin, `javascript:` — is refused, and nothing is opened. */
export function startLinkOn(link: string, platformOrigin: string): string {
  let url: URL;
  let platform: URL;
  try {
    url = new URL(link);
    platform = new URL(platformOrigin);
  } catch {
    throw new ForeignStartLinkError("The connect link is not a full address. Nothing was opened.");
  }
  if (!["https:", "http:"].includes(url.protocol) || url.origin !== platform.origin)
    throw new ForeignStartLinkError(
      `The connect link is not on ${platform.host}, the platform you are signed in to. Nothing was opened.`,
    );
  return url.href;
}

/** CONNECT A PROVIDER — or ask it for more: one button that asks `connect` where to send the
 *  browser and goes there. `connect` is the caller's own call — `itx.integrations.connect(provider,
 *  { scopes, connection, next })` on a project's context or on `session.user` — so the button knows
 *  no SDK, no owner and no provider list: its label is the caller's. It follows only a link on
 *  `platformOrigin`, the platform the app is signed in to (`startLinkOn`). Naming an existing
 *  `connection` with more `scopes` asks the same account for them. The spinner stays up while the
 *  browser leaves; a refusal comes back to `onError`. */
export function ConnectButton<Provider extends string>({
  provider,
  scopes,
  connection,
  connect,
  platformOrigin,
  onError,
  children,
  disabled,
  ...props
}: Omit<ComponentProps<typeof Button>, "onClick" | "onError"> & {
  provider: Provider;
  scopes?: string[];
  connection?: string;
  children: ReactNode;
  connect: (input: {
    provider: Provider;
    scopes?: string[];
    connection?: string;
  }) => Promise<{ authorizationUrl: string }>;
  /** the origin of the platform (issuer) the app is signed in to: the only origin it navigates to */
  platformOrigin: string;
  onError?: (error: unknown) => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const start = async () => {
    setLeaving(true);
    try {
      const { authorizationUrl } = await connect({ provider, scopes, connection });
      window.location.assign(startLinkOn(authorizationUrl, platformOrigin));
    } catch (error) {
      setLeaving(false);
      onError?.(error);
    }
  };
  return (
    <Button {...props} disabled={disabled || leaving} onClick={() => void start()}>
      {leaving ? <Spinner data-icon="inline-start" /> : null}
      {children}
    </Button>
  );
}
