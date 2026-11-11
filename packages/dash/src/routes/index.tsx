import { createFileRoute } from "@tanstack/react-router";
import { LastProjectRedirect } from "@iterate-com/ui/components/last-project-redirect";

// the project this browser used last, or the connect page when it is connected to none
export const Route = createFileRoute("/")({ component: LastProjectRedirect });
