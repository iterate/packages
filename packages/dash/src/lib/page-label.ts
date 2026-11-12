import { useMatches } from "@tanstack/react-router";

/** The label the deepest page that names itself gives (`staticData: { page }`), for the header. */
export function usePageLabel() {
  return useMatches()
    .map((match) => match.staticData.page)
    .filter((label): label is string => Boolean(label))
    .at(-1);
}
