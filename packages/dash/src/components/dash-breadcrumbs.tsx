// The path in the shell's header: the project's address, then the page when it names itself
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
  project,
  page,
}: {
  /** the project's address */
  project: string;
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
                render={<Link to="/projects/$project" params={{ project }} />}
              >
                {project}
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:inline-flex" />
            <BreadcrumbItem>
              <BreadcrumbPage>{page}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        ) : (
          <BreadcrumbItem>
            <BreadcrumbPage className="font-mono">{project}</BreadcrumbPage>
          </BreadcrumbItem>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
