import { useQuery } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { useAccount } from 'wagmi'
import { Integrity } from '@/components/circle/Integrity'
import { Invoices } from '@/components/circle/Invoices'
import { Members } from '@/components/circle/Members'
import { Overview } from '@/components/circle/Overview'
import { Statements } from '@/components/circle/Statements'
import { Treasury } from '@/components/circle/Treasury'
import { Badge, ErrorNote, Skeleton } from '@/components/ui'
import { ConnectButton } from '@/components/Shell'
import { api } from '@/lib/api'
import { durationLabel, sameAddr } from '@/lib/format'
import { Link, navigate, usePath, useSearch } from '@/lib/router'

const TABS = [
  ['overview', 'Overview'],
  ['invoices', 'Invoices'],
  ['treasury', 'Collateral'],
  ['members', 'Members & rules'],
  ['statements', 'Statements'],
  ['integrity', 'Integrity'],
] as const

export type TabId = (typeof TABS)[number][0]

export function CircleView({ id }: { id: string }) {
  const { address, isConnected } = useAccount()
  const path = usePath()
  const search = useSearch()
  const tab = (new URLSearchParams(search).get('tab') ?? 'overview') as TabId
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['circle', id],
    queryFn: () => api.circle(id),
    refetchInterval: 5000,
    retry: (count, e) => count < 3 && !(e instanceof Error && /not found/i.test(e.message)),
  })

  if (isLoading) return <Skeleton className="h-64" />
  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link to="/app" className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink">
          <ArrowLeft className="size-4" /> Workspace
        </Link>
        <ErrorNote message={error?.message ?? 'Circle not found'} onRetry={() => void refetch()} />
      </div>
    )
  }
  const { circle, members } = data
  const me = members.find((m) => sameAddr(m.address, address))
  const isMember = me?.status === 'member'
  const isAdmin = sameAddr(circle.admin, address)

  return (
    <div className="space-y-6">
      <div>
        <Link to="/app" className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-ink">
          <ArrowLeft className="size-4" /> Workspace
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl font-bold tracking-tight">{circle.name}</h1>
          <Badge tone="neutral">Circle #{circle.id}</Badge>
          <Badge tone="info">{durationLabel(circle.cycle_duration)} cycles</Badge>
          {circle.paused && <Badge tone="warn">New activity paused</Badge>}
          {isAdmin && <Badge tone="ok">You are admin</Badge>}
        </div>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-b border-line" aria-label="Circle sections">
        {TABS.map(([t, label]) => (
          <button
            key={t}
            onClick={() => navigate(`${path}?tab=${t}`)}
            aria-current={tab === t ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition ${tab === t ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink'}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {!isConnected ? (
        <div className="flex items-center justify-between rounded-xl border border-line bg-card p-4">
          <p className="text-sm text-muted">Connect your wallet to act in this circle. You can still read it.</p>
          <ConnectButton />
        </div>
      ) : !isMember ? (
        <div className="rounded-xl border border-warn/30 bg-warn/10 p-4 text-sm text-warn">
          {me?.status === 'invited' ? 'You are invited to this circle. Join it from your workspace to take part.' : 'You are viewing this circle read-only. Only invited members can act in it.'}
        </div>
      ) : null}

      {tab === 'overview' && <Overview data={data} isMember={isMember} />}
      {tab === 'invoices' && <Invoices data={data} isMember={isMember} />}
      {tab === 'treasury' && <Treasury data={data} isMember={isMember} />}
      {tab === 'members' && <Members data={data} isMember={isMember} isAdmin={isAdmin} />}
      {tab === 'statements' && <Statements data={data} />}
      {tab === 'integrity' && <Integrity data={data} />}
    </div>
  )
}
