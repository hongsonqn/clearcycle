/**
 * Event indexer: idempotent, resumable, checkpointed, reorg-aware.
 *
 *  - Starts at the contract's deployment block, never at block 0.
 *  - Reads at most `maxRange` blocks per eth_getLogs call.
 *  - Every log is keyed by (tx_hash, log_index); re-ingesting is a no-op and does not re-project.
 *  - The checkpoint stores the hash of the last indexed block. If the chain no longer agrees,
 *    events within `reorgDepth` blocks are dropped and DERIVED tables are rebuilt from chain_events.
 */
import { decodeEventLog, type Hex, type Log } from 'viem'
import { clearingHouseAbi } from '../src/lib/abi'
import { client } from './chain'
import { config } from './config'
import { sql } from './db'
import { applyEvent, rebuildDerived, type EventArgs } from './projector'

/** Adaptive request size: halves when the RPC rejects a range, creeps back up on success. */
const MIN_RANGE = 100n
let currentRange = config.maxRange

const STATE_ID = `clearinghouse:${config.chainId}:${config.contract.toLowerCase()}`

interface StateRow {
  last_block: string
  last_block_hash: string | null
}

export interface IndexResult {
  head: bigint
  lastBlock: bigint
  ingested: number
  reorg: boolean
}

function normalizeArgs(raw: Record<string, unknown>): EventArgs {
  const out: EventArgs = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'bigint') out[key] = value.toString()
    else if (typeof value === 'boolean' || typeof value === 'number') out[key] = value
    else if (typeof value === 'string') out[key] = value.toLowerCase().startsWith('0x') ? value.toLowerCase() : value
  }
  return out
}

async function getState(): Promise<StateRow> {
  const rows = await sql<StateRow[]>`select last_block, last_block_hash from indexer_state where id = ${STATE_ID}`
  const existing = rows[0]
  if (existing) return existing
  const initial = (config.deployBlock - 1n).toString()
  await sql`insert into indexer_state (id, last_block) values (${STATE_ID}, ${initial}::bigint) on conflict (id) do nothing`
  return { last_block: initial, last_block_hash: null }
}

async function blockTimes(numbers: bigint[]): Promise<Map<string, { time: Date; hash: Hex }>> {
  const unique = [...new Set(numbers.map((n) => n.toString()))]
  const out = new Map<string, { time: Date; hash: Hex }>()
  for (let i = 0; i < unique.length; i += 5) {
    const batch = unique.slice(i, i + 5)
    const blocks = await Promise.all(batch.map((n) => client.getBlock({ blockNumber: BigInt(n) })))
    blocks.forEach((block, idx) => {
      const key = batch[idx]
      if (key) out.set(key, { time: new Date(Number(block.timestamp) * 1000), hash: block.hash })
    })
  }
  return out
}

