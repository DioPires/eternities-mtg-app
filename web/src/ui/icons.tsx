/**
 * PRD 6.3.3's control cluster is "icon buttons with tooltips", so the icons are inline SVG:
 * self-hosted by construction (PRD 7.6.1 forbids a third-party asset CDN) and styleable by
 * `currentColor`, which is what Phase 5's design pass will want.
 *
 * Every icon is `aria-hidden`: the accessible name lives on the button (PRD 7.5.2), never on the
 * decoration inside it.
 */

import type { ReactElement } from 'react'

interface IconProps {
  readonly size?: number
}

function svg(path: ReactElement, size: number): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {path}
    </svg>
  )
}

export function SearchIcon({ size = 18 }: IconProps): ReactElement {
  return svg(
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>,
    size,
  )
}

export function PlaneIndexIcon({ size = 18 }: IconProps): ReactElement {
  return svg(
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </>,
    size,
  )
}

export function RandomIcon({ size = 18 }: IconProps): ReactElement {
  return svg(
    <>
      <path d="M3 7h4l4 10h6" />
      <path d="M3 17h4l2-5" />
      <path d="m17 4 3 3-3 3" />
      <path d="m17 14 3 3-3 3" />
    </>,
    size,
  )
}

export function ShareIcon({ size = 18 }: IconProps): ReactElement {
  return svg(
    <>
      <path d="M10 14 20 4" />
      <path d="M20 4v6M20 4h-6" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </>,
    size,
  )
}

export function SettingsIcon({ size = 18 }: IconProps): ReactElement {
  return svg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" />
    </>,
    size,
  )
}

export function HelpIcon({ size = 18 }: IconProps): ReactElement {
  return svg(
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.2 2.4c-.6.2-.9.7-.9 1.3v.4" />
      <path d="M12 16.6h.01" />
    </>,
    size,
  )
}

export function FilterIcon({ size = 16 }: IconProps): ReactElement {
  return svg(
    <>
      <path d="M4 6h16l-6.2 7v5.4l-3.6 1.8V13z" />
    </>,
    size,
  )
}

export function CloseIcon({ size = 16 }: IconProps): ReactElement {
  return svg(<path d="m6 6 12 12M18 6 6 18" />, size)
}

export function ChevronIcon({ size = 16 }: IconProps): ReactElement {
  return svg(<path d="m9 5 7 7-7 7" />, size)
}
