/**
 * PRD 6.10's settings and PRD 6.3.4's "reduced-motion and settings state persist across sessions
 * in local storage". PRD 8.10 keeps that local: no accounts, no server, one key.
 *
 * Reduced motion has three states rather than two, because PRD 6.10.1's default is "follows the OS
 * preference" and a stored `false` cannot express the difference between "the user turned it off"
 * and "the OS said no last time". Storing `'os'` keeps the OS in charge until the user actually
 * touches the toggle, which is what the requirement asks for.
 */

export type ReducedMotionSetting = 'os' | 'on' | 'off'
/** PRD 6.10.1's three steps. */
export type BloomSetting = 0 | 1 | 2

export interface Settings {
  readonly reducedMotion: ReducedMotionSetting
  readonly bloom: BloomSetting
  readonly labels: boolean
  /** PRD 6.8.3: "dismissal is remembered locally"; the help control resets it. */
  readonly hintDismissed: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  reducedMotion: 'os',
  bloom: 1,
  labels: true,
  hintDismissed: false,
}

const STORAGE_KEY = 'eternities:settings:v1'

/**
 * Everything here tolerates a `localStorage` that throws. Safari in private mode and a
 * third-party-cookie-blocked iframe both do, and a settings read is not worth a blank page.
 */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function isBloom(value: unknown): value is BloomSetting {
  return value === 0 || value === 1 || value === 2
}

function isReducedMotion(value: unknown): value is ReducedMotionSetting {
  return value === 'os' || value === 'on' || value === 'off'
}

/** Field-by-field validation: a stored blob from an older build must not poison the store. */
export function parseSettings(raw: string | null): Settings {
  if (!raw) return DEFAULT_SETTINGS
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_SETTINGS
  }
  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_SETTINGS
  const value = parsed as Partial<Record<keyof Settings, unknown>>
  return {
    reducedMotion: isReducedMotion(value.reducedMotion)
      ? value.reducedMotion
      : DEFAULT_SETTINGS.reducedMotion,
    bloom: isBloom(value.bloom) ? value.bloom : DEFAULT_SETTINGS.bloom,
    labels: typeof value.labels === 'boolean' ? value.labels : DEFAULT_SETTINGS.labels,
    hintDismissed:
      typeof value.hintDismissed === 'boolean'
        ? value.hintDismissed
        : DEFAULT_SETTINGS.hintDismissed,
  }
}

export function loadSettings(): Settings {
  try {
    return parseSettings(storage()?.getItem(STORAGE_KEY) ?? null)
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: Settings): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // A full or unavailable quota costs the user their preferences next session, nothing more.
  }
}

/** PRD 5.9 / 6.10.1: what the OS asks for, when the setting defers to it. */
export function osPrefersReducedMotion(): boolean {
  if (typeof matchMedia !== 'function') return false
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export function resolveReducedMotion(setting: ReducedMotionSetting, os: boolean): boolean {
  if (setting === 'on') return true
  if (setting === 'off') return false
  return os
}
