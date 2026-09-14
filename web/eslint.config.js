// @ts-check
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/*
 * TypeScript itself is the strict gate here: `tsconfig.json` runs `strict` plus
 * `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` (PRD 8.1.3). ESLint's job is the
 * things the compiler will not catch — floating promises, misused awaits, unsafe `any` flowing
 * through the data decoders — so this is the type-checked recommended set, not the stylistic
 * `strictTypeChecked` one.
 */
export default tseslint.config(
  {
    // `bench/windows/results` is generated: the measurement kit writes its JSON, its summaries and
    // the `console-probe.js` snippet there on every run. Linting generated output is noise, and the
    // snippet in particular is deliberately ES5-shaped browser source for a devtools console.
    ignores: [
      'dist',
      'node_modules',
      'public/data',
      'bench/windows/results',
      '**/*.d.ts',
      '**/*.d.mts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // The decoders index typed arrays in hot paths; `noUncheckedIndexedAccess` already forces
      // the assertions, and re-checking per element is the per-frame cost PRD 7.3.2 forbids.
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
  {
    files: ['**/*.mjs', '*.config.js'],
    ...tseslint.configs.disableTypeChecked,
    // `scripts/visual-gate.mjs` is a Node script whose `page.evaluate` callbacks are
    // serialised and run in the browser, so it legitimately references both global sets.
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    /*
     * The shell does not know there is a GPU (review §3.6, W4.2 item 6).
     *
     * `ui/` is PRD section 6's React chrome and `app/` is the shell that composes it; the renderer
     * reaches them through the store and a polled stats snapshot, never the other way round. Once
     * the frame loop moves out of react-three-fiber the only thing holding that boundary is this
     * rule, so it lands *before* the loop moves rather than after: the window in which the boundary
     * is most likely to be breached is the one where three-dependent code is being carried between
     * files.
     *
     * Type-only imports are restricted too, and deliberately — `allowTypeImports` is left off. An
     * `import type { WebGLRenderer }` erases at runtime and costs no bytes, but it still writes a
     * panel's signature in terms of the renderer, which is the coupling this forbids. The scene
     * hands plain data across the seam.
     */
    files: ['src/ui/**/*.{ts,tsx}', 'src/app/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // `three` itself, and its subpath entries (`three/examples/...`, `three/src/...`).
              group: ['three', 'three/*'],
              message:
                'ui/ and app/ must not import three (review §3.6). Reach the scene through the store or the FrameStats snapshot.',
            },
            {
              group: ['@react-three/*'],
              message:
                'ui/ and app/ must not import react-three-fiber (review §3.6). The render loop is not a React tree.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['test/**/*.ts', 'scripts/**/*', '*.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // The Playwright specs run in Node, but their `evaluate` callbacks are serialised and run in
    // the page exactly as `scripts/visual-gate.mjs`'s are — so both global sets are legitimately
    // in scope in one file.
    files: ['e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
)
