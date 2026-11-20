// THE ALERT THAT REQUESTS WAIT FOR A YES: the first thing in a Dash's sidebar on every page of the
// mind, because an agent stands still until a member answers. It is a link to where the member
// answers, and the page says what that link is (`render`): a router's link, or a plain anchor.
// On the collapsed rail it shows the icon alone. With nothing waiting it draws nothing.
//
//   <ApprovalsAlert waiting={useWaitingApprovals(mind, read)} render={<a href="/approvals" />} />
import { useRender } from "@base-ui/react/use-render";
import { ShieldAlert } from "lucide-react";

export function ApprovalsAlert({
  waiting,
  render,
}: {
  /** How many requests wait (`useWaitingApprovals`, lib/waiting-approvals.ts). */
  waiting: number;
  /** The link the alert is: an anchor, or the app router's link, with where it goes. */
  render: useRender.RenderProp;
}) {
  const short = waiting === 1 ? "1 request waits" : `${waiting} requests wait`;
  const words =
    waiting === 1 ? "1 request waits for approval" : `${waiting} requests wait for approval`;
  // the count is on the element: a page's own check, and a test, read it there
  const props: Record<string, unknown> = {
    "data-approvals-alert": waiting,
    title: words,
    className:
      "flex items-center gap-2 rounded-lg border border-warning/50 bg-warning/10 px-2.5 py-2 text-sm font-medium outline-none hover:bg-warning/20 focus-visible:ring-3 focus-visible:ring-ring/50 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-1.5",
    children: (
      <>
        <ShieldAlert aria-hidden className="size-4 shrink-0 text-warning" />
        <span className="truncate group-data-[collapsible=icon]:hidden">{short}</span>
      </>
    ),
  };
  const alert = useRender({ defaultTagName: "a", render, props });
  return waiting > 0 ? alert : null;
}
