import { createServerEntry } from "@tanstack/react-start/server-entry";
import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { appServerEntry } from "@iterate-com/ui/apps/server";
import {
  basePathOf,
  buildBasePath,
  underBasePath,
  withoutBuildBasePath,
} from "@iterate-com/ui/apps/base-path";
// Every app's Worker config binds the class (scripts/lib/start-app.ts startAppWorkerConfig); the
// Cloud app signs no one in (the Cloud's config worker does: @iterate-com/cloud/worker), so it
// holds no session.
export { BrowserSession } from "iterate/app-session";

/** The Cloud's pages, their scripts and stylesheets under the request's base path
 *  (@iterate-com/ui/apps/base-path), per request: the Cloud is served at a host's root or under
 *  `/projects/<project>` on a platform origin, as packages/notes is. */
const start = createStartHandler({
  handler: defaultStreamHandler,
  transformAssets: {
    createTransform: (context) => {
      const basePath = context.warmup ? buildBasePath : basePathOf(context.request.headers);
      return ({ url }) => underBasePath(basePath, url);
    },
    cache: false,
  },
});

const pages = appServerEntry(
  {
    // A page renders at the URL the browser addressed, its base path back on: at the stripped URL
    // the router would redirect to its canonical one, the base path on, which the edge strips
    // again.
    fetch(request) {
      const basePath = basePathOf(request.headers);
      if (!basePath) return start(request);
      const addressed = new URL(request.url);
      addressed.pathname = `${basePath}${addressed.pathname}`;
      return start(new Request(addressed, request));
    },
  },
  { proxied: true },
);

/** The Cloud's project's config worker (@iterate-com/cloud `serveCloud`) fetches every page
 *  through to here, keeping the visitor's cookies to itself and saying the base path. */
export default createServerEntry({
  fetch: (incoming) => pages.fetch(withoutBuildBasePath(incoming)),
});
