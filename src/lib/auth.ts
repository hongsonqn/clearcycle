/**
 * Read-access proof for private invoice documents. A signed, expiring message that authorizes
 * nothing onchain: it only proves the caller controls an address.
 */
export const AUTH_TTL_MS = 12 * 60 * 60 * 1000

export function authMessage(address: string, issuedAt: string): string {
  return [
    'Clearcycle sign-in',
    `Address: ${address.toLowerCase()}`,
    `Issued: ${issuedAt}`,
    'Valid for 12 hours. This signature cannot move funds or approve any transaction.',
  ].join('\n')
}

export interface AuthToken {
  address: string
  issuedAt: string
  signature: string
}

export function encodeToken(token: AuthToken): string {
  return btoa(JSON.stringify(token))
}

export function decodeToken(header: string): AuthToken | null {
  try {
    const parsed: unknown = JSON.parse(atob(header))
    if (parsed === null || typeof parsed !== 'object') return null
    const o = parsed as Record<string, unknown>
    if (typeof o.address !== 'string' || typeof o.issuedAt !== 'string' || typeof o.signature !== 'string') return null
    return { address: o.address, issuedAt: o.issuedAt, signature: o.signature }
  } catch {
    return null
  }
}
