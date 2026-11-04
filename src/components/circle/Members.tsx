import { useQuery } from '@tanstack/react-query'
import { Pause, Play, Shield, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { isAddress } from 'viem'
import { useAccount } from 'wagmi'
import { AmountInput, Address, Badge, Button, Card, Field, Modal, SourceTag, inputCls } from '@/components/ui'
import { useTx } from '@/hooks/tx'
import { clearingHouseAbi } from '@/lib/abi'
import { api, type CircleDetail, type Member } from '@/lib/api'
import { CONTRACT } from '@/lib/env'
import { sameAddr, shortAddr, tryParseUsdc, usd } from '@/lib/format'
import { formatUsdc } from '@/onchain-money'

function PolicyModal({ circleId, payee, current, onClose }: { circleId: string; payee: string | null; current: { per_obligation: string; per_cycle: string } | undefined; onClose: () => void }) {
  const { run, busy } = useTx()
  const [perObl, setPerObl] = useState(current ? formatUsdc(BigInt(current.per_obligation)) : '')
  const [perCycle, setPerCycle] = useState(current ? formatUsdc(BigInt(current.per_cycle)) : '')
  const a = tryParseUsdc(perObl)
  const b = tryParseUsdc(perCycle)
  const valid = a !== null && b !== null && b >= a
  const save = async (obl: bigint, cyc: bigint, label: string): Promise<void> => {
    if (!CONTRACT || !payee) return
    const ok = await run({
      kind: 'setPolicy',
      label,
      circleId,
      params: { payee, perObligation: obl.toString(), perCycle: cyc.toString() },
      call: { address: CONTRACT, abi: clearingHouseAbi, functionName: 'setPolicy', args: [BigInt(circleId), payee, obl, cyc] },
    })
    if (ok) onClose()
  }
  return (
    <Modal open={!!payee} title={`Auto-accept rule for ${payee ? shortAddr(payee) : ''}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          When this member invoices you inside these limits, the invoice is accepted the moment it is sent, as long as your collateral covers it. Anything above the limits waits for you.
        </p>
        <Field label="Largest single invoice">
          <AmountInput value={perObl} onChange={setPerObl} />
        </Field>
        <Field label="Total per cycle" error={a !== null && b !== null && b < a ? 'The cycle total must be at least the single-invoice limit.' : null}>
          <AmountInput value={perCycle} onChange={setPerCycle} />
        </Field>
        <Button className="w-full" disabled={!valid} loading={busy} onClick={() => void save(a ?? 0n, b ?? 0n, `Set auto-accept rule for ${shortAddr(payee ?? '0x0000000000000000')}`)}>
          Save rule
        </Button>
        {current && (
          <Button variant="danger" className="w-full" loading={busy} onClick={() => void save(0n, 0n, 'Turn off auto-accept')}>
            Turn off auto-accept
          </Button>
        )}
      </div>
    </Modal>
  )
}

export function Members({ data, isMember, isAdmin }: { data: CircleDetail; isMember: boolean; isAdmin: boolean }) {
  const { address } = useAccount()
  const { run, busy } = useTx()
  const [invitee, setInvitee] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const policies = useQuery({ queryKey: ['policies', data.circle.id], queryFn: () => api.policies(data.circle.id), refetchInterval: 8000 })
  const circleId = BigInt(data.circle.id)
  const active = data.members.filter((m) => m.status === 'member')
  const invited = data.members.filter((m) => m.status === 'invited')
  const inviteOk = isAddress(invitee) && !data.members.some((m) => sameAddr(m.address, invitee))

  const call = (fn: string, args: readonly unknown[], kind: string, label: string) =>
    CONTRACT && run({ kind, label, circleId: data.circle.id, call: { address: CONTRACT, abi: clearingHouseAbi, functionName: fn, args } })

  const myRules = (payee: string) => policies.data?.items.find((p) => sameAddr(p.payer, address) && sameAddr(p.payee, payee))
  const theirRule = (payer: string) => policies.data?.items.find((p) => sameAddr(p.payer, payer) && sameAddr(p.payee, address))

  const row = (m: Member) => {
    const me = sameAddr(m.address, address)
    const mine = myRules(m.address)
    const theirs = theirRule(m.address)
    return (
      <tr key={m.address} className="border-t border-line">
        <td className="py-3 pr-3">
          <div className="flex items-center gap-2">
            <Address value={m.address} />
            {me && <Badge tone="ok">You</Badge>}
            {sameAddr(m.address, data.circle.admin) && <Badge tone="neutral">Admin</Badge>}
          </div>
        </td>
        <td className="num py-3 pr-3 text-right text-sm">{usd(m.balance)}</td>
        <td className="py-3 pr-3 text-sm text-muted">
          {mine ? `Up to ${usd(mine.per_obligation)} each, ${usd(mine.per_cycle)} per cycle` : me ? '' : 'Review each invoice'}
        </td>
        <td className="py-3 pr-3 text-sm text-muted">{!me && theirs ? `They accept up to ${usd(theirs.per_obligation)}` : ''}</td>
        <td className="py-3 text-right">
          {isMember && !me && (
            <Button variant="secondary" className="min-h-8 px-3 text-xs" onClick={() => setEditing(m.address)}>
              {mine ? 'Edit rule' : 'Set rule'}
            </Button>
          )}
        </td>
      </tr>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="mb-4 flex items-center gap-2">
          <h2 className="font-display text-lg font-semibold">Members and auto-accept rules</h2>
          <SourceTag source="INDEXED" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left">
            <thead>
              <tr className="text-xs uppercase tracking-[0.08em] text-muted">
                <th className="pb-2 font-medium">Member</th>
                <th className="pb-2 pr-3 text-right font-medium">Collateral</th>
                <th className="pb-2 font-medium">Your rule for them</th>
                <th className="pb-2 font-medium">Their rule for you</th>
                <th />
              </tr>
            </thead>
            <tbody>{active.map(row)}</tbody>
          </table>
        </div>
        {isMember && (
          <p className="mt-4 flex items-start gap-2 rounded-lg bg-paper p-3 text-xs text-muted">
            <Shield className="mt-0.5 size-3.5 shrink-0" /> Rules are narrow on purpose: one member, a per-invoice cap, a per-cycle cap. They never let anyone take more than your collateral covers, and you can turn one off at any time.
          </p>
        )}
      </Card>

      {isAdmin && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h3 className="font-display text-lg font-semibold">Invite a company</h3>
            <p className="mb-3 text-sm text-muted">Enter the wallet address they will use. They must accept by joining, so nobody can be added against their will.</p>
            <Field label="Wallet address" error={invitee && !isAddress(invitee) ? 'That is not a valid address.' : null}>
              <input className={`${inputCls} font-mono`} value={invitee} onChange={(e) => setInvitee(e.target.value.trim())} placeholder="0x…" spellCheck={false} />
            </Field>
            <Button
              className="mt-3 w-full"
              disabled={!inviteOk}
              loading={busy}
              onClick={() => {
                void call('inviteMember', [circleId, invitee], 'invite', `Invite ${shortAddr(invitee)}`)?.then((ok) => {
                  if (ok) setInvitee('')
                })
              }}
            >
              <UserPlus className="size-4" /> Send invite
            </Button>
            {invited.length > 0 && (
              <ul className="mt-4 space-y-2 border-t border-line pt-3">
                {invited.map((m) => (
                  <li key={m.address} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2">
                      <Address value={m.address} /> <Badge tone="warn">Invited</Badge>
                    </span>
                    <Button variant="ghost" className="min-h-8 px-2 text-xs" disabled={busy} onClick={() => void call('revokeInvite', [circleId, m.address], 'revokeInvite', 'Revoke invite')}>
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h3 className="font-display text-lg font-semibold">Circle controls</h3>
            <p className="mb-3 text-sm text-muted">
              Pausing stops new invoices, acceptances and deposits. Withdrawals and closing a cycle always keep working, so a pause can never trap anyone's funds.
            </p>
            <Button variant={data.circle.paused ? 'primary' : 'secondary'} className="w-full" loading={busy} onClick={() => void call('setPaused', [circleId, !data.circle.paused], 'pause', data.circle.paused ? 'Resume circle' : 'Pause new activity')}>
              {data.circle.paused ? <Play className="size-4" /> : <Pause className="size-4" />}
              {data.circle.paused ? 'Resume new activity' : 'Pause new activity'}
            </Button>
          </Card>
        </div>
      )}

      {isMember && !isAdmin && (
        <Card>
          <h3 className="font-display text-lg font-semibold">Leave this circle</h3>
          <p className="mb-3 text-sm text-muted">Withdraw your collateral first and wait until your net position for the open cycle is zero.</p>
          <Button variant="danger" loading={busy} onClick={() => void call('leave', [circleId], 'leave', 'Leave circle')}>
            Leave circle
          </Button>
        </Card>
      )}

      <PolicyModal key={editing ?? 'none'} circleId={data.circle.id} payee={editing} current={editing ? myRules(editing) : undefined} onClose={() => setEditing(null)} />
    </div>
  )
}
