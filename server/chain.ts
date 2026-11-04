/** Blockchain adapter: the only module that talks to the RPC. Read-only, no keys. */
import { createPublicClient, http } from 'viem'
import { clearingHouseAbi } from '../src/lib/abi'
import { chain, config } from './config'

export const client = createPublicClient({
  chain,
  transport: http(config.rpcUrl, { retryCount: 3, retryDelay: 400, timeout: 15_000 }),
})

export const contractRef = { address: config.contract, abi: clearingHouseAbi } as const

const erc20BalanceAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

export async function readUsdcBalanceOfContract(): Promise<bigint | undefined> {
  if (!config.usdc) return undefined
  return client.readContract({
    address: config.usdc,
    abi: erc20BalanceAbi,
    functionName: 'balanceOf',
    args: [config.contract],
  })
}
