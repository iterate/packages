// The build's React for a page's import map (`"react": "…/@iterate-com/ui@<version>/react"`), so a
// React library the page loads from esm.sh with `?external=react,react-dom` uses the same React as this
// package's components. React is CommonJS: `export * from "react"` would export nothing, so its API
// is listed by name (react-modules.test.ts checks the list against React's production build), read
// untyped: @types/react lags the build (it has no `unstable_useCacheRefresh`).
import React from "react";

const react: Record<string, unknown> = React;

export default React;
export const {
  Activity,
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  ViewTransition,
  addTransitionType,
  cache,
  cacheSignal,
  cloneElement,
  createContext,
  createElement,
  createRef,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  startTransition,
  unstable_useCacheRefresh,
  use,
  useActionState,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version,
} = react;
