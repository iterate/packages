// The sidebar's body for the Cloud (the frame around it is packages/ui's AppShell): the person's
// deployments, newest first, with "New deployment"; then the integrations, one page each.
import { Link, useRouterState } from "@tanstack/react-router";
import { CloudIcon, PlusIcon, ServerIcon } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@iterate-com/ui/components/ui/sidebar";
import { usePerson } from "../lib/iterate.ts";

/** The X mark: lucide has none. */
function XIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden fill="currentColor" {...props}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export function CloudNav() {
  const person = usePerson();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const deployments = [...(person.value?.deployments || [])].reverse();
  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Deployments</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={pathname === "/deployments/new"}
                tooltip="New deployment"
                render={<Link to="/deployments/new" />}
              >
                <PlusIcon />
                <span>New deployment</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {deployments.map((deployment) => (
              <SidebarMenuItem key={deployment.id}>
                <SidebarMenuButton
                  isActive={pathname === `/deployments/${deployment.id}`}
                  tooltip={deployment.name}
                  render={<Link to="/deployments/$id" params={{ id: deployment.id }} />}
                >
                  <ServerIcon />
                  <span className="truncate font-mono">{deployment.name}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>Integrations</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={pathname === "/integrations/cloudflare"}
                tooltip="Cloudflare"
                render={<Link to="/integrations/cloudflare" />}
              >
                <CloudIcon />
                <span>Cloudflare</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={pathname === "/integrations/x"}
                tooltip="X"
                render={<Link to="/integrations/x" />}
              >
                <XIcon className="size-4" />
                <span>X</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
