import { useQuery } from '@tanstack/react-query'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { erc20Abi } from 'viem'
import { useAccount, useReadContract } from 'wagmi'
import { ConnectButton } from '@/components/Shell'
import { Address, Button, Card, Empty, SourceTag, Stat } from '@/components/ui'
import { useTx } from '@/hooks/tx'
import { api } from '@/lib/api'
import { CHAIN_ID, CONTRACT, USDC_ADDRESS } from '@/lib/env'
import { usd } from '@/lib/format'

export function Settings() {
  const { address, isConnected } = useAccount()
  const { run, busy } = useTx()
  const health = useQuery({ queryKey: ['health'], queryFn: api.health, retry: false })
  const allowance = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    chainId: CHAIN_ID,
    functionName: 'allowance',
    args: [address as `0x${string}`, CONTRACT as `0x${string}`],
    query: { enabled: !!address && !!CONTRACT, refetchInterval: 6000 },
  })

  if (!isConnected || !address) {
    return (
      <div className="mx-auto max-w-xl pt-8">
        <Empty
          title="Connect a wallet to see your permissions"
          body="Settings show what Clearcycle is currently allowed to do with your wallet."
          action={<ConnectButton />}
        />
      </div>
    )
  }
  const hasAllowance = (allowance.data ?? 0n) > 0n

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight">Settings and permissions</h1>
        <p className="text-sm text-muted">What this app can do, and how to take it back.</p>
      </div>

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <KeyRound className="size-4 text-accent" />
          <h2 className="font-display text-lg font-semibold">USDC allowance</h2>
          <SourceTag source="ONCHAIN" />
        </div>
        <Stat
          label="Clearcycle may pull"
          value={allowance.data === undefined ? '…' : `${usd(allowance.data)} USDC`}
          sub="Normally zero. Each deposit sets an allowance for exactly that amount, and the deposit uses it up."
        />
        {hasAllowance && (
          <Button
            variant="danger"
            className="mt-4"
            loading={busy}
            onClick={() =>
              CONTRACT &&
              void run({
                kind: 'approve',
                label: 'Revoke USDC allowance',
                call: { address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [CONTRACT, 0n] },
              })
            }
          >
            Revoke leftover allowance
          </Button>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="size-4 text-accent" />
          <h2 className="font-display text-lg font-semibold">What Clearcycle can and cannot do</h2>
        </div>
        <ul className="space-y-2 text-sm text-muted">
          <li>
            <strong className="text-ink">Cannot</strong> move your collateral to anyone. It only returns it to you, minus what you owe from netting.
          </li>
          <li>
            <strong className="text-ink">Cannot</strong> be changed by anyone. The contract has no owner, no upgrade key and no fee switch.
          </li>
          <li>
            <strong className="text-ink">Cannot</strong> accept invoices for you unless you set an auto-accept rule, capped per partner, per invoice and per cycle.
          </li>
          <li>
            <strong className="text-ink">Never</strong> asks for your seed phrase or private key. Signing in to read private invoices is a message that cannot move funds and expires in 12 hours.
          </li>
          <li>
            <strong className="text-ink">Circle admins</strong> can invite members and pause new activity, but cannot touch funds or block withdrawals.
          </li>
        </ul>
      </Card>

      <Card>
        <h2 className="mb-3 font-display text-lg font-semibold">Network and contract</h2>
        <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted">Network</dt>
          <dd>Arc Testnet (chain {CHAIN_ID})</dd>
          <dt className="text-muted">Clearing contract</dt>
          <dd>{CONTRACT ? <Address value={CONTRACT} /> : 'Not configured'}</dd>
          <dt className="text-muted">USDC</dt>
          <dd>
            <Address value={USDC_ADDRESS} />
          </dd>
          <dt className="text-muted">Your wallet</dt>
          <dd>
            <Address value={address} />
          </dd>
          <dt className="text-muted">Ledger service</dt>
          <dd>
            {health.data ? `${health.data.status}, ${health.data.indexer?.lagBlocks ?? '?'} blocks behind` : health.isError ? 'unreachable' : 'checking…'}
          </dd>
        </dl>
        <p className="mt-4 text-xs text-muted">Network fees on Arc are paid in USDC, the same asset as your collateral.</p>
      </Card>
    </div>
  )
}
