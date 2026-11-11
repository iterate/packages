/**
 * The naming convention for disposable test fixtures (minds, orgs) minted
 * by the Playwright suite's fixtures (test/helpers/forged-session.ts):
 * `<prefix>-<base36 timestamp>-<uuid slice>`.
 *
 * Mind slugs become DNS labels (`<slug>.localhost`, a mind host), so
 * the result is lowercased, double dashes are collapsed, and callers that
 * take arbitrary prefixes should pass `maxPrefixLength` to stay under label
 * length limits. The timestamp keeps leaked fixtures attributable/sortable:
 * there is no `minds.remove` on itx yet, so disposal is a no-op and stages
 * accumulate fixtures until reset.
 */
export function uniqueFixtureSlug(prefix: string, opts?: { maxPrefixLength?: number }): string {
  return `${prefix.slice(0, opts?.maxPrefixLength)}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`
    .toLowerCase()
    .replace(/-{2,}/g, "-");
}
