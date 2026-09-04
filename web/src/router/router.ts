/**
 * The browser half of PRD 6.7: `history.pushState`, `popstate`, and a snapshot React can
 * subscribe to.
 *
 * The address bar is the store. `Router` never keeps a copy of the focus or the filters — every
 * read re-parses `location`, memoised on the exact `path + search` string so `useSyncExternalStore`
 * gets a stable reference between real changes. That is what makes PRD 8.4.2's "focus and filters
 * are derived from the URL, never stored twice" true rather than aspirational.
 *
 * `RouterHost` exists so the whole thing runs under Node in `web/test/router.test.ts`: history
 * semantics are the part of Phase 4 most likely to regress into a `pushState` loop, and a test
 * that needs a browser is a test that does not run.
 */

import type { Focus } from '../navigation'
import type { FilterState } from '../filters/types'
import { formatRoute, parseRoute, type ParsedRoute } from './route'

export interface RouterHost {
  path(): string
  search(): string
  push(url: string): void
  replace(url: string): void
  /** Returns an unsubscribe. Fires for back/forward only, never for our own writes. */
  onPopState(listener: () => void): () => void
}

export function browserHost(target: Window = window): RouterHost {
  return {
    path: () => target.location.pathname,
    search: () => target.location.search,
    push: (url) => target.history.pushState(null, '', url),
    replace: (url) => target.history.replaceState(null, '', url),
    onPopState: (listener) => {
      target.addEventListener('popstate', listener)
      return () => {
        target.removeEventListener('popstate', listener)
      }
    },
  }
}

export interface RouterSnapshot extends ParsedRoute {
  /** `path + search`, and therefore the identity `useSyncExternalStore` compares. */
  readonly url: string
}

export class Router {
  private listeners = new Set<() => void>()
  private cached: RouterSnapshot | null = null

  constructor(private readonly host: RouterHost) {}

  snapshot = (): RouterSnapshot => {
    const url = `${this.host.path()}${this.host.search()}`
    if (this.cached !== null && this.cached.url === url) return this.cached
    const parsed = parseRoute(this.host.path(), this.host.search())
    this.cached = { ...parsed, url }
    return this.cached
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Back/forward. The binding turns this into a `'history'` navigation (PRD 6.2.2). */
  onPopState = (listener: () => void): (() => void) => {
    return this.host.onPopState(() => {
      this.cached = null
      listener()
      this.notify()
    })
  }

  /**
   * PRD 6.2.2: "every focus change that changes the route pushes a history entry, so browser back
   * behaves like Esc". A write that would not change the URL is dropped, which is how PRD 6.8.2's
   * deferred second stage avoids a duplicate entry (navigation contract §3a).
   */
  push = (focus: Focus, filters: FilterState): void => {
    const url = formatRoute(focus, filters)
    if (url === this.snapshot().url) return
    this.host.push(url)
    this.cached = null
    this.notify()
  }

  /**
   * `replaceState`, for the two things that rewrite the URL the user already has:
   *  - navigation contract §3a's `'correction'` — a card the data moved or dropped;
   *  - a filter change.
   *
   * Filters replace rather than push on purpose. PRD 6.2.2 scopes history to *focus* changes, and
   * PRD 6.1.3 makes back behave like Esc; if a chip toggle pushed, back would undo a filter
   * instead of going up a level, and the two requirements would contradict each other. Filters
   * still survive reload and sharing (PRD 6.6.6) because they are in the URL either way.
   */
  replace = (focus: Focus, filters: FilterState): void => {
    const url = formatRoute(focus, filters)
    if (url === this.snapshot().url) return
    this.host.replace(url)
    this.cached = null
    this.notify()
  }

  setFilters = (filters: FilterState): void => {
    this.replace(this.snapshot().focus, filters)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}
