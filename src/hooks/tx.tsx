/**
 * Transaction manager. Lifecycle:
 *   validate -> intent recorded -> simulate -> sign -> submit (hash stored) -> receipt
 *   -> server verifies the receipt + expected event -> indexer stores it -> UI refreshes.
 * Success is never claimed from a hash alone.
 */
import { useQueryClient } from '@tanstack/react-query'
import { Check, ExternalLink, Loader2, X } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { type Abi, type Address, type Hex } from 'viem'
import { usePublicClient, useSwitchChain, useWriteContract, useAccount } from 'wagmi'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { api } from '@/lib/api'
import { CHAIN_ID } from '@/lib/env'
import { describeError } from '@/lib/errors'

export type Phase = 'validating' | 'signing' | 'confirming' | 'verified' | 'indexed' | 'failed' | 'rejected'

export interface TxRecord {
  id: string
  label: string
  phase: Phase
  hash?: Hex
  message?: string
}

export interface RunSpec {
  kind: string
  label: string
  circleId?: string
  params?: Record<string, string | number | boolean>
  call: { address: Address; abi: Abi; functionName: string; args: readonly unknown[] }
}

interface TxApi {
  run: (spec: RunSpec) => Promise<boolean>
  busy: boolean
}

const TxContext = createContext<TxApi | null>(null)

export function useTx(): TxApi {
  const ctx = useContext(TxContext)
  if (!ctx) throw new Error('useTx must be used inside TxProvider')
  return ctx
}

const STEPS: Phase[] = ['validating', 'signing', 'confirming', 'verified', 'indexed']
const COPY: Record<Phase, string> = {
  validating: 'Checking your request',
  signing: 'Confirm in your wallet',
  confirming: 'Waiting for the network',
  verified: 'Confirmed onchain. Updating the ledger',
  indexed: 'Done',
  failed: 'Failed',
  rejected: 'Cancelled',
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export function TxProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<TxRecord[]>([])
  const { address, chainId } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const { switchChainAsync } = useSwitchChain()
  const publicClient = usePublicClient({ chainId: CHAIN_ID })
  const queryClient = useQueryClient()

  const patch = useCallback((id: string, next: Partial<TxRecord>) => {
    setRecords((rs) => rs.map((r) => (r.id === id ? { ...r, ...next } : r)))
  }, [])

  const run = useCallback(
    async (spec: RunSpec): Promise<boolean> => {
      const id = crypto.randomUUID()
      setRecords((rs) => [{ id, label: spec.label, phase: 'validating' as Phase }, ...rs].slice(0, 4))
      let intentId: string | undefined
      try {
        if (!address || !publicClient) throw new Error('Connect your wallet to continue.')
        if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID })

        // Record the intent (idempotent). The server never trusts it for success.
        try {
          const intent = await api.createIntent({
            idempotencyKey: id,
            address,
            kind: spec.kind,
            circleId: spec.circleId,
            params: spec.params,
          })
          intentId = intent.id
        } catch {
          /* tracking is best effort; the receipt check below is still performed */
        }

        // Dry-run to surface a precise revert reason before the wallet ever opens.
        await publicClient.simulateContract({ ...spec.call, account: address } as never)

        patch(id, { phase: 'signing' })
        const hash = await writeContractAsync({ ...spec.call, chainId: CHAIN_ID })
        patch(id, { phase: 'confirming', hash })
        if (intentId) await api.submitIntent(intentId, hash).catch(() => undefined)

        const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 })
        if (receipt.status !== 'success') throw new Error('The transaction was included but reverted onchain.')
        patch(id, { phase: 'verified' })

        // The server re-checks the receipt (sender, target, expected event) and waits for the index.
        if (intentId) {
          for (let i = 0; i < 40; i++) {
            const intent = await api.intent(intentId).catch(() => null)
            if (intent?.status === 'indexed') break
            if (intent?.status === 'failed') throw new Error(intent.detail ?? 'Verification failed')
            await sleep(1000)
          }
        }
        patch(id, { phase: 'indexed' })
        await queryClient.invalidateQueries()
        return true
      } catch (error) {
        const described = describeError(error)
        patch(id, { phase: described.rejected ? 'rejected' : 'failed', message: described.message })
        if (described.rejected && intentId) await api.rejectIntent(intentId).catch(() => undefined)
        return false
      }
    },
    [address, chainId, patch, publicClient, queryClient, switchChainAsync, writeContractAsync],
  )

  const busy = records.some((r) => r.phase === 'validating' || r.phase === 'signing' || r.phase === 'confirming')
  const value = useMemo(() => ({ run, busy }), [run, busy])

  return (
    <TxContext.Provider value={value}>
      {children}
      <TxTray records={records} onDismiss={(id) => setRecords((rs) => rs.filter((r) => r.id !== id))} />
    </TxContext.Provider>
  )
}

function TxTray({ records, onDismiss }: { records: TxRecord[]; onDismiss: (id: string) => void }) {
  if (records.length === 0) return null
  return (
    <div className="fixed bottom-4 left-4 z-40 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {records.map((r) => {
        const done = r.phase === 'indexed'
        const bad = r.phase === 'failed' || r.phase === 'rejected'
        const step = STEPS.indexOf(r.phase)
        return (
          <div key={r.id} className="rounded-xl border border-line bg-card p-3 shadow-lift">
            <div className="flex items-start gap-2">
              <div className="mt-0.5">
                {done ? (
                  <Check className="size-4 text-ok" />
                ) : bad ? (
                  <X className="size-4 text-danger" />
                ) : (
                  <Loader2 className="size-4 animate-spin text-accent" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{r.label}</p>
                <p className={`text-xs ${bad ? 'text-danger' : 'text-muted'}`}>{bad && r.message ? r.message : COPY[r.phase]}</p>
                {!bad && (
                  <div className="mt-2 flex gap-1" role="progressbar" aria-valuemin={0} aria-valuemax={4} aria-valuenow={Math.max(step, 0)}>
                    {STEPS.map((s, i) => (
                      <span key={s} className={`h-1 flex-1 rounded-full ${i <= step ? 'bg-accent' : 'bg-line'}`} />
                    ))}
                  </div>
                )}
                {r.hash && (
                  <a
                    href={buildTxExplorerUrl(CHAIN_ID, r.hash)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                  >
                    View transaction <ExternalLink className="size-3" />
                  </a>
                )}
              </div>
              <button onClick={() => onDismiss(r.id)} className="rounded p-1 text-muted hover:bg-paper" aria-label="Dismiss">
                <X className="size-3.5" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
