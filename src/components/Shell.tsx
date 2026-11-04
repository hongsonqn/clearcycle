import { useQuery } from '@tanstack/react-query'
import { ConnectKitButton } from 'connectkit'
import { AlertTriangle, HelpCircle, LayoutGrid, Settings, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'
import { useAccount, useSwitchChain } from 'wagmi'
import { api } from '@/lib/api'
import { CHAIN_ID } from '@/lib/env'
import { Link, usePath } from '@/lib/router'
import { Button } from '@/components/ui'

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display text-lg font-bold tracking-tight ${className}`}>
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden>
        <rect x="1" y="1" width="24" height="24" rx="7" fill="rgb(var(--ink))" />
        <path d="M6 9h8m0 0-2.5-2.5M14 9l-2.5 2.5M20 17h-8m0 0 2.5-2.5M12 17l2.5 2.5" stroke="rgb(var(--paper))" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="19.5" cy="9" r="1.7" fill="rgb(var(--accent))" />
      </svg>
      Clearcycle
    </span>
  )
}

export function ConnectButton({ variant = 'primary' }: { variant?: 'primary' | 'secondary' }) {
  return (
    <ConnectKitButton.Custom>
      {({ isConnected, show, truncatedAddress, isConnecting }) => (
        <Button variant={isConnected ? 'secondary' : variant} onClick={show} loading={isConnecting}>
          <Wallet className="size-4" />
          {isConnected ? truncatedAddress : 'Connect wallet'}
        </Button>
      )}
    </ConnectKitButton.Custom>
  )
}

function NetworkGuard() {
  const { isConnected, chainId } = useAccount()
  const { switchChain, isPending } = useSwitchChain()
  if (!isConnected || chainId === CHAIN_ID) return null
  return (
    <div className="border-b border-warn/30 bg-warn/10">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2 text-sm text-warn sm:px-6">
        <span className="flex items-center gap-2">
          <AlertTriangle className="size-4" /> Your wallet is on the wrong network. Clearcycle runs on Arc Testnet.
        </span>
        <Button variant="secondary" loading={isPending} onClick={() => switchChain({ chainId: CHAIN_ID })} className="min-h-8 px-3 text-xs">
          Switch to Arc Testnet
        </Button>
      </div>
    </div>
  )
}

function HealthBanner() {
  const { data, isError } = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 8000, retry: false })
  if (!isError && (!data || data.status === 'ok')) return null
  const lag = data?.indexer?.lagBlocks
  const msg = isError
    ? 'The ledger service is unreachable. Balances below your wallet name may be out of date. Onchain actions still work.'
    : !data?.rpc.reachable
      ? 'The Arc RPC is not responding. The ledger is paused until it recovers.'
      : `The ledger is catching up${lag ? ` (${lag} blocks behind)` : ''}. Lists may lag your latest action.`
  return (
    <div className="border-b border-info/30 bg-info/10">
      <div className="mx-auto max-w-7xl px-4 py-2 text-sm text-info sm:px-6" role="status">
        {msg}
      </div>
    </div>
  )
}

const NAV = [
  { to: '/app', label: 'Workspace', icon: LayoutGrid },
  { to: '/app/settings', label: 'Settings', icon: Settings },
  { to: '/help', label: 'Help', icon: HelpCircle },
]

export function Shell({ children }: { children: ReactNode }) {
  const path = usePath()
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-8">
            <Link to="/" className="rounded-lg">
              <Logo />
            </Link>
            <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
              {NAV.map((n) => {
                const active = n.to === '/app' ? path === '/app' || path.startsWith('/app/circles') : path === n.to
                return (
                  <Link
                    key={n.to}
                    to={n.to}
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${active ? 'bg-ink text-paper' : 'text-muted hover:bg-ink/5 hover:text-ink'}`}
                  >
                    <n.icon className="size-4" />
                    {n.label}
                  </Link>
                )
              })}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-muted sm:inline">Arc Testnet</span>
            <ConnectButton />
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-line px-3 py-2 md:hidden" aria-label="Main mobile">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className={`rounded-lg px-3 py-1.5 text-sm font-medium ${path === n.to ? 'bg-ink text-paper' : 'text-muted'}`}>
              {n.label}
            </Link>
          ))}
        </nav>
      </header>
      <NetworkGuard />
      <HealthBanner />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
      <footer className="mx-auto max-w-7xl px-4 pb-24 pt-6 text-xs text-muted sm:px-6">
        Clearcycle runs on Arc Testnet with test USDC. Nothing here moves real funds.
      </footer>
    </div>
  )
}
