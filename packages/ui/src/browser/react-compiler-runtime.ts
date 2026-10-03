// The build's `react/compiler-runtime`, by name (CommonJS), for a page's import map: a library built
// by React Compiler imports it.
// Read untyped: @types/react does not declare it.
import * as runtime from "react/compiler-runtime";

const compilerRuntime: Record<string, unknown> = runtime;

export const { c } = compilerRuntime;
