/** The page's root font size in px: what 1rem is, for a virtual list that positions rows of a
 *  height in rem. A browser set to a larger default font makes it larger. A server render has no
 *  page to ask, and takes 16 px. */
export function pxPerRem(): number {
  if (import.meta.env.SSR) return 16;
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}
