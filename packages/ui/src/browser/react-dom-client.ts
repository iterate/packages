// The build's `react-dom/client`, by name (CommonJS), for a page's import map.
// Read untyped: @types/react-dom has no `version` here.
import * as client from "react-dom/client";

const reactDomClient: Record<string, unknown> = client;

export const { createRoot, hydrateRoot, version } = reactDomClient;
