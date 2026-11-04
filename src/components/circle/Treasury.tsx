import { erc20Abi } from 'viem'
import { useState } from 'react'
import { useAccount } from 'wagmi'
import { AmountInput, Button, Card, Empty, SourceTag, Stat } from '@/components/ui'
import { useCircleChain } from '@/hooks/chain'
import { useTx } from '@/hooks/tx'
import { clearingHouseAbi } from '@/lib/abi'
import type { CircleDetail } from '@/lib/api'
import { CONTRACT, USDC_ADDRESS } from '@/lib/env'
import { tryParseUsdc, usd } from '@/lib/format'
import { formatUsdc } from '@/onchain-money'

export function Treasury({ data, isMember }: { data: CircleDetail; isMember: boolean }) {
  const { address } = useAccount()
  const chain = useCircleChain(isMember ? data.circle.id : undefined)
  const { run, busy } = useTx()
  const [deposit, setDeposit] = useState('')
  const [withdraw, setWithdraw] = useState('')

  if (!isMember || !address) return <Empty title="Members only" body="Join the circle to post collateral and withdraw it." />

  const dRaw = tryParseUsdc(deposit)
  const wRaw = tryParseUsdc(withdraw)
  const needsAllowance = dRaw !== null && chain.allowance !== undefined && chain.allowance < dRaw
  const walletShort = dRaw !== null && chain.usdcBalance !== undefined && chain.usdcBalance < dRaw
  const overWithdraw = wRaw !== null && chain.withdrawable !== undefined && wRaw > chain.withdrawable
  const netDebit = chain.net !== undefined && chain.net < 0n ? -chain.net : 0n

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <div className="mb-4 flex items-center gap-2">
            <h2 className="font-display text-lg font-semibold">Your collateral in this circle</h2>
            <SourceTag source="ONCHAIN" />
          </div>
          <div className="grid gap-6 sm:grid-cols-4">
            <Stat label="Collateral" value={chain.balance === undefined ? '…' : usd(chain.balance)} sub="USDC held for you" />
            <Stat label="Must stay locked" value={usd(netDebit)} sub="Covers what you pay at close" tone={netDebit > 0n ? 'warn' : undefined} />
            <Stat label="Free to withdraw" value={chain.withdrawable === undefined ? '…' : usd(chain.withdrawable)} tone="ok" />
            <Stat label="Wallet USDC" value={chain.usdcBalance === undefined ? '…' : usd(chain.usdcBalance)} sub="Also pays network fees" />
          </div>
          <p className="mt-4 rounded-lg bg-paper p-3 text-xs text-muted">
            You only need collateral for what you owe <em>after</em> netting. Invoices you are owed offset invoices you owe, so a balanced ring needs very little locked up.
          </p>
        </Card>
      </div>

      <Card>
        <h3 className="font-display text-lg font-semibold">Add collateral</h3>
        <p className="mb-4 text-sm text-muted">Move USDC from your wallet into this circle. You can take unlocked collateral back any time.</p>
        <AmountInput
          value={deposit}
          onChange={setDeposit}
          max={chain.usdcBalance !== undefined ? formatUsdc(chain.usdcBalance) : undefined}
          maxLabel={chain.usdcBalance !== undefined ? `Wallet: ${usd(chain.usdcBalance)} · Max` : undefined}
        />
        {walletShort && <p className="mt-2 text-xs text-danger">That is more than your wallet holds. Use Get test USDC in the sidebar.</p>}
        <div className="mt-4 space-y-2">
          {needsAllowance && dRaw !== null && (
            <Button
              variant="secondary"
              className="w-full"
              loading={busy}
              onClick={() =>
                void run({
                  kind: 'approve',
                  label: `Allow Clearcycle to take ${usd(dRaw)} USDC`,
                  circleId: data.circle.id,
                  call: { address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [CONTRACT, dRaw] },
                })
              }
            >
              Step 1: Allow exactly {usd(dRaw)} USDC
            </Button>
          )}
          <Button
            className="w-full"
            disabled={dRaw === null || needsAllowance || walletShort || data.circle.paused}
            loading={busy}
            onClick={() => {
              if (!CONTRACT || dRaw === null) return
              void run({
                kind: 'deposit',
                label: `Add ${usd(dRaw)} USDC collateral`,
                circleId: data.circle.id,
                params: { amount: dRaw.toString() },
                call: { address: CONTRACT, abi: clearingHouseAbi, functionName: 'deposit', args: [BigInt(data.circle.id), dRaw] },
              }).then((ok) => {
                if (ok) setDeposit('')
              })
            }}
          >
            {needsAllowance ? 'Step 2: Add collateral' : 'Add collateral'}
          </Button>
          {data.circle.paused && <p className="text-xs text-warn">Deposits are paused by the circle admin.</p>}
          <p className="text-xs text-muted">The allowance is for this exact amount only, so Clearcycle can never take more than you approve.</p>
        </div>
      </Card>

      <Card>
        <h3 className="font-display text-lg font-semibold">Withdraw collateral</h3>
        <p className="mb-4 text-sm text-muted">Sends USDC back to your wallet. Collateral that backs your open net payable stays locked until the cycle closes.</p>
        <AmountInput
          value={withdraw}
          onChange={setWithdraw}
          max={chain.withdrawable !== undefined ? formatUsdc(chain.withdrawable) : undefined}
          maxLabel={chain.withdrawable !== undefined ? `Free: ${usd(chain.withdrawable)} · Max` : undefined}
        />
        {overWithdraw && <p className="mt-2 text-xs text-danger">Only {usd(chain.withdrawable ?? 0n)} USDC is free right now.</p>}
        <Button
          className="mt-4 w-full"
          variant="secondary"
          disabled={wRaw === null || overWithdraw}
          loading={busy}
          onClick={() => {
            if (!CONTRACT || wRaw === null) return
            void run({
              kind: 'withdraw',
              label: `Withdraw ${usd(wRaw)} USDC`,
              circleId: data.circle.id,
              params: { amount: wRaw.toString() },
              call: { address: CONTRACT, abi: clearingHouseAbi, functionName: 'withdraw', args: [BigInt(data.circle.id), wRaw, address] },
            }).then((ok) => {
              if (ok) setWithdraw('')
            })
          }}
        >
          Withdraw to my wallet
        </Button>
      </Card>
    </div>
  )
}
