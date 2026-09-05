/**
 * PRD 7.4.1's non-blocking report surface, shared with PRD 6.7.4's share confirmation and PRD
 * risk 9's dead-link notice.
 *
 * "Non-blocking" is the requirement and it drives the markup: `aria-live="polite"` rather than a
 * dialog, no scrim, no focus trap, and pointer events only on the dismiss button — a failed data
 * chunk must not stand between the user and the multiverse that did load.
 *
 * A data failure has `timeoutMs: null` and stays until dismissed; a confirmation fades. That
 * asymmetry is deliberate: PRD 7.4.1 wants the failure *reported*, and a report the user blinked
 * past was not one.
 */

import { useEffect, type ReactElement } from 'react'

import { useStore, type Toast } from '../store/store'
import { CloseIcon } from './icons'

function ToastRow({ toast }: { readonly toast: Toast }): ReactElement {
  const dismissToast = useStore((state) => state.dismissToast)

  useEffect(() => {
    if (toast.timeoutMs === null) return
    const timer = setTimeout(() => {
      dismissToast(toast.id)
    }, toast.timeoutMs)
    return () => {
      clearTimeout(timer)
    }
  }, [toast.id, toast.timeoutMs, dismissToast])

  return (
    <li className={toast.tone === 'error' ? 'toast toast-error' : 'toast'}>
      <span>{toast.message}</span>
      <button
        type="button"
        className="toast-close"
        onClick={() => {
          dismissToast(toast.id)
        }}
        aria-label="Dismiss"
      >
        <CloseIcon size={12} />
      </button>
    </li>
  )
}

export function Toasts(): ReactElement | null {
  const toasts = useStore((state) => state.toasts)
  if (toasts.length === 0) return null
  return (
    <ul className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <ToastRow key={toast.id} toast={toast} />
      ))}
    </ul>
  )
}
