import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { appServerEntry } from "@iterate-com/ui/apps/server";
export { BrowserSession } from "iterate/app-session";

export default createServerEntry(appServerEntry(handler, { clientName: "iterate Agents" }));
