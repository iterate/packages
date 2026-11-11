// The path in the shell's header: the mind's address, then the page when it names itself
// (› Contexts, › Repos). The address hides on narrow screens when a page follows it.
import { Link } from "@tanstack/react-router";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@iterate-com/ui/components/ui/breadcrumb";

export function DashBreadcrumbs({
  mind,
  page,
}: {
  /** the mind's address */
  mind: string;
  /** the label a page names itself with (`staticData: { page }`) */
  page?: string;
}) {
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {page ? (
          <>
            <BreadcrumbItem className="hidden md:inline-flex">
              <BreadcrumbLink
                className="font-mono"
                render={<Link to="/minds/$mind" params={{ mind }} />}
              >
                {mind}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:inline-flex" />
            <BreadcrumbItem>
              <BreadcrumbPage>{page}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : (
          <BreadcrumbItem>
            <BreadcrumbPage className="font-mono">{mind}</BreadcrumbPage>
          </BreadcrumbItem>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
