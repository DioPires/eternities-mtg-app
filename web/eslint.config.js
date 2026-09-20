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
/*
 * Two import boundaries, four rule instances, and one flat-config trap between them.
 *
 * Each boundary needs *two* rules, because `no-restricted-imports` only visits
 * `ImportDeclaration` — it cannot see a dynamic `import()` at all, which is the headline lesson of
 * W4.2 item 4 (see the harness block below). So each boundary is a pair: patterns for the static
 * spelling, `no-restricted-syntax` selectors for the dynamic one. Neither covers both alone.
 *
 * **Why they are assembled from shared arrays instead of written out per block.** The two
 * boundaries apply to *overlapping* file sets — the harness boundary covers all of `src/` while
 * the three.js boundary covers `src/ui/` and `src/app/`, a subset. In flat config, when two config
 * objects both configure one rule for the same file, the later object's options **replace** the
 * earlier object's; they are not merged. That silently deleted the three.js boundary once already
 * (DEC-761 F3): item 6 landed it first and verified it with a 9-row mutation matrix, then item 4
 * added the harness block underneath, and from that commit a plain `import { Scene } from 'three'`
 * in `src/ui/` was accepted — the resolved config for a `ui/` file listed only the harness
 * patterns. Both spellings of both boundaries were green there.
 *
 * So the subset block re-states the superset's rules alongside its own. Nothing in the test suite
 * or the type-checker can see this arrangement break — the only instrument is a mutation matrix
 * that plants a violation and scores the result **by ruleId** (an unused-import error scores
 * identically to a boundary violation otherwise). DEC-763's evidence comment records the 23-row
 * run; its load-bearing rows are the four asserting the harness boundary still fires *inside*
 * `ui/` and `app/`, and `npx eslint --print-config src/ui/<file>` is the one-line check that the
 * resolved rule still lists all three pattern groups (bench/harness, three, @react-three — the
 * `selfCheck` group was dropped with DEC-847 R4 once no such module survived on `main`).
 */

/**
 * The harness boundary, static spelling. `src/**` minus `bench/` and `harness/` themselves.
 *
 * **Both spellings carried a second rule against `scene/selfCheck`, and DEC-752 deleted that module**
 * — 993 lines of galaxy GPU read-back, gone with the starfield it inspected. A rule naming a file
 * nothing can resolve is not a weaker guard, it is a claim about a boundary that no longer has two
 * sides, and it reads as coverage this config does not have. Removed by DEC-847 (R4, DEC-857 item
 * 7); the `bench/` and `harness/` rules below are the live boundary and are untouched.
 */
const HARNESS_IMPORT_PATTERNS = [
  {
    group: ['**/bench/*', '**/harness/*'],
    allowTypeImports: true,
    message:
      'The product entry must not import the harness (review §3.6 phase 3, item 4). A lazy() is not a boundary — rollup follows dynamic imports, so this would put the bench back in the product build. Invert it: take what you need as a prop, the way SceneView takes bench.renderRunner.',
  },
]

/** The harness boundary, dynamic spelling. Literal specifiers only; see the block's header. */
const HARNESS_SYNTAX_RULES = [
  {
    selector: String.raw`ImportExpression[source.value=/(^|\/)(bench|harness)\//]`,
    message:
      'The product entry must not import() the harness (review §3.6 phase 3, item 4). Rollup follows dynamic imports, so this emits the bench from the product entry — the exact thing lazy() failed to prevent. Invert it: take the runner as a prop, the way SceneView takes bench.renderRunner.',
  },
]

/** The three.js boundary, static spelling. `src/ui/` and `src/app/` only. */
const THREE_IMPORT_PATTERNS = [
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
]

/**
 * The three.js boundary, dynamic spelling (DEC-761 F3).
 *
 * One selector for both groups. The regex is anchored and requires `three` to be followed by a
 * `/` or by end-of-string, so it does not match a *local* module whose name merely starts with
 * those five letters — `import('./three-column-layout')`. That is the load-bearing negative
 * control the static rule already had, carried over to this one.
 */
