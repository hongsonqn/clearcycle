import { arcTestnet } from 'viem/chains'
import { getUsdc } from '@/onchain-facts'

/** The deployed ClearingHouse. Public values come from .env (VITE_ prefix), never from literals. */
export const CHAIN_ID = arcTestnet.id
export const CONTRACT = import.meta.env.VITE_CLEARCYCLE_ADDRESS as `0x${string}` | undefined
export const DEPLOY_BLOCK = import.meta.env.VITE_CLEARCYCLE_DEPLOY_BLOCK as string | undefined

const usdcFact = getUsdc(CHAIN_ID)
if (!usdcFact) throw new Error('USDC is not registered for Arc Testnet')
export const USDC_ADDRESS = usdcFact.address as `0x${string}`
