/**
 * Invoice documents are OFFCHAIN and content-addressed: the bytes32 `ref` stored onchain with an
 * obligation is keccak256 of the canonical JSON below. Anyone holding the document can prove it is
 * the one the counterparties agreed to; the server cannot swap it without breaking the hash.
 */
import { isAddress, keccak256, toBytes, type Hex } from 'viem'

export interface InvoiceDocument {
  version: 1
  circleId: string
  payer: string
  payee: string
  number: string
  amount: string
  currency: 'USDC'
  issued: string
  description: string
}

const MAX_TEXT = 500

/** Deterministic JSON: keys sorted recursively, no whitespace. */
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function hashDocument(doc: InvoiceDocument): Hex {
  return keccak256(toBytes(canonicalize(doc)))
}

/** Returns a normalized document or a human-readable error. */
export function parseInvoiceDocument(input: unknown): InvoiceDocument | string {
  if (input === null || typeof input !== 'object') return 'Document must be an object'
  const o = input as Record<string, unknown>
  const text = (key: string, max = MAX_TEXT): string | null =>
    typeof o[key] === 'string' && (o[key]).trim().length > 0 && (o[key]).length <= max
      ? (o[key]).trim()
      : null
  if (o.version !== 1) return 'Unsupported document version'
  const circleId = text('circleId', 20)
  const number = text('number', 80)
  const description = text('description')
  const issued = text('issued', 10)
  const amount = text('amount', 30)
  const payer = text('payer', 42)
  const payee = text('payee', 42)
  if (!circleId || !/^\d+$/.test(circleId)) return 'circleId must be a number'
  if (!number) return 'Invoice number is required'
  if (!description) return 'Description is required'
  if (!issued || !/^\d{4}-\d{2}-\d{2}$/.test(issued)) return 'Issue date must be YYYY-MM-DD'
  if (!amount || !/^\d+(\.\d{1,6})?$/.test(amount)) return 'Amount must be a USDC decimal with up to 6 places'
  if (!payer || !isAddress(payer) || !payee || !isAddress(payee)) return 'Payer and payee must be addresses'
  if (o.currency !== 'USDC') return 'Only USDC is supported'
  return {
    version: 1,
    circleId,
    payer: payer.toLowerCase(),
    payee: payee.toLowerCase(),
    number,
    amount,
    currency: 'USDC',
    issued,
    description,
  }
}
