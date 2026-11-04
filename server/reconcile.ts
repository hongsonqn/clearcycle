/**
 * Reconciliation: compares the DERIVED balances held in PostgreSQL with canonical contract state.
 * ONCHAIN wins. A mismatch is reported (never silently "fixed") and `bun run db:rebuild` repairs
 * derived data from chain_events.
 */
import { client, contractRef, readUsdcBalanceOfContract } from './chain'
import { sql } from './db'
import { indexerStatus } from './indexer'

export interface Drift {
  member: string
  field: 'balance' | 'net'
  database: string
  onchain: string
}

export interface ReconciliationResult {
  status: 'ok' | 'drift' | 'indexer_behind'
  checkedBlock: string
  membersChecked: number
  drift: Drift[]
  custody: { contractUsdc: string | null; totalBalances: string; covered: boolean | null }
  ranAt: string
}

async function inChunks<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))))
  }
  return out
}

export async function reconcileCircle(circleId: string): Promise<ReconciliationResult> {
  const members = await sql<{ address: string; balance: string; net: string }[]>`
    select address, balance::text, net::text from members where circle_id = ${circleId}::bigint and status = 'member'`
  const before = await indexerStatus()
  const head = await client.getBlockNumber({ cacheTime: 0 })
  const ranAt = new Date().toISOString()
  const checkedBlock = before?.lastBlock ?? '0'

  const [totalBalances, contractUsdc] = await Promise.all([
    client.readContract({ ...contractRef, functionName: 'totalBalances' }),
    readUsdcBalanceOfContract(),
  ])
  const custody = {
    contractUsdc: contractUsdc === undefined ? null : contractUsdc.toString(),
    totalBalances: totalBalances.toString(),
    covered: contractUsdc === undefined ? null : contractUsdc >= totalBalances,
  }

  // The index must be caught up, otherwise a difference is just lag and not drift.
  if (!before || head - BigInt(before.lastBlock) > 2n) {
    return { status: 'indexer_behind', checkedBlock, membersChecked: 0, drift: [], custody, ranAt }
  }

  const id = BigInt(circleId)
  const drift: Drift[] = []
  await inChunks(members, 8, async (m) => {
    const address = m.address as `0x${string}`
    const [balance, net] = await Promise.all([
      client.readContract({ ...contractRef, functionName: 'balanceOf', args: [id, address] }),
      client.readContract({ ...contractRef, functionName: 'netPositionOf', args: [id, address] }),
    ])
    if (balance.toString() !== m.balance) drift.push({ member: m.address, field: 'balance', database: m.balance, onchain: balance.toString() })
    if (net.toString() !== m.net) drift.push({ member: m.address, field: 'net', database: m.net, onchain: net.toString() })
  })

  // Events indexed while we were reading mean the comparison raced the indexer: report as behind.
  const after = await indexerStatus()
  if (after && after.lastBlock !== before.lastBlock && drift.length > 0) {
    return { status: 'indexer_behind', checkedBlock, membersChecked: members.length, drift: [], custody, ranAt }
  }

  const ok = drift.length === 0
  await sql`
    insert into reconciliation_runs (circle_id, checked_block, ok, members_checked, drift)
    values (${circleId}::bigint, ${checkedBlock}::bigint, ${ok}, ${members.length}, ${sql.json(drift as unknown as Record<string, string>[])})`
  return { status: ok ? 'ok' : 'drift', checkedBlock, membersChecked: members.length, drift, custody, ranAt }
}

export async function latestReconciliation(circleId: string) {
  const rows = await sql<{ ok: boolean; checked_block: string; members_checked: number; drift: Drift[]; ran_at: Date }[]>`
    select ok, checked_block, members_checked, drift, ran_at from reconciliation_runs
     where circle_id = ${circleId}::bigint order by ran_at desc limit 1`
  return rows[0] ?? null
}
