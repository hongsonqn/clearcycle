/**
 * End-to-end test on a LOCAL anvil chain with a throwaway database.
 * Exercises: contract -> indexer -> projector -> reconciliation -> intents, plus idempotent
 * re-indexing, rebuild-from-events, and reorg recovery. Uses anvil's unlocked dev accounts
 * (no private keys anywhere). Run: bun run test:e2e
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import { createPublicClient, createWalletClient, http, keccak256, toBytes, type Address, type Hex } from 'viem'
import { foundry } from 'viem/chains'

const PORT = 8546
const RPC = `http://127.0.0.1:${PORT}`
const BASE_DB = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5433/clearcycle'
const E2E_DB = BASE_DB.replace(/\/[^/]+$/, '/clearcycle_e2e')

let failures = 0
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  -> ${detail}`}`)
  if (!ok) failures += 1
}

function artifact(path: string): { abi: never; bytecode: Hex } {
  const json = JSON.parse(readFileSync(path, 'utf8')) as { abi: never; bytecode: { object: Hex } }
  return { abi: json.abi, bytecode: json.bytecode.object }
}

const step = (s: string): void => console.log(`… ${s}`)

async function main(): Promise<void> {
  step("db")
  const admin = postgres(BASE_DB.replace(/\/[^/]+$/, '/postgres'), { max: 1, onnotice: () => {} })
  await admin.unsafe('drop database if exists clearcycle_e2e with (force)')
  await admin.unsafe('create database clearcycle_e2e')
  await admin.end()

  const anvil = spawn('anvil', ['--port', String(PORT), '--silent'], { stdio: 'ignore' })
  try {
    const pub = createPublicClient({ chain: foundry, transport: http(RPC), pollingInterval: 100 })
    for (let i = 0; i < 40; i++) {
      try {
        await pub.getBlockNumber()
        break
      } catch {
        await new Promise((r) => setTimeout(r, 250))
      }
    }
    step('anvil up')
    const accounts = (await pub.request({ method: 'eth_accounts' } as never)) as Address[]
    const [owner, alice, bob, carol] = accounts as [Address, Address, Address, Address]
    const wallet = (account: Address) => createWalletClient({ account, chain: foundry, transport: http(RPC) })
    const send = async (hash: Hex): Promise<void> => {
      const r = await pub.waitForTransactionReceipt({ hash })
      if (r.status !== 'success') throw new Error(`tx reverted: ${hash}`)
    }

    step('deploying')
    const mock = artifact('contracts/out/ClearingHouse.Base.t.sol/MockUSDC.json')
    const ch = artifact('contracts/out/ClearingHouse.sol/ClearingHouse.json')
    const usdcHash = await wallet(owner).deployContract({ abi: mock.abi, bytecode: mock.bytecode })
    const usdc = (await pub.waitForTransactionReceipt({ hash: usdcHash })).contractAddress as Address
    const chHash = await wallet(owner).deployContract({ abi: ch.abi, bytecode: ch.bytecode, args: [usdc] })
    const chReceipt = await pub.waitForTransactionReceipt({ hash: chHash })
    const house = chReceipt.contractAddress as Address

    process.env.CLEARCYCLE_RPC_URL = RPC
    process.env.VITE_CLEARCYCLE_CHAIN_ID = '31337'
    process.env.VITE_CLEARCYCLE_ADDRESS = house
    process.env.VITE_CLEARCYCLE_DEPLOY_BLOCK = chReceipt.blockNumber.toString()
    process.env.CLEARCYCLE_USDC_ADDRESS = usdc
    process.env.DATABASE_URL = E2E_DB
    process.env.INDEXER_REORG_DEPTH = '4'

    const { clearingHouseAbi } = await import('../src/lib/abi')
    const { migrate } = await import('../server/migrate')
    const { indexOnce } = await import('../server/indexer')
    const { rebuildDerived } = await import('../server/projector')
    const { reconcileCircle } = await import('../server/reconcile')
    const { createIntent, markSubmitted, refreshIntent } = await import('../server/intents')
    const { circleDetail, inbox, statementCsv } = await import('../server/queries')
    const { sql } = await import('../server/db')

    step('migrate')
    await migrate()
    const mintAbi = [
      { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
      { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
    ] as const
    const call = async (from: Address, fn: string, args: unknown[]): Promise<Hex> => {
      step(`call ${fn}`)
      const hash = await wallet(from).writeContract({ address: house, abi: clearingHouseAbi, functionName: fn as never, args: args })
      await send(hash)
      return hash
    }
    const fund = async (who: Address, amount: bigint): Promise<void> => {
      await send(await wallet(owner).writeContract({ address: usdc, abi: mintAbi, functionName: 'mint', args: [who, amount] }))
      await send(await wallet(who).writeContract({ address: usdc, abi: mintAbi, functionName: 'approve', args: [house, amount] }))
    }

    // --- Scenario: 3-party ring, Alice -> Bob -> Carol -> Alice, collateral only for the net ---
    await call(alice, 'createCircle', ['E2E ring', 3600])
    const circleId = 1n
    for (const m of [bob, carol]) {
      await call(alice, 'inviteMember', [circleId, m])
      await call(m, 'join', [circleId])
    }
    for (const m of [alice, bob, carol]) await fund(m, 1000_000000n)
    await call(alice, 'deposit', [circleId, 100_000000n])
    await call(bob, 'deposit', [circleId, 100_000000n])
    await call(carol, 'deposit', [circleId, 100_000000n])
    // Bob authorizes Alice's invoices up to 80 USDC automatically
    await call(bob, 'setPolicy', [circleId, alice, 80_000000n, 200_000000n])
    const ref = keccak256(toBytes('invoice-1'))
    await call(alice, 'proposeObligation', [circleId, bob, 80_000000n, ref]) // Bob owes Alice 80 (auto)
    await call(bob, 'proposeObligation', [circleId, carol, 70_000000n, ref]) // Carol owes Bob 70 (manual)
    await call(carol, 'acceptObligation', [2n])
    await call(carol, 'proposeObligation', [circleId, alice, 60_000000n, ref]) // Alice owes Carol 60 (manual)
    await call(alice, 'acceptObligation', [3n])
    const rejectedHash = await call(bob, 'proposeObligation', [circleId, alice, 5_000000n, ref]) // Alice owes Bob 5, rejected
    await call(alice, 'rejectObligation', [4n])

    // Fast-forward past the cycle and close it
    await pub.request({ method: 'evm_increaseTime' as never, params: [3700] as never })
    await pub.request({ method: 'evm_mine' as never, params: [] as never })
    const closeHash = await call(carol, 'closeCycle', [circleId])

    step('indexing')
    await indexOnce()
    const detail = await circleDetail('1')
    const cycle = detail?.closed
    check('gross volume = 210 USDC', cycle?.gross === '210000000', cycle?.gross)
    check('net volume = 20 USDC (90% less money moved)', cycle?.net_volume === '20000000', cycle?.net_volume)
    check('one of three accepted invoices was auto-accepted', detail?.automation?.auto === 1 && detail.automation.total === 3, JSON.stringify(detail?.automation))
    const bal = Object.fromEntries((detail?.members ?? []).map((m) => [m.address, m.balance]))
    check('Alice balance 100 + 80 - 60 = 120', bal[alice.toLowerCase()] === '120000000', bal[alice.toLowerCase()])
    check('Bob balance 100 - 80 + 70 = 90', bal[bob.toLowerCase()] === '90000000', bal[bob.toLowerCase()])
    check('Carol balance 100 - 70 + 60 = 90', bal[carol.toLowerCase()] === '90000000', bal[carol.toLowerCase()])

    const rec = await reconcileCircle('1')
    check('reconciliation: database == chain', rec.status === 'ok' && rec.drift.length === 0, JSON.stringify(rec))
    check('custody covered by contract USDC', rec.custody.covered === true)

    // Idempotency: running the indexer again and re-ingesting must not duplicate anything.
    const before = await sql<{ n: number }[]>`select count(*)::int as n from chain_events`
    await sql`update indexer_state set last_block = ${(chReceipt.blockNumber - 1n).toString()}::bigint, last_block_hash = null`
    await indexOnce()
    const after = await sql<{ n: number }[]>`select count(*)::int as n from chain_events`
    check('re-ingesting from deploy block is idempotent', before[0]?.n === after[0]?.n, `${before[0]?.n} vs ${after[0]?.n}`)
    const rec2 = await reconcileCircle('1')
    check('balances unchanged after re-ingest (no double projection)', rec2.status === 'ok')

    // Rebuild from events equals the live projection
    const snapshotA = await sql`select address, balance::text, net::text from members order by circle_id, address`
    const replayed = await rebuildDerived()
    const snapshotB = await sql`select address, balance::text, net::text from members order by circle_id, address`
    check('rebuild from chain_events reproduces derived state', JSON.stringify(snapshotA) === JSON.stringify(snapshotB) && replayed > 10, `replayed ${replayed}`)

    // Intents are verified from the receipt, never from the client
    const intent = await createIntent({ idempotencyKey: 'e2e-close-0001', address: carol, kind: 'closeCycle', circleId: '1', params: {} })
    const again = await createIntent({ idempotencyKey: 'e2e-close-0001', address: carol, kind: 'closeCycle', circleId: '1', params: {} })
    check('intent creation is idempotent', intent.id === again.id)
    await markSubmitted(intent.id, closeHash)
    const verified = await refreshIntent(intent.id)
    check('intent reaches indexed only after receipt + index', verified.status === 'indexed', verified.status)
    const spoof = await createIntent({ idempotencyKey: 'e2e-spoof-0001', address: bob, kind: 'closeCycle', circleId: '1', params: {} })
    await markSubmitted(spoof.id, closeHash)
    const spoofed = await refreshIntent(spoof.id)
    check('intent claiming another sender is rejected', spoofed.status === 'failed', spoofed.status)
    const wrong = await createIntent({ idempotencyKey: 'e2e-wrong-0001', address: bob, kind: 'deposit', circleId: '1', params: {} })
    await markSubmitted(wrong.id, rejectedHash)
    const wrongKind = await refreshIntent(wrong.id)
    check('intent whose receipt lacks the expected event fails', wrongKind.status === 'failed', wrongKind.status)

    const box = await inbox(alice)
    check('inbox lists the settled cycle for Alice', box.settled.length === 1 && box.settled[0]?.net === '20000000', JSON.stringify(box.settled))
    const csv = await statementCsv('1')
    check('CSV statement has header + 4 obligations', csv.split('\n').length === 5)

    // --- Reorg: snapshot, index an event, revert chain, mine a different event, expect recovery ---
    const snap = (await pub.request({ method: 'evm_snapshot' as never, params: [] as never })) as Hex
    await call(alice, 'deposit', [circleId, 11_000000n])
    await indexOnce()
    const reorgBefore = await sql<{ b: string }[]>`select balance::text as b from members where address = ${alice.toLowerCase()}`
    check('post-snapshot deposit indexed', reorgBefore[0]?.b === '131000000', reorgBefore[0]?.b)
    await pub.request({ method: 'evm_revert' as never, params: [snap] as never })
    await call(alice, 'deposit', [circleId, 3_000000n])
    for (let i = 0; i < 3; i++) await pub.request({ method: 'evm_mine' as never, params: [] as never })
    let guard = 0
    let sawReorg = false
    while (guard++ < 6) {
      const r = await indexOnce()
      if (r.reorg) sawReorg = true
      if (!r.reorg && r.lastBlock >= (await pub.getBlockNumber())) break
    }
    const rec3 = await reconcileCircle('1')
    check('indexer detected the reorg', sawReorg)
    check('after reorg recovery database == chain', rec3.status === 'ok', JSON.stringify(rec3.drift))
    await sql.end()
  } finally {
    anvil.kill('SIGKILL')
  }
  console.log(failures === 0 ? '\nALL E2E CHECKS PASSED' : `\n${failures} E2E CHECK(S) FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

await main()