/** One bounded pass. Safe to call repeatedly and concurrently with API reads. */
export async function indexOnce(): Promise<IndexResult> {
  const head = await client.getBlockNumber({ cacheTime: 0 })
  const state = await getState()
  let last = BigInt(state.last_block)

  if (state.last_block_hash && last >= config.deployBlock) {
    const onchain = await client.getBlock({ blockNumber: last })
    if (onchain.hash.toLowerCase() !== state.last_block_hash.toLowerCase()) {
      const rollbackTo = last - config.reorgDepth < config.deployBlock - 1n ? config.deployBlock - 1n : last - config.reorgDepth
      await sql.begin(async (tx) => {
        await tx`delete from chain_events where block_number > ${rollbackTo.toString()}::bigint`
        await tx`update indexer_state set last_block = ${rollbackTo.toString()}::bigint, last_block_hash = null, updated_at = now() where id = ${STATE_ID}`
      })
      await rebuildDerived()
      return { head, lastBlock: rollbackTo, ingested: 0, reorg: true }
    }
  }

  const target = head - config.confirmations
  if (last >= target) {
    await sql`update indexer_state set head_block = ${head.toString()}::bigint, last_error = null, updated_at = now() where id = ${STATE_ID}`
    return { head, lastBlock: last, ingested: 0, reorg: false }
  }

  const from = last + 1n
  const to = from + currentRange - 1n < target ? from + currentRange - 1n : target
  let logs
  try {
    logs = await client.getLogs({ address: config.contract, fromBlock: from, toBlock: to })
  } catch (error) {
    const text = error instanceof Error ? error.message : ''
    if (currentRange > MIN_RANGE && /limit|range|too many|exceed/i.test(text)) {
      currentRange = currentRange / 2n < MIN_RANGE ? MIN_RANGE : currentRange / 2n
    }
    throw error
  }
  if (currentRange < config.maxRange) currentRange = currentRange * 2n > config.maxRange ? config.maxRange : currentRange * 2n

  const decoded: { log: Log; name: string; args: EventArgs }[] = []
  for (const log of logs) {
    if (log.blockNumber === null || log.logIndex === null || log.transactionHash === null) continue
    try {
      const ev = decodeEventLog({ abi: clearingHouseAbi, data: log.data, topics: log.topics })
      decoded.push({ log, name: ev.eventName, args: normalizeArgs((ev.args ?? {}) as Record<string, unknown>) })
    } catch {
      // Not an event of this ABI: ignore rather than poison the checkpoint.
    }
  }

  const times = await blockTimes([...decoded.map((d) => d.log.blockNumber as bigint), to])
  const checkpoint = times.get(to.toString())

  let ingested = 0
  await sql.begin(async (tx) => {
    for (const { log, name, args } of decoded) {
      const blockNumber = (log.blockNumber as bigint).toString()
      const meta = times.get(blockNumber)
      if (!meta) throw new Error(`missing block ${blockNumber}`)
      const circleId = 'circleId' in args ? String(args.circleId) : null
      const inserted = await tx<{ id: string }[]>`
        insert into chain_events (chain_id, block_number, block_hash, block_time, tx_hash, log_index, name, circle_id, args)
        values (${config.chainId}, ${blockNumber}::bigint, ${meta.hash}, ${meta.time}, ${log.transactionHash as string},
                ${log.logIndex as number}, ${name}, ${circleId}::bigint, ${tx.json(args)})
        on conflict (tx_hash, log_index) do nothing
        returning id`
      if (inserted.length === 0) continue
      ingested += 1
      await applyEvent(tx, {
        name,
        args,
        blockNumber,
        blockTime: meta.time,
        txHash: log.transactionHash as string,
        logIndex: log.logIndex as number,
      })
    }
    await tx`
      update indexer_state
         set last_block = ${to.toString()}::bigint, last_block_hash = ${checkpoint?.hash ?? null},
             head_block = ${head.toString()}::bigint, last_error = null, updated_at = now()
       where id = ${STATE_ID}`
  })
  last = to
  return { head, lastBlock: last, ingested, reorg: false }
}

/** Long-running loop with bounded exponential backoff. Never throws. */
export function startIndexer(log: (message: string) => void = console.log): () => void {
  let stopped = false
  let failures = 0
  const loop = async (): Promise<void> => {
    while (!stopped) {
      let delay = config.pollMs
      try {
        const result = await indexOnce()
        failures = 0
        if (result.reorg) log(`indexer: reorg detected, rolled back to ${result.lastBlock}`)
        else if (result.ingested > 0) log(`indexer: +${result.ingested} events, at block ${result.lastBlock}/${result.head}`)
        // Still catching up: do not sleep between full ranges.
        if (result.lastBlock + config.confirmations < result.head) delay = 50
      } catch (error) {
        failures += 1
        const message = error instanceof Error ? error.message.slice(0, 300) : 'unknown error'
        delay = Math.min(30_000, 1000 * 2 ** Math.min(failures, 5))
        log(`indexer: error (attempt ${failures}), retrying in ${delay}ms: ${message}`)
        await sql`update indexer_state set last_error = ${message}, updated_at = now() where id = ${STATE_ID}`.catch(() => undefined)
      }
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  void loop()
  return () => {
    stopped = true
  }
}

export interface IndexerStatus {
  lastBlock: string
  headBlock: string | null
  lagBlocks: string | null
  lastError: string | null
  updatedAt: string
}

export async function indexerStatus(): Promise<IndexerStatus | null> {
  const rows = await sql<{ last_block: string; head_block: string | null; last_error: string | null; updated_at: Date }[]>`
    select last_block, head_block, last_error, updated_at from indexer_state where id = ${STATE_ID}`
  const row = rows[0]
  if (!row) return null
  const lag = row.head_block === null ? null : (BigInt(row.head_block) - BigInt(row.last_block)).toString()
  return {
    lastBlock: row.last_block,
    headBlock: row.head_block,
    lagBlocks: lag,
    lastError: row.last_error,
    updatedAt: row.updated_at.toISOString(),
  }
}
