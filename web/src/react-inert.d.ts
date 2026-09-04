/**
 * `inert` is a standard HTML attribute that React 18's types do not know about — React 19 added
 * it as a boolean prop, and `@types/react@18` predates that.
 *
 * Typed as `''` rather than `boolean` because that is what React 18 actually renders: it treats
 * unknown attributes as strings, so `inert={true}` emits `inert="true"` with a console warning
 * while `inert=""` emits the bare attribute the spec asks for. Omit the prop to clear it.
 *
 * Used by `ui/Drawer.tsx` to take the collapsed panel out of the tab order (PRD 7.5.2). Delete
 * this file when the project moves to React 19.
 */

import 'react'

declare module 'react' {
  interface HTMLAttributes<T> {
    inert?: ''
  }
}
