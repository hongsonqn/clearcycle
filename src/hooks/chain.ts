/** Canonical (ONCHAIN) reads for the connected wallet. Money shown to its owner comes from here. */
import { erc20Abi } from 'viem'
import { useAccount, useReadContract } from 'wagmi'
import { clearingHouseAbi } from '@/lib/abi'
import { CHAIN_ID, CONTRACT, USDC_ADDRESS } from '@/lib/env'

const REFRESH = 5000

export function useCircleChain(circleId: string | undefined) {
  const { address } = useAccount()
  const enabled = !!circleId && !!address && !!CONTRACT
  const id = BigInt(circleId ?? '0')
  const base = { address: CONTRACT, abi: clearingHouseAbi, chainId: CHAIN_ID } as const
  const query = { enabled, refetchInterval: REFRESH }

  const balance = useReadContract({ ...base, functionName: 'balanceOf', args: [id, address as `0x${string}`], query })
  const net = useReadContract({ ...base, functionName: 'netPositionOf', args: [id, address as `0x${string}`], query })
  const withdrawable = useReadContract({ ...base, functionName: 'withdrawableOf', args: [id, address as `0x${string}`], query })
  const cycleEnd = useReadContract({ ...base, functionName: 'cycleEndsAt', args: [id], query: { enabled: !!circleId && !!CONTRACT, refetchInterval: REFRESH } })
  const usdcBalance = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    chainId: CHAIN_ID,
    functionName: 'balanceOf',
    args: [address as `0x${string}`],
    query,
  })
  const allowance = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    chainId: CHAIN_ID,
    functionName: 'allowance',
    args: [address as `0x${string}`, CONTRACT as `0x${string}`],
    query,
  })

  return {
    balance: balance.data,
    net: net.data,
    withdrawable: withdrawable.data,
    cycleEnd: cycleEnd.data,
    usdcBalance: usdcBalance.data,
    allowance: allowance.data,
    loading: balance.isLoading || net.isLoading,
    error: balance.error ?? net.error ?? null,
  }
}