const THREE_SYNTAX_RULES = [
  {
    selector: String.raw`ImportExpression[source.value=/^(three(\/.*)?|@react-three\/.*)$/]`,
    message:
      'ui/ and app/ must not import() three or react-three-fiber (review §3.6). A dynamic import is still an import edge: it keeps three out of the first chunk, not out of this layer. Reach the scene through the store or the FrameStats snapshot.',
  },
]

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
     * The product does not ship its instruments (review §3.6 phase 3, item 4).
     *
     * The bench, the GPU self-check and the `?probe=1` scene have their own Vite entry,
     * `harness.html` -> `src/harness/main.tsx`. What makes that split real is the absence of an
     * import edge from the product entry, and nothing but this rule holds it: `lazy()` does not,
     * which is the whole lesson of the item. Every one of these modules was *already* behind a
     * `lazy()` or a dynamic `import()` and every one of them was still emitted from the product
     * entry, because a dynamic import is a code-splitting hint, not a boundary. Rollup follows
     * `dynamicImports` like any other edge.
     *
     * So this rule is checkable where that mistake is cheap to make — in the editor, on the file
     * being written — rather than only in a `dist/` diff nobody runs per commit. `src/bench/` and
     * `src/harness/` may import the scene freely; the arrow only points one way.
     *
     * **`src/**` with an ignore list, not a list of directories (DEC-761 F2).** This was written
     * as an allow list of the eight paths that existed when item 4 landed, which left
     * `src/camera/ router/ data/ search/ filters/ plane-detail/` — all six reachable from the
     * product entry — outside the boundary entirely. A planted `void import('../bench/BenchRunner')`
     * in `camera/attachRig.ts` linted clean and put BenchRunner back in the product graph. The
     * budget check did not catch it either: `check-budget.mjs` measures, and the first-frame row had
     * roughly 650 KB of headroom under its 1 MB ceiling, so it printed `[ok]` with the bench in it.
     * Default-deny fixes the class rather than the instance — a directory added next week is
     * covered on creation, which an allow list can never be.
     *
     * `allowTypeImports` is on here, unlike the three.js rule below. The reasons differ: that rule
     * forbids `ui/` from *describing itself* in renderer terms, which a type import still does.
     * This one is about emitted bytes, and `import type { BenchRunnerProps }` emits none —
     * `SceneView` takes the runner as a prop and needs to name its shape without naming its module.
     * That is the inversion item 4 asked for, not a hole in it.
     *
     * Literal specifiers only — a computed `import(someVariable)` is invisible to any lint rule.
     * The build manifest is the backstop there: `scripts/check-budget.mjs` reads which files each
     * entry can reach, so a specifier this cannot parse still shows up as harness bytes landing
     * back on the product's budget. It reports rather than gates, which is why the lint rule is
     * the boundary and the budget row is the second opinion.
     */
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/bench/**', 'src/harness/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: HARNESS_IMPORT_PATTERNS }],
      'no-restricted-syntax': ['error', ...HARNESS_SYNTAX_RULES],
    },
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
     *
     * **This block must stay below the harness block and must re-state its rules.** `src/ui/` and
     * `src/app/` match both, and flat config resolves a doubly-configured rule by replacement, not
     * by merge — so whichever block is second is the only one that exists for these files. Written
     * as two independent blocks, this one lost and the three.js boundary was silently absent from
     * `ui/` and `app/` (DEC-761 F3). Spreading both arrays here is what keeps the two boundaries
     * additive. If you split them again, both spellings of this boundary go quiet with no error
     * anywhere — check `eslint --print-config` on a `ui/` file, not the exit code.
     */
    files: ['src/ui/**/*.{ts,tsx}', 'src/app/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        { patterns: [...HARNESS_IMPORT_PATTERNS, ...THREE_IMPORT_PATTERNS] },
      ],
      'no-restricted-syntax': ['error', ...HARNESS_SYNTAX_RULES, ...THREE_SYNTAX_RULES],
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
