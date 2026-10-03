// The build's `react-dom`, by name (CommonJS), for a page's import map: a library esm.sh builds with
// `?external=react,react-dom` imports it bare, for portals and `flushSync`.
import ReactDOM from "react-dom";

export default ReactDOM;
export const {
  browser,
  createPortal,
  flushSync,
  preconnect,
  prefetchDNS,
  preinit,
  preinitModule,
  preload,
  preloadModule,
  requestFormReset,
  unstable_batchedUpdates,
  useFormState,
  useFormStatus,
  version,
} = ReactDOM;
