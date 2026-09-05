/**
 * The three long-lived objects the shell needs, created once outside React and handed in.
 *
 * Outside React on purpose. `StrictMode` mounts, unmounts and remounts every component while
 * *keeping its state*, so a navigation API created in `useState` and disposed on unmount comes
 * back disposed on the second mount. The scene's camera rig has the same lifetime as the page, so
 * that is the lifetime it gets — created in `main.tsx`, never disposed.
 *
 * `createNavigation()` is also the single seam Phase 2b replaces: the whole shell reaches the
 * scene through it, so swapping the Phase 0 stub for the real rig is a one-line change here and
 * nowhere else (navigation contract, header).
 */

import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'

import {
  createNavigationStub,
  type NavigationApi,
  type NavigationSnapshot,
} from '../navigation'
import { Router, browserHost, type RouterSnapshot } from '../router/router'

/**
 * Phase 4 builds against the stub; Phase 2b returns the real implementation from here and no call
 * site changes. If a call site has to change, the contract was wrong.
 */
export function createNavigation(): NavigationApi {
  return createNavigationStub()
}

/**
 * `useSyncExternalStore` compares snapshots by identity, and `NavigationApi.snapshot()` builds a
 * fresh object per call — subscribing React to it directly is an infinite render loop. This holds
 * the last snapshot the API pushed, so identity only changes when the state does.
 */
export interface NavStore {
  subscribe: (listener: () => void) => () => void
  get: () => NavigationSnapshot
}

export function createNavStore(nav: NavigationApi): NavStore {
  let current = nav.snapshot()
  const listeners = new Set<() => void>()
  nav.subscribe((snapshot) => {
    current = snapshot
    for (const listener of listeners) listener()
  })
  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    get: () => current,
  }
}

export interface Services {
  readonly nav: NavigationApi
  readonly navStore: NavStore
  readonly router: Router
}

export function createServices(): Services {
  const nav = createNavigation()
  return { nav, navStore: createNavStore(nav), router: new Router(browserHost()) }
}

const ServicesContext = createContext<Services | null>(null)

export function ServicesProvider({
  services,
  children,
}: {
  services: Services
  children: ReactNode
}): ReactNode {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>
}

export function useServices(): Services {
  const services = useContext(ServicesContext)
  if (services === null) throw new Error('useServices outside <ServicesProvider>')
  return services
}

export function useNavigation(): NavigationApi {
  return useServices().nav
}

export function useRouter(): Router {
  return useServices().router
}

/** PRD 6.7.1: every component that needs focus or filters reads them from here, not from a store. */
export function useRoute(): RouterSnapshot {
  const { router } = useServices()
  return useSyncExternalStore(router.subscribe, router.snapshot, router.snapshot)
}

export function useNavSnapshot(): NavigationSnapshot {
  const { navStore } = useServices()
  return useSyncExternalStore(navStore.subscribe, navStore.get, navStore.get)
}
