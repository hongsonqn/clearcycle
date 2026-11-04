/** Minimal History-API router. Path-based so every page can be a first load. */
import { useSyncExternalStore, type MouseEvent, type ReactNode } from 'react'

const EVENT = 'clearcycle:navigate'

function subscribe(cb: () => void): () => void {
  window.addEventListener('popstate', cb)
  window.addEventListener(EVENT, cb)
  return () => {
    window.removeEventListener('popstate', cb)
    window.removeEventListener(EVENT, cb)
  }
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname)
}

export function useSearch(): string {
  return useSyncExternalStore(subscribe, () => window.location.search)
}

export function navigate(to: string): void {
  if (to === window.location.pathname + window.location.search) return
  window.history.pushState({}, '', to)
  window.dispatchEvent(new Event(EVENT))
  window.scrollTo({ top: 0 })
}

export function Link({ to, children, className, onClick }: { to: string; children: ReactNode; className?: string; onClick?: () => void }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>): void => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    onClick?.()
    navigate(to)
  }
  return (
    <a href={to} onClick={handle} className={className}>
      {children}
    </a>
  )
}

export function matchCircle(path: string): string | null {
  const m = /^\/app\/circles\/(\d+)\/?$/.exec(path)
  return m?.[1] ?? null
}
