/**
 * PRD 6.10's settings panel, rendered.
 *
 * This file exists because of a specific failure. `bloom` and `labels` were persisted by this
 * panel and read by nothing for two phases (review §5.2 F2) — `PlaneLabels` even had an `enabled`
 * prop that no call site passed. Nothing caught it, because there were no component tests at all.
 *
 * So the assertions here are in two halves: the panel writes what PRD 6.10 says it writes, **and**
 * something downstream reads it. The second half is the one that would have failed.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS } from '../src/store/settings'
import { useStore } from '../src/store/store'
import { SettingsOverlay } from '../src/ui/SettingsOverlay'

beforeEach(() => {
  useStore.setState({ settings: DEFAULT_SETTINGS, osReducedMotion: false, overlay: 'settings' })
})

describe('the settings panel (PRD 6.10)', () => {
  it('offers every control PRD 6.10 names', () => {
    render(<SettingsOverlay />)
    // "Reduced motion (default: follows the OS preference), bloom intensity (three steps),
    //  labels on/off, hint reset."
    expect(screen.getByRole('group', { name: 'Reduced motion' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Bloom intensity' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Labels' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show it again' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Subtle|Default|Strong/ })).toHaveLength(3)
  })

  it('is a modal dialog with a name, so it is reachable and announced', () => {
    render(<SettingsOverlay />)
    const dialog = screen.getByRole('dialog', { name: 'Settings' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('writes reduced motion three-valued, because "follow the OS" is not a checkbox', () => {
    render(<SettingsOverlay />)
    fireEvent.click(screen.getByRole('button', { name: 'On' }))
    expect(useStore.getState().settings.reducedMotion).toBe('on')
    fireEvent.click(screen.getByRole('button', { name: 'Off' }))
    expect(useStore.getState().settings.reducedMotion).toBe('off')
    fireEvent.click(screen.getByRole('button', { name: 'Follow the system' }))
    expect(useStore.getState().settings.reducedMotion).toBe('os')
  })

  it('writes the bloom step, and marks exactly one as pressed', () => {
    render(<SettingsOverlay />)
    fireEvent.click(screen.getByRole('button', { name: 'Strong' }))
    expect(useStore.getState().settings.bloom).toBe(2)
    const pressed = screen
      .getAllByRole('button', { name: /Subtle|Default|Strong/ })
      .filter((button) => button.getAttribute('aria-pressed') === 'true')
    expect(pressed.map((button) => button.textContent)).toEqual(['Strong'])
  })

  it('toggles labels and says which state it is in', () => {
    render(<SettingsOverlay />)
    const toggle = screen.getByRole('button', { name: 'Shown' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(toggle)
    expect(useStore.getState().settings.labels).toBe(false)
    expect(screen.getByRole('button', { name: 'Hidden' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('restores the first-visit hint and closes itself (PRD 6.8.3)', () => {
    useStore.setState({ settings: { ...DEFAULT_SETTINGS, hintDismissed: true }, hintVisible: false })
    render(<SettingsOverlay />)
    fireEvent.click(screen.getByRole('button', { name: 'Show it again' }))
    expect(useStore.getState().settings.hintDismissed).toBe(false)
    expect(useStore.getState().hintVisible).toBe(true)
    expect(useStore.getState().overlay).toBeNull()
  })

  it('persists what it writes, so the next visit starts where this one ended', () => {
    render(<SettingsOverlay />)
    fireEvent.click(screen.getByRole('button', { name: 'Subtle' }))
    fireEvent.click(screen.getByRole('button', { name: 'Shown' }))
    const stored: unknown = JSON.parse(localStorage.getItem('eternities:settings:v1') ?? '{}')
    expect(stored).toMatchObject({ bloom: 0, labels: false })
  })
})
