import { useQuery } from '@tanstack/react-query'
import { Bell, CheckCircle2, Clock, Inbox as InboxIcon, Plus, Users } from 'lucide-react'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { ConnectButton } from '@/components/Shell'
import { Badge, Button, Card, Empty, ErrorNote, Field, Modal, Skeleton, SourceTag, inputCls } from '@/components/ui'
import { useNow } from '@/hooks/now'
import { useTx } from '@/hooks/tx'
import { clearingHouseAbi } from '@/lib/abi'
import { api, type CircleSummary } from '@/lib/api'
import { CONTRACT } from '@/lib/env'
import { durationLabel, relTime, shortAddr, usd } from '@/lib/format'
import { Link } from '@/lib/router'

const DURATIONS = [
  { label: '1 hour (try it)', value: 3600 },
  { label: '1 day', value: 86400 },
  { label: '7 days', value: 7 * 86400 },
  { label: '14 days', value: 14 * 86400 },
  { label: '30 days', value: 30 * 86400 },
]

function NewCircle({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const [duration, setDuration] = useState(DURATIONS[2]?.value ?? 604800)
  const { run, busy } = useTx()
  const valid = name.trim().length >= 2 && name.trim().length <= 60
  return (
    <Modal open={open} title="Start a netting circle" onClose={onClose}>
      <div className="space-y-4">
        <Field label="Circle name" hint="Visible to everyone you invite. Example: Q4 suppliers">
          <input className={inputCls} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Q4 suppliers" />
        </Field>
        <Field label="Cycle length" hint="At the end of each cycle the net positions settle. You can try a 1-hour cycle first.">
          <select className={inputCls} value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {DURATIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </Field>
        <p className="rounded-lg bg-paper p-3 text-xs text-muted">
          You become the circle admin: you can invite members and pause new activity. You can never move anyone's funds.
        </p>
        <Button
          className="w-full"
          disabled={!valid || !CONTRACT}
          loading={busy}
          onClick={() => {
            if (!CONTRACT) return
            void run({
              kind: 'createCircle',
              label: `Create circle "${name.trim()}"`,
              params: { name: name.trim(), cycleDuration: duration },
              call: { address: CONTRACT, abi: clearingHouseAbi, functionName: 'createCircle', args: [name.trim(), duration] },
            }).then((ok) => {
              if (ok) {
                setName('')
                onClose()
              }
            })
          }}
        >
          Create circle
        </Button>
      </div>
    </Modal>
  )
}

function CircleCard({ c }: { c: CircleSummary }) {
  const { run, busy } = useTx()
  const now = useNow(15000)
  const overdue = Number(c.cycle_start) + c.cycle_duration <= now
  if (c.my_status === 'invited') {
    return (
      <Card className="flex items-center justify-between gap-4">
        <div>
          <p className="font-display text-lg font-semibold">{c.name}</p>
          <p className="text-sm text-muted">Invited by {shortAddr(c.admin)}. Joining lets partners invoice you here.</p>
        </div>
        <Button
          loading={busy}
          onClick={() => {
            if (!CONTRACT) return
            void run({
              kind: 'join',
              label: `Join "${c.name}"`,
              circleId: c.id,
              call: { address: CONTRACT, abi: clearingHouseAbi, functionName: 'join', args: [BigInt(c.id)] },
            })
          }}
        >
          Join circle
        </Button>
      </Card>
    )
  }
  return (
    <Link to={`/app/circles/${c.id}`} className="block rounded-2xl focus-visible:outline-offset-4">
      <Card className="transition hover:-translate-y-0.5 hover:shadow-lift">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold">{c.name}</p>
            <p className="mt-0.5 flex items-center gap-3 text-xs text-muted">
              <span className="inline-flex items-center gap-1">
                <Users className="size-3.5" /> {c.member_count}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3.5" /> {durationLabel(c.cycle_duration)} cycles
              </span>
            </p>
          </div>
          {c.paused ? <Badge tone="warn">Paused</Badge> : overdue ? <Badge tone="info">Ready to close</Badge> : <Badge tone="ok">Cycle {c.current_cycle} open</Badge>}
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Collateral</p>
            <p className="num font-display text-lg font-semibold">{usd(c.my_balance)}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Net this cycle</p>
            <p className={`num font-display text-lg font-semibold ${BigInt(c.my_net) < 0n ? 'text-warn' : BigInt(c.my_net) > 0n ? 'text-ok' : ''}`}>
              {BigInt(c.my_net) > 0n ? '+' : ''}
              {usd(c.my_net)}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Invoiced</p>
            <p className="num font-display text-lg font-semibold">{usd(c.open_gross)}</p>
          </div>
        </div>
      </Card>
    </Link>
  )
}

function InboxPanel({ address }: { address: string }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['inbox', address], queryFn: () => api.inbox(address), refetchInterval: 6000 })
  if (isLoading) return <Skeleton className="h-40" />
  if (error) return <ErrorNote message={error.message} onRetry={() => void refetch()} />
  if (!data) return null
  const items = [
    ...data.toReview.map((o) => ({
      key: `r${o.id}`,
      to: `/app/circles/${o.circle_id}?tab=invoices`,
      title: `${shortAddr(o.payee)} invoiced you ${usd(o.amount)} USDC`,
      sub: `${o.circle_name}. Review and accept or reject.`,
      tone: 'warn' as const,
    })),
    ...data.invites.map((i) => ({
      key: `i${i.circle_id}`,
      to: '/app',
      title: `You were invited to "${i.name}"`,
      sub: 'Join from the circle card below.',
      tone: 'info' as const,
    })),
    ...data.closable.map((c) => ({
      key: `c${c.circle_id}`,
      to: `/app/circles/${c.circle_id}`,
      title: `"${c.name}" is ready to close`,
      sub: 'The cycle has ended. Anyone can close it and settle the nets.',
      tone: 'info' as const,
    })),
    ...data.awaitingPayer.map((o) => ({
      key: `a${o.id}`,
      to: `/app/circles/${o.circle_id}?tab=invoices`,
      title: `Waiting on ${shortAddr(o.payer)} to accept ${usd(o.amount)} USDC`,
      sub: o.circle_name,
      tone: 'neutral' as const,
    })),
  ]
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
          <Bell className="size-4 text-accent" /> Needs your attention
        </h2>
        <SourceTag source="DERIVED" />
      </div>
      {items.length === 0 ? (
        <p className="flex items-center gap-2 py-4 text-sm text-muted">
          <CheckCircle2 className="size-4 text-ok" /> Nothing waiting on you.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((it) => (
            <li key={it.key}>
              <Link to={it.to} className="flex items-center justify-between gap-3 py-3 hover:bg-paper/60">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{it.title}</span>
                  <span className="block truncate text-xs text-muted">{it.sub}</span>
                </span>
                <Badge tone={it.tone}>{it.tone === 'warn' ? 'Action' : it.tone === 'info' ? 'Open' : 'Pending'}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {data.settled.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.08em] text-muted">Recently settled for you</p>
          <ul className="space-y-1 text-sm">
            {data.settled.slice(0, 3).map((s) => (
              <li key={`${s.circle_id}-${s.cycle}`} className="flex justify-between">
                <span>
                  {s.circle_name} <span className="text-muted">cycle {s.cycle}, {relTime(s.closed_at)}</span>
                </span>
                <span className={`num font-semibold ${BigInt(s.net) >= 0n ? 'text-ok' : 'text-warn'}`}>
                  {BigInt(s.net) >= 0n ? '+' : ''}
                  {usd(s.net)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

export function Workspace() {
  const { address, isConnected } = useAccount()
  const [creating, setCreating] = useState(false)
  const circles = useQuery({
    queryKey: ['circles', address],
    queryFn: () => api.circlesFor(address as string),
    enabled: !!address,
    refetchInterval: 6000,
  })

  if (!CONTRACT) return <ErrorNote message="The Clearcycle contract address is not configured (VITE_CLEARCYCLE_ADDRESS)." />
  if (!isConnected || !address) {
    return (
      <div className="mx-auto max-w-xl pt-8">
        <Empty
          title="Connect a wallet to open your workspace"
          body="Your circles, invoices and settlements are tied to your wallet address. Clearcycle never asks for your keys."
          action={<ConnectButton />}
        />
      </div>
    )
  }
  const items = circles.data?.items ?? []
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Workspace</h1>
          <p className="text-sm text-muted">Every circle you belong to, and what needs you.</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" /> New circle
        </Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-lg font-semibold">Your circles</h2>
            <SourceTag source="INDEXED" />
          </div>
          {circles.isLoading ? (
            <Skeleton className="h-40" />
          ) : circles.error ? (
            <ErrorNote message={circles.error.message} onRetry={() => void circles.refetch()} />
          ) : items.length === 0 ? (
            <Empty
              title="No circles yet"
              body="A circle is a group of companies that invoice each other. Start one, invite your counterparties by wallet address, and the first cycle begins immediately."
              action={<Button onClick={() => setCreating(true)}>Start your first circle</Button>}
            />
          ) : (
            items.map((c) => <CircleCard key={c.id} c={c} />)
          )}
        </div>
        <aside>
          <InboxPanel address={address} />
          <p className="mt-3 flex items-center gap-2 px-1 text-xs text-muted">
            <InboxIcon className="size-3.5" /> Updates arrive a moment after each transaction is indexed.
          </p>
        </aside>
      </div>
      <NewCircle open={creating} onClose={() => setCreating(false)} />
    </div>
  )
}
