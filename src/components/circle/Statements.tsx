import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Download, ExternalLink } from 'lucide-react'
import { useAccount } from 'wagmi'
import { Button, Card, Empty, ErrorNote, Skeleton, SourceTag } from '@/components/ui'
import { api, type CircleDetail, type EventItem } from '@/lib/api'
import { CHAIN_ID } from '@/lib/env'
import { relTime, sameAddr, shortAddr, usd } from '@/lib/format'
import { savingsPct } from '@/lib/netting'
import { buildTxExplorerUrl } from '@/onchain-facts'

function describe(e: EventItem): string {
  const a = e.args
  const who = (k: string): string => shortAddr(String(a[k]))
  switch (e.name) {
    case 'CircleCreated':
      return `Circle created by ${who('admin')}`
    case 'MemberInvited':
      return `${who('member')} was invited`
    case 'InviteRevoked':
      return `Invite for ${who('member')} was revoked`
    case 'MemberJoined':
      return `${who('member')} joined`
    case 'MemberLeft':
      return `${who('member')} left`
    case 'Deposited':
      return `${who('member')} added ${usd(String(a.amount))} USDC collateral`
    case 'Withdrawn':
      return `${who('member')} withdrew ${usd(String(a.amount))} USDC`
    case 'PolicySet':
      return BigInt(String(a.perObligationLimit)) === 0n && BigInt(String(a.perCycleLimit)) === 0n
        ? `${who('payer')} turned off auto-accept for ${who('payee')}`
        : `${who('payer')} will auto-accept up to ${usd(String(a.perObligationLimit))} from ${who('payee')}`
    case 'ObligationProposed':
      return `${who('payee')} invoiced ${who('payer')} ${usd(String(a.amount))} USDC (#${a.obligationId})`
    case 'ObligationAccepted':
      return `${who('payer')} ${a.automatic ? 'auto-accepted' : 'accepted'} invoice #${a.obligationId}`
    case 'ObligationRejected':
      return `${who('payer')} rejected invoice #${a.obligationId}`
    case 'ObligationCancelled':
      return `${who('payee')} withdrew invoice #${a.obligationId}`
    case 'NetSettled':
      return `${who('member')} settled ${BigInt(String(a.net)) >= 0n ? '+' : ''}${usd(String(a.net))} for cycle ${a.cycle}`
    case 'CycleClosed':
      return `Cycle ${a.cycle} closed: ${usd(String(a.grossVolume))} invoiced, ${usd(String(a.netVolume))} moved`
    case 'CirclePaused':
      return a.paused ? 'New activity was paused' : 'New activity was resumed'
    default:
      return e.name
  }
}

export function Statements({ data }: { data: CircleDetail }) {
  const { address } = useAccount()
  const cycles = useQuery({ queryKey: ['cycles', data.circle.id], queryFn: () => api.cycles(data.circle.id), refetchInterval: 8000 })
  const ledger = useInfiniteQuery({
    queryKey: ['events', data.circle.id],
    queryFn: ({ pageParam }) => api.events(data.circle.id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 8000,
  })
  const events = ledger.data?.pages.flatMap((p) => p.items) ?? []
  const myNet = (cycle: string): string | undefined => cycles.data?.positions.find((p) => p.cycle === cycle && sameAddr(p.member, address))?.net

  return (
    <div className="space-y-6">
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-lg font-semibold">Settled cycles</h2>
            <SourceTag source="INDEXED" />
          </div>
          <a href={`/api/circles/${data.circle.id}/statement.csv`} download>
            <Button variant="secondary" className="min-h-9 text-xs">
              <Download className="size-3.5" /> Download invoices (CSV)
            </Button>
          </a>
        </div>
        {cycles.isLoading ? (
          <Skeleton className="h-24" />
        ) : cycles.error ? (
          <ErrorNote message={cycles.error.message} onRetry={() => void cycles.refetch()} />
        ) : !cycles.data || cycles.data.cycles.length === 0 ? (
          <Empty title="No cycle has settled yet" body="Once a cycle ends and is closed, its statement appears here: what was invoiced, what moved, and what each member received or paid." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-[0.08em] text-muted">
                  <th className="pb-2 font-medium">Cycle</th>
                  <th className="pb-2 font-medium">Closed</th>
                  <th className="pb-2 text-right font-medium">Invoices</th>
                  <th className="pb-2 text-right font-medium">Invoiced</th>
                  <th className="pb-2 text-right font-medium">Moved</th>
                  <th className="pb-2 text-right font-medium">Not moved</th>
                  <th className="pb-2 text-right font-medium">Your net</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cycles.data.cycles.map((c) => {
                  const mine = myNet(c.cycle)
                  return (
                    <tr key={c.cycle} className="border-t border-line">
                      <td className="py-3 font-semibold">#{c.cycle}</td>
                      <td className="py-3 text-muted">{relTime(c.closed_at)}</td>
                      <td className="num py-3 text-right">{c.obligation_count}</td>
                      <td className="num py-3 text-right">{usd(c.gross)}</td>
                      <td className="num py-3 text-right">{usd(c.net_volume)}</td>
                      <td className="num py-3 text-right">{savingsPct(BigInt(c.gross), BigInt(c.net_volume)).toFixed(0)}%</td>
                      <td className={`num py-3 text-right font-semibold ${mine && BigInt(mine) > 0n ? 'text-ok' : mine && BigInt(mine) < 0n ? 'text-warn' : 'text-muted'}`}>
                        {mine === undefined ? '-' : `${BigInt(mine) > 0n ? '+' : ''}${usd(mine)}`}
                      </td>
                      <td className="py-3 pl-3">
                        <a href={buildTxExplorerUrl(CHAIN_ID, c.tx_hash)} target="_blank" rel="noreferrer" aria-label="View closing transaction" className="text-muted hover:text-ink">
                          <ExternalLink className="size-3.5" />
                        </a>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-4 flex items-center gap-2">
          <h2 className="font-display text-lg font-semibold">Ledger</h2>
          <SourceTag source="INDEXED" />
        </div>
        {ledger.isLoading ? (
          <Skeleton className="h-24" />
        ) : events.length === 0 ? (
          <p className="text-sm text-muted">Nothing indexed for this circle yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {events.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span>{describe(e)}</span>
                <a href={buildTxExplorerUrl(CHAIN_ID, e.tx_hash)} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-muted hover:text-ink">
                  {relTime(e.block_time)}
                </a>
              </li>
            ))}
          </ul>
        )}
        {ledger.hasNextPage && (
          <div className="mt-3 text-center">
            <Button variant="secondary" loading={ledger.isFetchingNextPage} onClick={() => void ledger.fetchNextPage()}>
              Load older
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}
