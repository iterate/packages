import { createRootRoute } from "@tanstack/react-router";
import { AppDocumentShell, AppRoot } from "@iterate-com/ui/apps/document";
import { appHead } from "@iterate-com/ui/apps/head";
import css from "../styles.css?url";

export const Route = createRootRoute({
  head: () => appHead({ title: "Agents", stylesheet: css }),
  shellComponent: ({ children }) => (
    <AppDocumentShell icon="/client-logo.svg">{children}</AppDocumentShell>
  ),
  component: AppRoot,
});
