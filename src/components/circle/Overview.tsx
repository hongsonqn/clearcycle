import { Gauge, Timer, Zap } from 'lucide-react'
import { Button, Card, SourceTag, Stat } from '@/components/ui'
import { useCircleChain } from '@/hooks/chain'
import { useNow } from '@/hooks/now'
import { useTx } from '@/hooks/tx'
import { clearingHouseAbi } from '@/lib/abi'
import type { CircleDetail } from '@/lib/api'
import { CONTRACT } from '@/lib/env'
import { countdown, sameAddr, shortAddr, usd } from '@/lib/format'
import { savingsPct } from '@/lib/netting'
import { useAccount } from 'wagmi'

export function Overview({ data, isMember }: { data: CircleDetail; isMember: boolean }) {
  const { address } = useAccount()
  const { circle, members, closed, open, automation } = data
  const chain = useCircleChain(isMember ? circle.id : undefined)
  const now = useNow()
  const { run, busy } = useTx()

  const endsAt = chain.cycleEnd !== undefined ? Number(chain.cycleEnd) : Number(circle.cycle_start) + circle.cycle_duration
  const left = endsAt - now
  const elapsed = Math.min(1, Math.max(0, 1 - left / circle.cycle_duration))

  const active = members.filter((m) => m.status === 'member')
  const positions = active.map((m) => ({ ...m, netN: BigInt(m.net) }))
  const netVolume = positions.reduce((s, m) => (m.netN > 0n ? s + m.netN : s), 0n)
  const openGross = BigInt(open.gross)
  const lifetimeSaved = savingsPct(BigInt(closed.gross), BigInt(closed.net_volume))
  const autoRate = automation.total > 0 ? Math.round((automation.auto / automation.total) * 100) : 0
  const maxAbs = positions.reduce((m, p) => (p.netN < 0n ? (-p.netN > m ? -p.netN : m) : p.netN > m ? p.netN : m), 1n)

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-6">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.08em] text-muted">
                <Timer className="size-3.5" /> Cycle {circle.current_cycle}
                <SourceTag source="ONCHAIN" />
              </p>
              <p className="num mt-2 font-display text-4xl font-bold">{left > 0 ? countdown(left) : 'Cycle ended'}</p>
              <p className="mt-1 text-sm text-muted">
                {left > 0 ? `Closes ${new Date(endsAt * 1000).toLocaleString()}. New invoices count toward this cycle.` : 'Invoicing is paused until someone closes the cycle. Anyone can.'}
              </p>
            </div>
            {left <= 0 && (
              <Button
                loading={busy}
                onClick={() => {
                  if (!CONTRACT) return
                  void run({
                    kind: 'closeCycle',
                    label: `Close cycle ${circle.current_cycle}`,
                    circleId: circle.id,
                    call: { address: CONTRACT, abi: clearingHouseAbi, functionName: 'closeCycle', args: [BigInt(circle.id)] },
                  })
                }}
              >
                Close cycle and settle
              </Button>
            )}
          </div>
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${elapsed * 100}%` }} />
          </div>
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold">If the cycle closed now</h2>
            <span className="flex items-center gap-1.5">
              <SourceTag source="DERIVED" />
            </span>
          </div>
          <div className="mb-5 grid grid-cols-3 gap-4">
            <Stat label="Invoiced" value={usd(openGross)} sub={`${open.count} accepted`} />
            <Stat label="Would move" value={usd(netVolume)} sub="USDC after netting" tone="ok" />
            <Stat label="Not moved" value={`${savingsPct(openGross, netVolume).toFixed(0)}%`} sub="of invoiced volume" />
          </div>
          {positions.length === 0 ? (
            <p className="text-sm text-muted">No members yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {positions.map((p) => (
                <li key={p.address} className="grid grid-cols-[8rem_1fr_7rem] items-center gap-3 text-sm">
                  <span className={`truncate font-mono text-xs ${sameAddr(p.address, address) ? 'font-semibold text-ink' : 'text-muted'}`}>
                    {sameAddr(p.address, address) ? 'You' : shortAddr(p.address)}
                  </span>
                  <div className="h-2 overflow-hidden rounded-full bg-line/70">
                    <div
                      className={`h-full rounded-full ${p.netN >= 0n ? 'bg-ok' : 'bg-warn'}`}
                      style={{ width: `${Number(((p.netN < 0n ? -p.netN : p.netN) * 100n) / maxAbs)}%` }}
                    />
                  </div>
                  <span className={`num text-right font-semibold ${p.netN > 0n ? 'text-ok' : p.netN < 0n ? 'text-warn' : 'text-muted'}`}>
                    {p.netN > 0n ? 'receives ' : p.netN < 0n ? 'pays ' : ''}
                    {usd(p.netN < 0n ? -p.netN : p.netN)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="space-y-6">
        {isMember && (
          <Card>
            <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.08em] text-muted">
              Your position <SourceTag source="ONCHAIN" />
            </p>
            <div className="mt-3 space-y-4">
              <Stat label="Collateral" value={chain.balance === undefined ? '…' : `${usd(chain.balance)} USDC`} sub="Settled balance in this circle" />
              <Stat
                label="Net this cycle"
                value={chain.net === undefined ? '…' : `${chain.net > 0n ? '+' : ''}${usd(chain.net)}`}
                tone={chain.net === undefined ? undefined : chain.net > 0n ? 'ok' : chain.net < 0n ? 'warn' : undefined}
                sub={chain.net !== undefined && chain.net < 0n ? 'You will pay this when the cycle closes. Your collateral covers it.' : 'Credits become withdrawable when the cycle closes.'}
              />
              <Stat label="Free to withdraw" value={chain.withdrawable === undefined ? '…' : `${usd(chain.withdrawable)} USDC`} />
            </div>
          </Card>
        )}
        <Card>
          <p className="mb-4 text-xs font-medium uppercase tracking-[0.08em] text-muted">Circle performance</p>
          <div className="space-y-4">
            <Stat label="Cycles settled" value={String(closed.cycles)} source="INDEXED" />
            <Stat label="Lifetime volume not moved" value={`${lifetimeSaved.toFixed(0)}%`} sub={`${usd(closed.gross)} invoiced, ${usd(closed.net_volume)} moved`} source="DERIVED" />
            <Stat
              label="Settled without a click"
              value={`${autoRate}%`}
              sub={
                <span className="inline-flex items-center gap-1">
                  <Zap className="size-3" /> {automation.auto} of {automation.total} invoices were auto-accepted within policy
                </span>
              }
              source="DERIVED"
            />
            {open.awaiting > 0 && (
              <Stat label="Awaiting payer" value={String(open.awaiting)} sub="Open this cycle. Raise auto-accept limits to clear them." tone="warn" />
            )}
          </div>
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-paper p-3 text-xs text-muted">
            <Gauge className="mt-0.5 size-3.5 shrink-0" /> A low auto-accept rate means partners are clicking through each invoice. Members can set a per-partner limit in Members & rules.
          </p>
        </Card>
      </div>
    </div>
  )
}
