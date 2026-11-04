import { ArrowRight, Check, Clock, FileSpreadsheet, Landmark, ShieldCheck, X } from 'lucide-react'
import { ConnectButton, Logo } from '@/components/Shell'
import { Simulator } from '@/components/Simulator'
import { Link } from '@/lib/router'
import { useAccount } from 'wagmi'

const CYCLE = [
  ['Configure', 'An admin names the circle and sets the cycle length.'],
  ['Authorize', 'Members join and set how much each partner may invoice them without a click.'],
  ['Observe', 'Invoices are posted as obligations with a hash of the document.'],
  ['Trigger', 'Within policy they settle into the cycle at once. Others wait for the payer.'],
  ['Validate', 'The contract checks collateral covers each net payable, every time.'],
  ['Execute', 'When the cycle ends anyone can close it. No operator needed.'],
  ['Settle', 'Only the net difference changes hands, in USDC.'],
  ['Reconcile', 'A statement and a database check against the chain.'],
  ['Improve', 'Savings and auto-accept rates show which limits to raise.'],
] as const

const COMPARE = [
  { icon: FileSpreadsheet, old: 'Monthly spreadsheet, emailed around', now: 'One shared ledger every member can verify' },
  { icon: Landmark, old: 'A treasury team or bank acts as the netting center', now: 'A contract is the netting center. Nobody holds your funds but you' },
  { icon: Clock, old: 'Wire per invoice, days to land', now: 'One net transfer per member, final in under a second on Arc' },
] as const

export function Landing() {
  const { isConnected } = useAccount()
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <div className="flex items-center gap-2">
          <Link to="/help" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-muted hover:text-ink sm:block">
            How it works
          </Link>
          {isConnected ? (
            <Link to="/app" className="inline-flex min-h-10 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink">
              Open workspace
            </Link>
          ) : (
            <ConnectButton variant="secondary" />
          )}
        </div>
      </header>

      <section className="ledger-grid border-y border-line">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24">
          <p className="mb-4 inline-flex rounded-full border border-line bg-card px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] text-muted">
            Multilateral netting for company-to-company payables
          </p>
          <h1 className="max-w-4xl font-display text-5xl font-bold leading-[1.02] tracking-[-0.035em] sm:text-7xl">
            Pay the difference, not every invoice.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted">
            Companies that buy from and sell to each other settle a pile of crossing invoices every month. Clearcycle nets them each cycle and
            moves only what is left, in USDC on Arc. No netting center, no spreadsheet, and a statement both sides can verify.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link to="/app" className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-accent px-6 text-base font-semibold text-accent-ink shadow-lift transition hover:brightness-110">
              Open workspace <ArrowRight className="size-4" />
            </Link>
            <a href="#demo" className="inline-flex min-h-12 items-center rounded-xl border border-line bg-card px-6 text-base font-semibold hover:bg-paper">
              Try it with your numbers
            </a>
          </div>
        </div>
      </section>

      <section id="demo" className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <h2 className="mb-2 font-display text-3xl font-bold tracking-tight">Change an invoice. Watch the payments disappear.</h2>
        <p className="mb-8 max-w-2xl text-muted">A ring of invoices between four companies. Edit the amounts or add your own.</p>
        <Simulator />
      </section>

      <section className="border-y border-line bg-card">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <h2 className="mb-8 font-display text-3xl font-bold tracking-tight">The month-end scramble, replaced</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {COMPARE.map((c) => (
              <div key={c.old} className="rounded-2xl border border-line bg-paper/50 p-5">
                <c.icon className="size-5 text-accent" />
                <p className="mt-4 flex items-start gap-2 text-sm text-muted">
                  <X className="mt-0.5 size-4 shrink-0 text-danger" /> {c.old}
                </p>
                <p className="mt-2 flex items-start gap-2 text-sm font-medium">
                  <Check className="mt-0.5 size-4 shrink-0 text-ok" /> {c.now}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <h2 className="mb-2 font-display text-3xl font-bold tracking-tight">A cycle runs itself</h2>
        <p className="mb-8 max-w-2xl text-muted">Nobody needs to approve a payment run. People set the rules once, then the cycle does the rest.</p>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CYCLE.map(([name, text], i) => (
            <li key={name} className="rounded-xl border border-line bg-card p-4">
              <p className="font-mono text-xs text-muted">{String(i + 1).padStart(2, '0')}</p>
              <p className="mt-1 font-display text-lg font-semibold">{name}</p>
              <p className="mt-1 text-sm text-muted">{text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-line bg-ink text-paper">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-tight">Why it lives on Arc</h2>
            <ul className="mt-6 space-y-4 text-paper/80">
              <li>
                <strong className="text-paper">USDC is the money and the gas.</strong> Members need one asset for collateral, settlement and fees.
              </li>
              <li>
                <strong className="text-paper">Final in under a second.</strong> A cycle closes and credits are withdrawable immediately.
              </li>
              <li>
                <strong className="text-paper">Predictable fees.</strong> Posting hundreds of invoices does not turn into a gas-price problem.
              </li>
            </ul>
          </div>
          <div className="rounded-2xl bg-paper/10 p-6">
            <ShieldCheck className="size-6 text-emerald-300" />
            <h3 className="mt-3 font-display text-xl font-semibold">Your funds, your rules</h3>
            <p className="mt-2 text-sm text-paper/75">
              The contract has no owner, no fee switch and no upgrade key. It will only let a company withdraw collateral that is not needed to
              cover what it owes in the open cycle. The database makes the app fast, but the chain decides every balance.
            </p>
            <Link to="/app" className="mt-5 inline-flex min-h-10 items-center rounded-lg bg-paper px-4 text-sm font-semibold text-ink">
              Start a circle
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
