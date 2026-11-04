import { Shell } from '@/components/Shell'
import { Card } from '@/components/ui'
import { Link } from '@/lib/router'

const FAQ: [string, string][] = [
  ['What does netting mean here?', "If A owes B 100, B owes C 100 and C owes A 100, nobody needs to pay anyone. Clearcycle adds up every accepted invoice in a cycle and settles only each member's net difference."],
  ['Why do I post collateral?', 'So the other side can trust the netted result. The contract makes sure your collateral always covers what you will owe after netting. If it would not, the invoice cannot be accepted.'],
  ['Who runs the cycle?', 'Nobody. When the cycle length has passed, anyone can close it. Until it is closed, new invoices wait, so every invoice belongs to a real calendar period.'],
  ['What is an auto-accept rule?', 'A limit you set for one partner. Invoices from them inside the limit are accepted the moment they are sent. Everything else waits for you.'],
  ['Can an invoice be reversed?', 'Not once accepted. To correct one, the other side issues a credit note, which is just an invoice the opposite way, and the two net against each other.'],
  ['Are my invoices public?', 'No. Only a fingerprint of the document is written onchain. The text is stored privately and only the two parties can read it, after signing a message that cannot move funds.'],
  ['What if the website database is wrong or lost?', "Balances shown to you come from the contract. Lists and statements come from a database rebuilt from the chain's event log, and the Integrity tab compares the two."],
  ['Which currencies?', 'USDC only for now. Multi-currency netting with FX is a natural next step but is not built.'],
]

export function Help() {
  return (
    <Shell>
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Help</h1>
          <p className="text-sm text-muted">The short version of how a cycle works.</p>
        </div>
        <Card>
          <h2 className="mb-3 font-display text-lg font-semibold">Try it with two wallets in about five minutes</h2>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-muted">
            <li>
              Get test USDC for both wallets with <strong className="text-ink">Get test USDC</strong> in the Arc Studio sidebar.
            </li>
            <li>
              With wallet A, <Link to="/app" className="font-semibold text-accent">create a circle</Link> with a 1-hour cycle and invite wallet B.
            </li>
            <li>
              With wallet B, open the Workspace and join. Both add collateral under <em>Collateral</em>.
            </li>
            <li>B sets an auto-accept rule for A, then A sends B an invoice. It settles into the cycle immediately.</li>
            <li>
              B invoices A for a smaller amount. Look at <em>Overview</em>: only the difference would move.
            </li>
            <li>
              When the hour ends, anyone closes the cycle. Check <em>Statements</em> and run <em>Integrity</em>.
            </li>
          </ol>
        </Card>
        {FAQ.map(([q, a]) => (
          <Card key={q}>
            <h3 className="font-display text-base font-semibold">{q}</h3>
            <p className="mt-1 text-sm text-muted">{a}</p>
          </Card>
        ))}
        <Card>
          <h2 className="mb-2 font-display text-lg font-semibold">Good to know</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted">
            <li>Everything runs on Arc Testnet with test funds.</li>
            <li>Collateral is held by one shared contract. If the USDC issuer froze that address, withdrawals for every circle would be blocked until it was lifted.</li>
            <li>An action can be confirmed onchain a few seconds before it shows in lists. The activity tray shows which stage it is at.</li>
          </ul>
        </Card>
      </div>
    </Shell>
  )
}
