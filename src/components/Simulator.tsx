import { ArrowRight, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { SourceTag } from '@/components/ui'
import { usd } from '@/lib/format'
import { netFlows, savingsPct, type Flow } from '@/lib/netting'

const NAMES = ['Northwind', 'Brightline', 'Cobalt', 'Delta']

interface Row {
  id: number
  payer: string
  payee: string
  amount: string
}

const START: Row[] = [
  { id: 1, payer: 'Northwind', payee: 'Brightline', amount: '48000' },
  { id: 2, payer: 'Brightline', payee: 'Cobalt', amount: '41000' },
  { id: 3, payer: 'Cobalt', payee: 'Northwind', amount: '37000' },
  { id: 4, payer: 'Delta', payee: 'Northwind', amount: '12000' },
  { id: 5, payer: 'Brightline', payee: 'Delta', amount: '15500' },
  { id: 6, payer: 'Cobalt', payee: 'Delta', amount: '9000' },
]

const toRaw = (s: string): bigint => {
  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n * 100)) * 10_000n : 0n
}

export function Simulator() {
  const [rows, setRows] = useState<Row[]>(START)
  const [nextId, setNextId] = useState(START.length + 1)

  const flows: Flow[] = rows.map((r) => ({ payer: r.payer, payee: r.payee, amount: toRaw(r.amount) }))
  const result = netFlows(flows)
  const saved = savingsPct(result.gross, result.netVolume)
  const maxAbs = [...result.positions.values()].reduce((m, v) => (v < 0n ? (-v > m ? -v : m) : v > m ? v : m), 1n)

  const update = (id: number, patch: Partial<Row>): void => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
      <div className="rounded-2xl border border-line bg-card p-5 shadow-card">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-lg font-semibold">What companies owe each other this cycle</h3>
            <SourceTag source="SIMULATED" />
          </div>
        </div>
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="grid grid-cols-[1fr_auto_1fr_7rem_auto] items-center gap-2">
              <select
                aria-label="Payer"
                value={r.payer}
                onChange={(e) => update(r.id, { payer: e.target.value })}
                className="min-w-0 rounded-lg border border-line bg-paper/60 px-2 py-2 text-sm"
              >
                {NAMES.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
              <ArrowRight className="size-4 text-muted" aria-label="owes" />
              <select
                aria-label="Payee"
                value={r.payee}
                onChange={(e) => update(r.id, { payee: e.target.value })}
                className="min-w-0 rounded-lg border border-line bg-paper/60 px-2 py-2 text-sm"
              >
                {NAMES.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
              <input
                aria-label="Amount in USDC"
                inputMode="decimal"
                value={r.amount}
                onChange={(e) => update(r.id, { amount: e.target.value.replace(/[^0-9.]/g, '') })}
                className="num w-full rounded-lg border border-line bg-paper/60 px-2 py-2 text-right text-sm"
              />
              <button aria-label="Remove invoice" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} className="rounded p-2 text-muted hover:bg-ink/5">
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => {
            setRows((rs) => [...rs, { id: nextId, payer: 'Northwind', payee: 'Cobalt', amount: '10000' }])
            setNextId((n) => n + 1)
          }}
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
        >
          <Plus className="size-4" /> Add an invoice
        </button>
      </div>

      <div className="rounded-2xl border border-line bg-ink p-5 text-paper shadow-lift">
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-paper/60">Money that actually moves</p>
        <div className="mt-2 flex items-end gap-3">
          <p className="num font-display text-5xl font-bold">{saved.toFixed(0)}%</p>
          <p className="pb-2 text-sm text-paper/70">less than paying every invoice</p>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-paper/10 p-3">
            <p className="text-paper/60">Paid one by one</p>
            <p className="num mt-1 font-display text-xl font-semibold">{result.grossTransfers} payments</p>
            <p className="num text-paper/70">${usd(result.gross, 0)}</p>
          </div>
          <div className="rounded-xl bg-accent p-3 text-accent-ink">
            <p className="opacity-80">Netted by Clearcycle</p>
            <p className="num mt-1 font-display text-xl font-semibold">{result.transfers.length} payments</p>
            <p className="num opacity-90">${usd(result.netVolume, 0)}</p>
          </div>
        </div>
        <div className="mt-5 space-y-2">
          {[...result.positions.entries()].map(([who, v]) => (
            <div key={who} className="grid grid-cols-[5.5rem_1fr_6rem] items-center gap-3 text-sm">
              <span className="truncate text-paper/80">{who}</span>
              <div className="h-2 overflow-hidden rounded-full bg-paper/10">
                <div
                  className={`h-full rounded-full ${v >= 0n ? 'bg-emerald-300' : 'bg-amber-300'}`}
                  style={{ width: `${Number((v < 0n ? -v : v) * 100n / maxAbs)}%` }}
                />
              </div>
              <span className="num text-right">{v >= 0n ? '+' : '-'}${usd(v < 0n ? -v : v, 0)}</span>
            </div>
          ))}
        </div>
        <p className="mt-5 text-xs text-paper/60">
          Illustration only. In Clearcycle each company posts collateral for its net payable and the contract settles the result on Arc.
        </p>
      </div>
    </div>
  )
}
