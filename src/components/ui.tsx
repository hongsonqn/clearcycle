import { Check, Copy, Loader2, X } from 'lucide-react'
import { useEffect, useId, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { toast } from 'sonner'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { shortAddr } from '@/lib/format'
import { CHAIN_ID } from '@/lib/env'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-110 shadow-sm',
  secondary: 'bg-card text-ink border border-line hover:bg-paper',
  ghost: 'text-ink hover:bg-ink/5',
  danger: 'bg-danger/10 text-danger hover:bg-danger/15 border border-danger/20',
}

export function Button({
  variant = 'primary',
  loading,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 ${VARIANTS[variant]} ${className}`}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-line bg-card p-5 shadow-card ${className}`}>{children}</section>
}

export type Source = 'ONCHAIN' | 'INDEXED' | 'OFFCHAIN' | 'DERIVED' | 'SIMULATED' | 'USER'

const SOURCE_STYLE: Record<Source, { cls: string; hint: string }> = {
  ONCHAIN: { cls: 'bg-accent/10 text-accent', hint: 'Read straight from the contract. Canonical.' },
  INDEXED: { cls: 'bg-info/10 text-info', hint: 'Copied from contract events into the database. Rebuildable.' },
  OFFCHAIN: { cls: 'bg-warn/10 text-warn', hint: 'Stored off the chain. Verified against an onchain hash.' },
  DERIVED: { cls: 'bg-ink/5 text-muted', hint: 'Computed from indexed data. Rebuildable.' },
  SIMULATED: { cls: 'bg-ink/10 text-ink', hint: 'An illustration. Not connected to any real funds.' },
  USER: { cls: 'bg-ink/5 text-muted', hint: 'Typed by a user. Not verified.' },
}

export function SourceTag({ source }: { source: Source }) {
  const s = SOURCE_STYLE[source]
  return (
    <span title={s.hint} className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wider ${s.cls}`}>
      {source}
    </span>
  )
}

export function Stat({ label, value, sub, source, tone }: { label: string; value: ReactNode; sub?: ReactNode; source?: Source; tone?: 'ok' | 'warn' | 'danger' }) {
  const color = tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : 'text-ink'
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted">{label}</p>
        {source && <SourceTag source={source} />}
      </div>
      <p className={`num mt-1 truncate font-display text-2xl font-semibold ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'info' }) {
  const map = { neutral: 'bg-ink/5 text-muted', ok: 'bg-ok/10 text-ok', warn: 'bg-warn/10 text-warn', danger: 'bg-danger/10 text-danger', info: 'bg-info/10 text-info' }
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${map[tone]}`}>{children}</span>
}

export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-card p-6 shadow-lift sm:rounded-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id={titleId} className="font-display text-xl font-semibold">
            {title}
          </h2>
          <button onClick={onClose} className="rounded-lg p-2 text-muted hover:bg-paper" aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  )
}

export const inputCls =
  'w-full rounded-lg border border-line bg-paper/60 px-3 py-2.5 text-sm outline-none transition placeholder:text-muted/60 focus:border-accent focus:bg-card'

export function AmountInput({ value, onChange, max, maxLabel }: { value: string; onChange: (v: string) => void; max?: string; maxLabel?: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper/60 p-3 focus-within:border-accent focus-within:bg-card">
      <div className="flex items-baseline gap-2">
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9.]/g, '')
            if (/^\d*\.?\d{0,6}$/.test(v)) onChange(v)
          }}
          placeholder="0.00"
          aria-label="Amount in USDC"
          className="num w-full bg-transparent font-display text-3xl font-semibold outline-none placeholder:text-muted/40"
        />
        <span className="text-sm font-medium text-muted">USDC</span>
      </div>
      {max !== undefined && (
        <button type="button" onClick={() => onChange(max)} className="mt-1 text-xs font-semibold text-accent hover:underline">
          {maxLabel ?? 'Max'}
        </button>
      )}
    </div>
  )
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-paper/40 px-6 py-10 text-center">
      <p className="font-display text-base font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{body}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-ink/5 ${className}`} />
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
      <span>{message}</span>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} className="min-h-8 px-3 text-xs">
          Retry
        </Button>
      )}
    </div>
  )
}

export function Address({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <a
        href={buildAddressExplorerUrl(CHAIN_ID, value)}
        target="_blank"
        rel="noreferrer"
        title={value}
        className="font-mono text-xs hover:underline"
      >
        {label ?? shortAddr(value)}
      </a>
      <button
        type="button"
        aria-label="Copy address"
        className="rounded p-1 text-muted hover:bg-ink/5"
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true)
            toast.success('Address copied')
            setTimeout(() => setCopied(false), 1200)
          })
        }}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </button>
    </span>
  )
}
