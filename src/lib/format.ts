import { formatUnitsFixed, parseUsdc } from '@/onchain-money'

export const shortAddr = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`

/** "1,234.50" from a raw 6-decimal USDC string or bigint. Always 2+ places, never a float. */
export function usd(raw: string | bigint, fractionDigits = 2): string {
  const value = typeof raw === 'bigint' ? raw : BigInt(raw)
  const negative = value < 0n
  const abs = negative ? -value : value
  const fixed = formatUnitsFixed(abs, 6, fractionDigits)
  const [whole = '0', frac] = fixed.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${grouped}${frac !== undefined ? `.${frac}` : ''}`
}

/** Parse user input to raw USDC base units, or null when the text is not a positive amount. */
export function tryParseUsdc(text: string): bigint | null {
  const t = text.trim()
  if (!/^\d*\.?\d+$|^\d+\.?$/.test(t)) return null
  try {
    const v = parseUsdc(t.endsWith('.') ? t.slice(0, -1) : t)
    return v > 0n ? v : null
  } catch {
    return null
  }
}

export function relTime(input: string | number | Date): string {
  const t = input instanceof Date ? input.getTime() : typeof input === 'number' ? input * 1000 : Date.parse(input)
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function countdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return 'ended'
  const d = Math.floor(secondsLeft / 86400)
  const h = Math.floor((secondsLeft % 86400) / 3600)
  const m = Math.floor((secondsLeft % 3600) / 60)
  const s = secondsLeft % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${String(s).padStart(2, '0')}s`
}

export function durationLabel(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400} day${seconds === 86400 ? '' : 's'}`
  if (seconds % 3600 === 0) return `${seconds / 3600} hour${seconds === 3600 ? '' : 's'}`
  return `${Math.round(seconds / 60)} min`
}

export const sameAddr = (a?: string | null, b?: string | null): boolean =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase()
