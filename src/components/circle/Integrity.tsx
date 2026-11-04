import { useMutation, useQuery } from '@tanstack/react-query'
import { CheckCircle2, DatabaseZap, RefreshCw, TriangleAlert } from 'lucide-react'
import { Button, Card, SourceTag, type Source } from '@/components/ui'
import { api, type CircleDetail } from '@/lib/api'
import { relTime, shortAddr, usd } from '@/lib/format'

const SOURCES: [Source, string, string][] = [
  ['ONCHAIN', 'Collateral, net positions, memberships, invoice status, settlement', 'The contract. If anything disagrees, this wins.'],
  ['INDEXED', 'Lists, history, statements', 'Copied from contract events into the database. Resumable and rebuildable.'],
  ['DERIVED', 'Savings, auto-accept rate, close preview', 'Calculated from indexed data.'],
  ['OFFCHAIN', 'Invoice documents', 'Stored privately and checked against the hash onchain.'],
  ['USER', 'Invoice descriptions', 'Typed by the issuer. Nobody verifies the text, only that it has not changed.'],
]

export function Integrity({ data }: { data: CircleDetail }) {
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, refetchInterval: 8000, retry: false })
  const last = useQuery({ queryKey: ['recon', data.circle.id], queryFn: () => api.reconciliation(data.circle.id) })
  const run = useMutation({ mutationFn: () => api.reconcile(data.circle.id), onSuccess: () => void last.refetch() })
  const result = run.data

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <div className="mb-2 flex items-center gap-2">
          <DatabaseZap className="size-4 text-accent" />
          <h2 className="font-display text-lg font-semibold">Check the books against the chain</h2>
        </div>
        <p className="mb-4 text-sm text-muted">
          Reads every member's collateral and net position straight from the contract and compares it with the database behind this app. The chain is always the one that is right.
        </p>
        <Button loading={run.isPending} onClick={() => run.mutate()}>
          <RefreshCw className="size-4" /> Run reconciliation
        </Button>
        {run.error && <p className="mt-3 text-sm text-danger">{run.error.message}</p>}
        {result && (
          <div className="mt-4 space-y-3 text-sm">
            {result.status === 'ok' && (
              <p className="flex items-start gap-2 rounded-lg bg-ok/10 p-3 text-ok">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> All {result.membersChecked} members match the chain at block {result.checkedBlock}.
              </p>
            )}
            {result.status === 'indexer_behind' && (
              <p className="flex items-start gap-2 rounded-lg bg-info/10 p-3 text-info">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" /> The ledger is still catching up with the chain, so a comparison now would be misleading. Try again in a moment.
              </p>
            )}
            {result.status === 'drift' && (
              <div className="rounded-lg bg-danger/10 p-3 text-danger">
                <p className="flex items-start gap-2 font-semibold">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {result.drift.length} difference(s) found. Trust the onchain figures.
                </p>
                <ul className="mt-2 space-y-1 text-xs">
                  {result.drift.map((d) => (
                    <li key={`${d.member}${d.field}`}>
                      {shortAddr(d.member)} {d.field}: database {usd(d.database)} vs chain {usd(d.onchain)}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs">The operator can rebuild the database from the event log with <code>bun run db:rebuild</code>.</p>
              </div>
            )}
            <p className="text-muted">
              Contract custody: holds {result.custody.contractUsdc === null ? 'n/a' : usd(result.custody.contractUsdc)} USDC against {usd(result.custody.totalBalances)} owed to members across all circles
              {result.custody.covered === true ? ' (fully covered).' : result.custody.covered === false ? ' (NOT covered).' : '.'}
            </p>
          </div>
        )}
        {!result && last.data?.latest && (
          <p className="mt-4 text-sm text-muted">
            Last check {relTime(last.data.latest.ran_at)}: {last.data.latest.ok ? 'matched the chain' : 'found differences'} ({last.data.latest.members_checked} members).
          </p>
        )}
      </Card>

      <Card>
        <h2 className="mb-1 font-display text-lg font-semibold">Where each number comes from</h2>
        <p className="mb-4 text-sm text-muted">Every figure in Clearcycle is labelled with its source.</p>
        <ul className="space-y-3">
          {SOURCES.map(([tag, what, how]) => (
            <li key={tag} className="grid grid-cols-[6rem_1fr] gap-3 text-sm">
              <span className="pt-0.5">
                <SourceTag source={tag} />
              </span>
              <span>
                <span className="font-medium">{what}</span>
                <span className="block text-muted">{how}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-5 rounded-lg bg-paper p-3 text-xs text-muted">
          <p className="font-semibold text-ink">Ledger service</p>
          {health.data ? (
            <p>
              {health.data.status === 'ok' ? 'Healthy' : 'Degraded'}. Indexed to block {health.data.indexer?.lastBlock ?? 'n/a'}, {health.data.indexer?.lagBlocks ?? '?'} behind the chain head.
              {health.data.indexer?.lastError ? ` Last error: ${health.data.indexer.lastError}` : ''}
            </p>
          ) : (
            <p>{health.isError ? 'Unreachable.' : 'Checking…'}</p>
          )}
        </div>
      </Card>
    </div>
  )
}
