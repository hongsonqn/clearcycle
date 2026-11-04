/** Pure multilateral netting math. Used by the SIMULATED landing demo and the close-cycle preview. */

export interface Flow {
  payer: string
  payee: string
  amount: bigint
}

export interface NettingResult {
  /** Net position per participant. Credits positive, debits negative. Always sums to zero. */
  positions: Map<string, bigint>
  gross: bigint
  /** Total USDC that effectively changes hands when only nets settle. */
  netVolume: bigint
  /** Fewest-ish transfers that realise the net positions (greedy largest-first matching). */
  transfers: Flow[]
  grossTransfers: number
}

export function netFlows(flows: Flow[]): NettingResult {
  const positions = new Map<string, bigint>()
  let gross = 0n
  for (const f of flows) {
    if (f.amount <= 0n || f.payer === f.payee) continue
    gross += f.amount
    positions.set(f.payer, (positions.get(f.payer) ?? 0n) - f.amount)
    positions.set(f.payee, (positions.get(f.payee) ?? 0n) + f.amount)
  }
  let netVolume = 0n
  const creditors: { who: string; amt: bigint }[] = []
  const debtors: { who: string; amt: bigint }[] = []
  for (const [who, amt] of positions) {
    if (amt > 0n) {
      netVolume += amt
      creditors.push({ who, amt })
    } else if (amt < 0n) debtors.push({ who, amt: -amt })
  }
  creditors.sort((a, b) => (a.amt < b.amt ? 1 : -1))
  debtors.sort((a, b) => (a.amt < b.amt ? 1 : -1))
  const transfers: Flow[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i]
    const c = creditors[j]
    if (!d || !c) break
    const pay = d.amt < c.amt ? d.amt : c.amt
    transfers.push({ payer: d.who, payee: c.who, amount: pay })
    d.amt -= pay
    c.amt -= pay
    if (d.amt === 0n) i += 1
    if (c.amt === 0n) j += 1
  }
  return {
    positions,
    gross,
    netVolume,
    transfers,
    grossTransfers: flows.filter((f) => f.amount > 0n && f.payer !== f.payee).length,
  }
}

/** Percentage of gross volume that never has to move, 0-100, one decimal. */
export function savingsPct(gross: bigint, netVolume: bigint): number {
  if (gross <= 0n) return 0
  return Number(((gross - netVolume) * 1000n) / gross) / 10
}
