/**
 * How the UI writes numbers.
 *
 * One `Intl.NumberFormat`, not six. Six was not only six constructions — it was six independent
 * chances for one surface to disagree with another about a thousands separator, in a UI whose
 * whole job is to show the same counts in five different places (review §6.2).
 *
 * `'en-GB'` and not the user's locale, deliberately: PRD 7.5 fixes the interface language, and a
 * count that reads `28,532` in the HUD and `28.532` in the drawer would read as two counts.
 */

const NUMBER = new Intl.NumberFormat('en-GB')

/** A count, grouped: `28532` → `28,532`. */
export function formatCount(value: number): string {
  return NUMBER.format(value)
}
