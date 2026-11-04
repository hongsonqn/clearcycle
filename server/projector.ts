/**
 * Projects decoded contract events onto the DERIVED tables.
 * Pure SQL, deterministic, and replayable: `rebuildDerived` truncates and replays chain_events.
 */
import type { Tx } from './db'
import { lc, sql } from './db'

export type EventArgs = Record<string, string | boolean | number>

export interface IndexedEvent {
  name: string
  args: EventArgs
  blockNumber: string
  blockTime: Date
  txHash: string
  logIndex: number
}

const str = (args: EventArgs, key: string): string => String(args[key])
const addr = (args: EventArgs, key: string): string => lc(String(args[key]))

export async function applyEvent(tx: Tx, ev: IndexedEvent): Promise<void> {
  const a = ev.args
  const at = ev.blockTime
  switch (ev.name) {
    case 'CircleCreated':
      await tx`
        insert into circles (id, admin, name, cycle_duration, cycle_start, current_cycle, created_block, created_at)
        values (${str(a, 'circleId')}, ${addr(a, 'admin')}, ${str(a, 'name')}, ${Number(a.cycleDuration)},
                ${str(a, 'cycleStart')}, 1, ${ev.blockNumber}, ${at})
        on conflict (id) do nothing`
      await tx`
        insert into members (circle_id, address, status, joined_at)
        values (${str(a, 'circleId')}, ${addr(a, 'admin')}, 'member', ${at})
        on conflict (circle_id, address) do nothing`
      break
    case 'MemberInvited':
      await tx`
        insert into members (circle_id, address, status)
        values (${str(a, 'circleId')}, ${addr(a, 'member')}, 'invited')
        on conflict (circle_id, address) do update set status = 'invited' where members.status = 'left'`
      break
    case 'InviteRevoked':
      await tx`delete from members where circle_id = ${str(a, 'circleId')} and address = ${addr(a, 'member')} and status = 'invited'`
      break
    case 'MemberJoined':
      await tx`
        insert into members (circle_id, address, status, joined_at)
        values (${str(a, 'circleId')}, ${addr(a, 'member')}, 'member', ${at})
        on conflict (circle_id, address) do update set status = 'member', joined_at = ${at}`
      break
    case 'MemberLeft':
      await tx`update members set status = 'left' where circle_id = ${str(a, 'circleId')} and address = ${addr(a, 'member')}`
      break
    case 'Deposited':
      await tx`update members set balance = balance + ${str(a, 'amount')}::numeric where circle_id = ${str(a, 'circleId')} and address = ${addr(a, 'member')}`
      break
    case 'Withdrawn':
      await tx`update members set balance = balance - ${str(a, 'amount')}::numeric where circle_id = ${str(a, 'circleId')} and address = ${addr(a, 'member')}`
      break
    case 'PolicySet':
      await tx`
        insert into policies (circle_id, payer, payee, per_obligation, per_cycle, updated_at)
        values (${str(a, 'circleId')}, ${addr(a, 'payer')}, ${addr(a, 'payee')}, ${str(a, 'perObligationLimit')}::numeric,
                ${str(a, 'perCycleLimit')}::numeric, ${at})
        on conflict (circle_id, payer, payee) do update
          set per_obligation = excluded.per_obligation, per_cycle = excluded.per_cycle, updated_at = excluded.updated_at`
      break
    case 'ObligationProposed':
      await tx`
        insert into obligations (id, circle_id, cycle, payer, payee, amount, ref, status, proposed_tx, proposed_at)
        values (${str(a, 'obligationId')}, ${str(a, 'circleId')}, ${str(a, 'cycle')}, ${addr(a, 'payer')}, ${addr(a, 'payee')},
                ${str(a, 'amount')}::numeric, ${lc(str(a, 'ref'))}, 'proposed', ${ev.txHash}, ${at})
        on conflict (id) do nothing`
      break
    case 'ObligationAccepted': {
      const rows = await tx<{ payer: string; payee: string; amount: string }[]>`
        update obligations
           set status = 'accepted', automatic = ${Boolean(a.automatic)}, resolved_tx = ${ev.txHash}, resolved_at = ${at}
         where id = ${str(a, 'obligationId')} and status = 'proposed'
         returning payer, payee, amount`
      const row = rows[0]
      if (row) {
        await tx`update members set net = net - ${row.amount}::numeric where circle_id = ${str(a, 'circleId')} and address = ${row.payer}`
        await tx`update members set net = net + ${row.amount}::numeric where circle_id = ${str(a, 'circleId')} and address = ${row.payee}`
      }
      break
    }
    case 'ObligationRejected':
      await tx`update obligations set status = 'rejected', resolved_tx = ${ev.txHash}, resolved_at = ${at} where id = ${str(a, 'obligationId')} and status = 'proposed'`
      break
    case 'ObligationCancelled':
      await tx`update obligations set status = 'cancelled', resolved_tx = ${ev.txHash}, resolved_at = ${at} where id = ${str(a, 'obligationId')} and status = 'proposed'`
      break
    case 'NetSettled':
      await tx`update members set balance = balance + ${str(a, 'net')}::numeric, net = 0 where circle_id = ${str(a, 'circleId')} and address = ${addr(a, 'member')}`
      await tx`
        insert into cycle_positions (circle_id, cycle, member, net)
        values (${str(a, 'circleId')}, ${str(a, 'cycle')}, ${addr(a, 'member')}, ${str(a, 'net')}::numeric)
        on conflict (circle_id, cycle, member) do nothing`
      break
    case 'CycleClosed':
      await tx`
        insert into cycles (circle_id, cycle, gross, net_volume, obligation_count, closed_at, tx_hash)
        values (${str(a, 'circleId')}, ${str(a, 'cycle')}, ${str(a, 'grossVolume')}::numeric, ${str(a, 'netVolume')}::numeric,
                ${Number(a.obligationCount)}, ${at}, ${ev.txHash})
        on conflict (circle_id, cycle) do nothing`
      await tx`update circles set current_cycle = ${str(a, 'cycle')}::bigint + 1, cycle_start = ${str(a, 'nextCycleStart')} where id = ${str(a, 'circleId')}`
      break
    case 'CirclePaused':
      await tx`update circles set paused = ${Boolean(a.paused)} where id = ${str(a, 'circleId')}`
      break
    default:
      break
  }
}

interface StoredRow {
  block_number: string
  log_index: number
  name: string
  args: EventArgs
  block_time: Date
  tx_hash: string
}

/** Truncate every DERIVED table and replay chain_events in canonical order. */
export async function rebuildDerived(): Promise<number> {
  return sql.begin(async (tx) => {
    await tx`truncate circles cascade`
    let replayed = 0
    let cursorBlock = '-1'
    let cursorLog = -1
    for (;;) {
      const page = await tx<StoredRow[]>`
        select block_number, log_index, name, args, block_time, tx_hash
          from chain_events
         where (block_number, log_index) > (${cursorBlock}::bigint, ${cursorLog})
         order by block_number, log_index
         limit 1000`
      if (page.length === 0) break
      for (const row of page) {
        await applyEvent(tx, {
          name: row.name,
          args: row.args,
          blockNumber: row.block_number,
          blockTime: row.block_time,
          txHash: row.tx_hash,
          logIndex: row.log_index,
        })
        replayed += 1
      }
      const last = page[page.length - 1]
      if (!last) break
      cursorBlock = last.block_number
      cursorLog = last.log_index
    }
    return replayed
  })
}
