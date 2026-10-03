// The build's `react/jsx-runtime`, by name (React is CommonJS), for a page's import map: a library
// esm.sh builds with `?external=react,react-dom` imports it bare.
import * as runtime from "react/jsx-runtime";

export const { Fragment, jsx, jsxs } = runtime;
