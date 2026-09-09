import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

/**
 * Two projects, because the suite has two genuinely different needs.
 *
 * `unit` is everything that existed before: decoders, the navigation machine, the layout solver,
 * the contract's TypeScript half. It runs in `node` and it must keep running in `node` — a DOM in
 * scope is how a module that is supposed to be pure quietly grows a dependency on one.
 *
 * `dom` is the component suite of review §6.4 T1. Before it there were zero component tests, and
 * the cost of that was concrete: settings `bloom` and `labels` were persisted, read by nothing,
 * and shipped that way for two phases. One render assertion would have caught both.
 *
 * `.test.ts` versus `.test.tsx` decides which project a file joins, so nothing has to be listed
 * twice. A `.tsx` test file used to be silently *not collected* under the old single-project
 * `include` (DEC-654) — that is the failure mode this split removes.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['test/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['test/**/*.test.tsx'],
          setupFiles: ['test/dom-setup.ts'],
        },
      },
    ],
  },
})
