/**
 * The three long-lived objects the shell needs, created once outside React and handed in.
 *
 * Outside React on purpose. `StrictMode` mounts, unmounts and remounts every component while
 * *keeping its state*, so a navigation API created in `useState` and disposed on unmount comes
 * back disposed on the second mount. The scene's camera rig has the same lifetime as the page, so
 * that is the lifetime it gets — created in `main.tsx`, never disposed.
 *
 * `createNavigationHost()` is also the single seam Phase 2b replaced: the whole shell reaches the
 * scene through it, so swapping the Phase 0 stub for the real rig was a one-line change here and
 * nowhere else (navigation contract, header). It is called directly — the local `createNavigation`
 * wrapper that used to sit in front of it forwarded and did nothing else (review §6.3).
 */

import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'

import {
  createNavigationHost,
  type NavigationApi,
  type NavigationHost,
  type NavigationSnapshot,
} from '../navigation'
import { Router, browserHost, type RouterSnapshot } from '../router/router'
import { probeRequested } from '../scene/probe'
import { SceneHost } from '../scene/renderer/sceneHost'
import { SELF_CHECK_FAR, selfCheckRequested } from '../scene/selfCheck.url'

/**
 * The host is not a third implementation — it forwards to the stub until the scene has built the
 * real rig from `planes.json`, then forwards to that, keeping the shell's listeners across the
 * swap. See `../navigation/host`.
 */

/**
 * `useSyncExternalStore` compares snapshots by identity, and `NavigationApi.snapshot()` builds a
 * fresh object per call — subscribing React to it directly is an infinite render loop. This holds
 * the last snapshot the API pushed, so identity only changes when the state does.
 */
export interface NavStore {
  subscribe: (listener: () => void) => () => void
  get: () => NavigationSnapshot
}

export function createNavStore(nav: Pick<NavigationApi, 'snapshot' | 'subscribe'>): NavStore {
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
  /**
   * Typed as the host rather than as `NavigationApi`, because the scene needs `attach()` and there
   * is exactly one place it can come from. Every other consumer sees only the contract.
   */
  readonly nav: NavigationHost
  readonly navStore: NavStore
  readonly router: Router
  /**
   * The renderer: one canvas, one `WebGLRenderer`, one `requestAnimationFrame` (review §3.6 phase
   * 3, item 1 — "created in `createServices()` next to the navigation host and router").
   *
   * It belongs here for the same reason the other two do, and the argument is now stronger rather
   * than weaker: `<Canvas>` resolved its GL options, its camera and its pixel ratio from props, so
   * every one of them was a value React owned and could recompute. The renderer has the lifetime of
   * the page, so that is the lifetime it gets.
   *
   * Its public surface names no three.js type, which is what lets this module — under `app/`, where
   * `eslint.config.js` forbids importing three — hold one. See `scene/renderer/sceneHost`.
   */
  readonly scene: SceneHost
}

export function createServices(): Services {
  const nav = createNavigationHost()
  return {
    nav,
    navStore: createNavStore(nav),
    router: new Router(browserHost()),
    // Both options are decided once, here, from the URL the page was opened with: they are
    // `WebGLRenderer` and `PerspectiveCamera` construction arguments, so there is no later point at
    // which either could be applied. See `SceneRendererOptions`.
    //
    // Reading the URL in `createServices` is the arrangement item 4 of review §3.6 phase 3 replaces:
    // once the harness has an entry of its own, the harness decides these and the product entry
    // never asks the question.
    scene: new SceneHost({
      // Without a preserved buffer, reading the canvas back gives whatever frame the compositor
      // last kept rather than the frame the assertions were made against. The self-check exists to
      // be read back, so it is unconditional there.
      preserveDrawingBuffer: probeRequested() || selfCheckRequested(),
      ...(selfCheckRequested() ? { cameraFar: SELF_CHECK_FAR } : {}),
    }),
  }
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

export function useNavigation(): NavigationHost {
  return useServices().nav
}

export function useRouter(): Router {
  return useServices().router
}

/** The renderer. `ui/` reaches it for the `FrameStats` snapshot and for nothing else. */
export function useSceneHost(): SceneHost {
  return useServices().scene
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
