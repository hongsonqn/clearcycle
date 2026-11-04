/** Read models over the INDEXED / DERIVED tables. All queries are bounded and keyset-paginated. */
import { lc, sql } from './db'

export interface CircleRow {
  id: string
  admin: string
  name: string
  cycle_duration: number
  cycle_start: string
  current_cycle: string
  paused: boolean
  created_at: Date
}

export interface MemberRow {
  address: string
  status: 'invited' | 'member' | 'left'
  balance: string
  net: string
}

const MAX_LIMIT = 100
const clampLimit = (n: number | undefined, fallback = 25): number => Math.max(1, Math.min(n ?? fallback, MAX_LIMIT))

export async function circlesForAddress(address: string) {
  return sql<
    (CircleRow & { my_status: string; my_balance: string; my_net: string; member_count: number; open_gross: string })[]
  >`
    select c.id, c.admin, c.name, c.cycle_duration, c.cycle_start, c.current_cycle, c.paused, c.created_at,
           m.status as my_status, m.balance as my_balance, m.net as my_net,
           (select count(*)::int from members x where x.circle_id = c.id and x.status = 'member') as member_count,
           coalesce((select sum(o.amount) from obligations o
                      where o.circle_id = c.id and o.cycle = c.current_cycle and o.status = 'accepted'), 0)::text as open_gross
      from members m
      join circles c on c.id = m.circle_id
     where m.address = ${lc(address)} and m.status in ('member', 'invited')
     order by c.id desc
     limit 100`
}

export async function circleDetail(id: string) {
  const circles = await sql<CircleRow[]>`select * from circles where id = ${id}::bigint`
  const circle = circles[0]
  if (!circle) return null
  const members = await sql<MemberRow[]>`
    select address, status, balance::text, net::text from members
     where circle_id = ${id}::bigint and status in ('member', 'invited') order by status, address`
  const totals = await sql<{ cycles: number; gross: string; net_volume: string; obligations: number }[]>`
    select count(*)::int as cycles, coalesce(sum(gross), 0)::text as gross,
           coalesce(sum(net_volume), 0)::text as net_volume, coalesce(sum(obligation_count), 0)::int as obligations
      from cycles where circle_id = ${id}::bigint`
  const open = await sql<{ gross: string; count: number; auto: number }[]>`
    select coalesce(sum(amount), 0)::text as gross, count(*)::int as count,
           count(*) filter (where automatic)::int as auto
      from obligations
     where circle_id = ${id}::bigint and cycle = ${circle.current_cycle}::bigint and status = 'accepted'`
  const awaiting = await sql<{ n: number }[]>`
    select count(*)::int as n from obligations
     where circle_id = ${id}::bigint and cycle = ${circle.current_cycle}::bigint and status = 'proposed'`
  const automation = await sql<{ auto: number; total: number }[]>`
    select count(*) filter (where automatic)::int as auto, count(*)::int as total
      from obligations where circle_id = ${id}::bigint and status = 'accepted'`
  return {
    circle,
    members,
    closed: totals[0],
    open: { ...open[0], awaiting: awaiting[0]?.n ?? 0 },
    automation: automation[0],
  }
}

export async function listObligations(
  circleId: string,
  opts: { status?: string; address?: string; cursor?: string; limit?: number },
) {
  const limit = clampLimit(opts.limit)
  const address = opts.address ? lc(opts.address) : null
  const status = opts.status && ['proposed', 'accepted', 'rejected', 'cancelled'].includes(opts.status) ? opts.status : null
  const expiredOnly = opts.status === 'expired'
  const rows = await sql<
    {
      id: string
      cycle: string
      payer: string
      payee: string
      amount: string
      ref: string
      status: string
      automatic: boolean
      proposed_tx: string
      resolved_tx: string | null
      proposed_at: Date
      resolved_at: Date | null
      expired: boolean
    }[]
  >`
    select o.id, o.cycle, o.payer, o.payee, o.amount::text, o.ref, o.status, o.automatic, o.proposed_tx,
           o.resolved_tx, o.proposed_at, o.resolved_at,
           (o.status = 'proposed' and o.cycle < c.current_cycle) as expired
      from obligations o join circles c on c.id = o.circle_id
     where o.circle_id = ${circleId}::bigint
       and (${status}::text is null or o.status = ${status})
       and (not ${expiredOnly} or (o.status = 'proposed' and o.cycle < c.current_cycle))
       and (${address}::text is null or o.payer = ${address} or o.payee = ${address})
       and (${opts.cursor ?? null}::bigint is null or o.id < ${opts.cursor ?? null}::bigint)
     order by o.id desc
     limit ${limit + 1}`
  const page = rows.slice(0, limit)
  return { items: page, nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null }
}

