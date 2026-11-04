/**
 * Server configuration. Everything is read from the environment (Bun loads .env).
 * Public values use the VITE_ prefix so the UI and API can never disagree about them.
 */
import { defineChain, getAddress, isAddress, type Address } from 'viem'
import { getChain, getUsdc } from '../src/onchain-facts'

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable ${name}`)
  return value
}

const chainId = Number(process.env.VITE_CLEARCYCLE_CHAIN_ID ?? '5042002')
const rawAddress = required('VITE_CLEARCYCLE_ADDRESS')
if (!isAddress(rawAddress)) throw new Error('VITE_CLEARCYCLE_ADDRESS is not a valid address')

const registryChain = getChain(chainId)

/** Arc Studio's keyed RPC proxy when it covers this chain, else a public RPC from the registry. */
function resolveRpcUrl(): { url: string; source: 'override' | 'proxy' | 'public' } {
  const override = process.env.CLEARCYCLE_RPC_URL
  if (override) return { url: override, source: 'override' }
  const proxyChains = (process.env.RPC_PROXY_CHAINS ?? '').split(',')
  const compassKey = 'Arc_Testnet'
  if (
    chainId === 5042002 &&
    process.env.RPC_PROXY_BASE_URL &&
    process.env.RPC_PROXY_TOKEN &&
    proxyChains.includes(compassKey)
  ) {
    return {
      url: `${process.env.RPC_PROXY_BASE_URL}/api/rpc/${compassKey}?_rpc_token=${process.env.RPC_PROXY_TOKEN}`,
      source: 'proxy',
    }
  }
  const publicUrl = registryChain?.rpcUrls[0]
  if (!publicUrl) throw new Error(`No RPC URL for chain ${chainId}; set CLEARCYCLE_RPC_URL`)
  return { url: publicUrl, source: 'public' }
}

const rpc = resolveRpcUrl()

export const config = {
  chainId,
  contract: getAddress(rawAddress) as Address,
  deployBlock: BigInt(required('VITE_CLEARCYCLE_DEPLOY_BLOCK')),
  usdc: (getUsdc(chainId)?.address ?? process.env.CLEARCYCLE_USDC_ADDRESS) as Address | undefined,
  databaseUrl: required('DATABASE_URL'),
  port: Number(process.env.API_PORT ?? '3001'),
  rpcUrl: rpc.url,
  rpcSource: rpc.source,
  /** Blocks behind head the indexer waits before ingesting. Arc finality is deterministic, so 0. */
  confirmations: BigInt(process.env.INDEXER_CONFIRMATIONS ?? '0'),
  /** Blocks rolled back when the stored checkpoint hash no longer matches the chain. */
  reorgDepth: BigInt(process.env.INDEXER_REORG_DEPTH ?? '32'),
  /** Upper bound of one eth_getLogs request. */
  maxRange: BigInt(process.env.INDEXER_MAX_RANGE ?? '1000'),
  pollMs: Number(process.env.INDEXER_POLL_MS ?? '2000'),
}

export const chain = defineChain({
  id: chainId,
  name: registryChain?.name ?? `Chain ${chainId}`,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: registryChain?.nativeCurrency.decimals ?? 18 },
  rpcUrls: { default: { http: [rpc.url] } },
})
