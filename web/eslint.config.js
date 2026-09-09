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
    // `scripts/verify-browser.mjs` is a Node script whose `page.evaluate` callbacks are
    // serialised and run in the browser, so it legitimately references both global sets.
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['test/**/*.ts', 'scripts/**/*', '*.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // The Playwright specs run in Node, but their `evaluate` callbacks are serialised and run in
    // the page exactly as `verify-browser.mjs`'s are — so both global sets are legitimately in
    // scope in one file.
    files: ['e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
)