export async function listEvents(circleId: string, opts: { cursor?: string; limit?: number }) {
  const limit = clampLimit(opts.limit, 30)
  const rows = await sql<
    { id: string; name: string; args: Record<string, unknown>; block_number: string; block_time: Date; tx_hash: string; log_index: number }[]
  >`
    select id, name, args, block_number, block_time, tx_hash, log_index from chain_events
     where circle_id = ${circleId}::bigint and (${opts.cursor ?? null}::bigint is null or id < ${opts.cursor ?? null}::bigint)
     order by id desc limit ${limit + 1}`
  const page = rows.slice(0, limit)
  return { items: page, nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null }
}

export async function listCycles(circleId: string) {
  const cycles = await sql<
    { cycle: string; gross: string; net_volume: string; obligation_count: number; closed_at: Date; tx_hash: string }[]
  >`
    select cycle, gross::text, net_volume::text, obligation_count, closed_at, tx_hash
      from cycles where circle_id = ${circleId}::bigint order by cycle desc limit 60`
  const positions = await sql<{ cycle: string; member: string; net: string }[]>`
    select cycle, member, net::text from cycle_positions
     where circle_id = ${circleId}::bigint and cycle in (select cycle from cycles where circle_id = ${circleId}::bigint order by cycle desc limit 60)`
  return { cycles, positions }
}

export async function listPolicies(circleId: string, address?: string) {
  const a = address ? lc(address) : null
  return sql<{ payer: string; payee: string; per_obligation: string; per_cycle: string; updated_at: Date }[]>`
    select payer, payee, per_obligation::text, per_cycle::text, updated_at from policies
     where circle_id = ${circleId}::bigint and (${a}::text is null or payer = ${a} or payee = ${a})
       and (per_obligation > 0 or per_cycle > 0)
     order by updated_at desc limit 200`
}

export async function inbox(address: string) {
  const a = lc(address)
  const invites = await sql<{ circle_id: string; name: string }[]>`
    select m.circle_id, c.name from members m join circles c on c.id = m.circle_id
     where m.address = ${a} and m.status = 'invited' order by m.circle_id desc limit 50`
  const toReview = await sql<{ id: string; circle_id: string; circle_name: string; payee: string; amount: string; ref: string }[]>`
    select o.id, o.circle_id, c.name as circle_name, o.payee, o.amount::text, o.ref
      from obligations o join circles c on c.id = o.circle_id
     where o.payer = ${a} and o.status = 'proposed' and o.cycle = c.current_cycle
     order by o.id desc limit 50`
  const awaitingPayer = await sql<{ id: string; circle_id: string; circle_name: string; payer: string; amount: string }[]>`
    select o.id, o.circle_id, c.name as circle_name, o.payer, o.amount::text
      from obligations o join circles c on c.id = o.circle_id
     where o.payee = ${a} and o.status = 'proposed' and o.cycle = c.current_cycle
     order by o.id desc limit 50`
  const closable = await sql<{ circle_id: string; name: string; ends_at: string }[]>`
    select c.id as circle_id, c.name, (c.cycle_start + c.cycle_duration)::text as ends_at
      from circles c join members m on m.circle_id = c.id
     where m.address = ${a} and m.status = 'member'
       and (c.cycle_start + c.cycle_duration) <= extract(epoch from now())::bigint
     order by c.id desc limit 50`
  const settled = await sql<{ circle_id: string; circle_name: string; cycle: string; net: string; closed_at: Date }[]>`
    select p.circle_id, c.name as circle_name, p.cycle, p.net::text, y.closed_at
      from cycle_positions p join cycles y on y.circle_id = p.circle_id and y.cycle = p.cycle
      join circles c on c.id = p.circle_id
     where p.member = ${a} order by y.closed_at desc limit 10`
  return { invites, toReview, awaitingPayer, closable, settled }
}

/** Accounting export: one row per obligation, ready for a spreadsheet or ERP import. */
export async function statementCsv(circleId: string): Promise<string> {
  const rows = await sql<
    { id: string; cycle: string; payer: string; payee: string; amount: string; status: string; automatic: boolean; ref: string; proposed_at: Date; proposed_tx: string }[]
  >`
    select id, cycle, payer, payee, amount::text, status, automatic, ref, proposed_at, proposed_tx
      from obligations where circle_id = ${circleId}::bigint order by id limit 5000`
  const header = 'obligation_id,cycle,payer,payee,amount_usdc,status,auto_accepted,document_ref,proposed_at,tx_hash'
  const lines = rows.map((r) => {
    const whole = r.amount.padStart(7, '0')
    const usdc = `${whole.slice(0, -6)}.${whole.slice(-6)}`
    return [r.id, r.cycle, r.payer, r.payee, usdc, r.status, r.automatic, r.ref, r.proposed_at.toISOString(), r.proposed_tx].join(',')
  })
  return [header, ...lines].join('\n')
}
