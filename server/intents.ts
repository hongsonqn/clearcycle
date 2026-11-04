/**
 * Transaction intents. The browser records what it is about to do and, later, the hash it got back.
 * An intent grants no authority and its status is never taken from the client: the server decides
 * `verified` only from the receipt (success, sender, target, expected event) and `indexed` only
 * once the indexer has stored that transaction's events.
 */
import { decodeEventLog, isHash, isAddress } from 'viem'
import { clearingHouseAbi } from '../src/lib/abi'
import { client } from './chain'
import { config } from './config'
import { lc, sql } from './db'

export const EXPECTED_EVENT: Record<string, string | null> = {
  createCircle: 'CircleCreated',
  invite: 'MemberInvited',
  revokeInvite: 'InviteRevoked',
  join: 'MemberJoined',
  leave: 'MemberLeft',
  deposit: 'Deposited',
  withdraw: 'Withdrawn',
  setPolicy: 'PolicySet',
  propose: 'ObligationProposed',
  accept: 'ObligationAccepted',
  reject: 'ObligationRejected',
  cancel: 'ObligationCancelled',
  closeCycle: 'CycleClosed',
  pause: 'CirclePaused',
  approve: null,
}

export interface IntentRow {
  id: string
  idempotency_key: string
  address: string
  kind: string
  circle_id: string | null
  params: Record<string, unknown>
  status: 'prepared' | 'submitted' | 'verified' | 'indexed' | 'failed' | 'rejected'
  tx_hash: string | null
  detail: string | null
  created_at: Date
  updated_at: Date
}

export async function createIntent(input: {
  idempotencyKey: string
  address: string
  kind: string
  circleId: string | null
  params: Record<string, string | number | boolean>
}): Promise<IntentRow> {
  if (!(input.kind in EXPECTED_EVENT)) throw new HttpError(400, 'Unknown intent kind')
  if (!isAddress(input.address)) throw new HttpError(400, 'Invalid address')
  if (!/^[\w-]{8,80}$/.test(input.idempotencyKey)) throw new HttpError(400, 'Invalid idempotency key')
  // Insert-or-return keeps retries and double clicks from creating a second intent.
  const rows = await sql<IntentRow[]>`
    insert into tx_intents (idempotency_key, address, kind, circle_id, params, status)
    values (${input.idempotencyKey}, ${lc(input.address)}, ${input.kind}, ${input.circleId}::bigint, ${sql.json(input.params)}, 'prepared')
    on conflict (idempotency_key) do update set updated_at = tx_intents.updated_at
    returning *`
  const row = rows[0]
  if (!row) throw new HttpError(500, 'Could not store intent')
  return row
}

export async function markSubmitted(id: string, txHash: string): Promise<IntentRow> {
  if (!isHash(txHash)) throw new HttpError(400, 'Invalid transaction hash')
  const rows = await sql<IntentRow[]>`
    update tx_intents
       set tx_hash = coalesce(tx_hash, ${lc(txHash)}), status = case when status = 'prepared' then 'submitted' else status end, updated_at = now()
     where id = ${id}::uuid
     returning *`
  const row = rows[0]
  if (!row) throw new HttpError(404, 'Intent not found')
  return row
}

export async function markRejected(id: string): Promise<IntentRow> {
  const rows = await sql<IntentRow[]>`
    update tx_intents set status = 'rejected', detail = 'Rejected in wallet', updated_at = now()
     where id = ${id}::uuid and status = 'prepared'
     returning *`
  const row = rows[0] ?? (await getIntent(id))
  return row
}

async function getIntent(id: string): Promise<IntentRow> {
  const rows = await sql<IntentRow[]>`select * from tx_intents where id = ${id}::uuid`
  const row = rows[0]
  if (!row) throw new HttpError(404, 'Intent not found')
  return row
}

async function setStatus(id: string, status: IntentRow['status'], detail: string | null): Promise<IntentRow> {
  const rows = await sql<IntentRow[]>`
    update tx_intents set status = ${status}, detail = ${detail}, updated_at = now() where id = ${id}::uuid returning *`
  const row = rows[0]
  if (!row) throw new HttpError(404, 'Intent not found')
  return row
}

/** Refresh an intent from chain truth. Idempotent; terminal states are returned untouched. */
export async function refreshIntent(id: string): Promise<IntentRow> {
  const intent = await getIntent(id)
  if (!intent.tx_hash || intent.status === 'indexed' || intent.status === 'failed' || intent.status === 'rejected') return intent

  if (intent.status === 'submitted') {
    let receipt
    try {
      receipt = await client.getTransactionReceipt({ hash: intent.tx_hash as `0x${string}` })
    } catch {
      return intent // not mined yet (or RPC hiccup): remain submitted
    }
    if (receipt.status !== 'success') return setStatus(id, 'failed', 'Transaction reverted onchain')
    if (lc(receipt.from) !== intent.address) return setStatus(id, 'failed', 'Transaction was sent from a different address')

    const expected = EXPECTED_EVENT[intent.kind]
    if (expected === null) {
      if (!config.usdc || lc(receipt.to ?? '') !== lc(config.usdc)) return setStatus(id, 'failed', 'Approval did not target USDC')
      return setStatus(id, 'indexed', 'USDC allowance transaction confirmed')
    }
    if (lc(receipt.to ?? '') !== lc(config.contract)) return setStatus(id, 'failed', 'Transaction did not target the Clearcycle contract')
    const seen = receipt.logs.some((log) => {
      if (lc(log.address) !== lc(config.contract)) return false
      try {
        return decodeEventLog({ abi: clearingHouseAbi, data: log.data, topics: log.topics }).eventName === expected
      } catch {
        return false
      }
    })
    if (!seen) return setStatus(id, 'failed', `Receipt succeeded but ${expected} was not emitted`)
    await setStatus(id, 'verified', 'Confirmed onchain; waiting for the index')
  }

  const current = await getIntent(id)
  if (current.status !== 'verified') return current
  const indexed = await sql<{ n: string }[]>`select count(*)::text as n from chain_events where tx_hash = ${current.tx_hash}`
  if (Number(indexed[0]?.n ?? '0') > 0) return setStatus(id, 'indexed', 'Confirmed onchain and indexed')
  return current
}

export async function listIntents(address: string, limit = 20): Promise<IntentRow[]> {
  return sql<IntentRow[]>`
    select * from tx_intents where address = ${lc(address)} order by created_at desc limit ${Math.min(limit, 50)}`
}

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
