import { useCallback } from 'react'
import { useAccount, useSignMessage } from 'wagmi'
import { AUTH_TTL_MS, authMessage, encodeToken, type AuthToken } from '@/lib/auth'

const keyFor = (address: string): string => `clearcycle:auth:${address.toLowerCase()}`

function readValid(address: string): string | null {
  try {
    const raw = sessionStorage.getItem(keyFor(address))
    if (!raw) return null
    const token = JSON.parse(raw) as AuthToken
    if (Date.now() - Date.parse(token.issuedAt) > AUTH_TTL_MS - 60_000) return null
    return encodeToken(token)
  } catch {
    return null
  }
}

/** Wallet sign-in for private invoice documents. The signature cannot move funds. */
export function useSession() {
  const { address } = useAccount()
  const { signMessageAsync } = useSignMessage()

  const signIn = useCallback(async (): Promise<string> => {
    if (!address) throw new Error('Connect your wallet first.')
    const existing = readValid(address)
    if (existing) return existing
    const issuedAt = new Date().toISOString()
    const signature = await signMessageAsync({ message: authMessage(address, issuedAt) })
    const token: AuthToken = { address, issuedAt, signature }
    sessionStorage.setItem(keyFor(address), JSON.stringify(token))
    return encodeToken(token)
  }, [address, signMessageAsync])

  const signedIn = address ? readValid(address) !== null : false
  return { signIn, signedIn }
}
