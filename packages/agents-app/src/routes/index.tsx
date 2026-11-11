import { createFileRoute } from "@tanstack/react-router";
import { LastMindRedirect } from "@iterate-com/ui/components/last-mind-redirect";

// the mind this browser used last, or the connect page when it is connected to none
export const Route = createFileRoute("/")({ component: LastMindRedirect });
