import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { FileText, ShieldCheck, Zap } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'
import { Address, Badge, Button, Card, Empty, ErrorNote, Field, Modal, Skeleton, SourceTag, AmountInput, inputCls } from '@/components/ui'
import { useCircleChain } from '@/hooks/chain'
import { useSession } from '@/hooks/session'
import { useTx } from '@/hooks/tx'
import { clearingHouseAbi } from '@/lib/abi'
import { api, type CircleDetail, type ObligationItem } from '@/lib/api'
import { hashDocument, parseInvoiceDocument, type InvoiceDocument } from '@/lib/canonical'
import { CONTRACT } from '@/lib/env'
import { describeError } from '@/lib/errors'
import { relTime, sameAddr, shortAddr, tryParseUsdc, usd } from '@/lib/format'

const FILTERS = [
  ['', 'All'],
  ['proposed', 'Awaiting payer'],
  ['accepted', 'Accepted'],
  ['expired', 'Expired'],
] as const

function statusBadge(o: ObligationItem) {
  if (o.status === 'accepted') return o.automatic ? <Badge tone="ok">Auto-accepted</Badge> : <Badge tone="ok">Accepted</Badge>
  if (o.status === 'proposed') return o.expired ? <Badge tone="neutral">Expired</Badge> : <Badge tone="warn">Awaiting payer</Badge>
  if (o.status === 'rejected') return <Badge tone="danger">Rejected</Badge>
  return <Badge tone="neutral">Cancelled</Badge>
}

function DocumentModal({ refHash, onClose }: { refHash: string | null; onClose: () => void }) {
  const { signIn } = useSession()
  const q = useQuery({
    queryKey: ['doc', refHash],
    enabled: !!refHash,
    retry: false,
    queryFn: async () => {
      const auth = await signIn()
      const res = await api.document(refHash as string, auth)
      const parsed = parseInvoiceDocument(res.document)
      const verified = typeof parsed !== 'string' && hashDocument(parsed).toLowerCase() === (refHash as string).toLowerCase()
      return { doc: typeof parsed === 'string' ? null : parsed, verified }
    },
  })
  return (
    <Modal open={!!refHash} title="Invoice document" onClose={onClose}>
      {q.isLoading ? (
        <p className="text-sm text-muted">Sign the message in your wallet to read this private document.</p>
      ) : q.error ? (
        <ErrorNote message={describeError(q.error).message} />
      ) : q.data?.doc ? (
        <div className="space-y-3 text-sm">
          <p className={`flex items-center gap-2 rounded-lg p-3 ${q.data.verified ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'}`}>
            <ShieldCheck className="size-4" />
            {q.data.verified ? 'This document matches the hash stored onchain.' : 'WARNING: this document does not match the onchain hash. Do not trust it.'}
          </p>
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2">
            <dt className="text-muted">Invoice</dt>
            <dd className="font-semibold">{q.data.doc.number}</dd>
            <dt className="text-muted">Amount</dt>
            <dd className="num font-semibold">{q.data.doc.amount} USDC</dd>
            <dt className="text-muted">Issued</dt>
            <dd>{q.data.doc.issued}</dd>
            <dt className="text-muted">From</dt>
            <dd><Address value={q.data.doc.payee} /></dd>
            <dt className="text-muted">To</dt>
            <dd><Address value={q.data.doc.payer} /></dd>
            <dt className="text-muted">Description</dt>
            <dd>{q.data.doc.description}</dd>
          </dl>
        </div>
      ) : null}
    </Modal>
  )
}

function ProposeForm({ data }: { data: CircleDetail }) {
  const { address } = useAccount()
  const { run, busy } = useTx()
  const { signIn } = useSession()
  const [payer, setPayer] = useState('')
  const [amount, setAmount] = useState('')
  const [number, setNumber] = useState('')
  const [description, setDescription] = useState('')
  const [sending, setSending] = useState(false)
  const policies = useQuery({ queryKey: ['policies', data.circle.id], queryFn: () => api.policies(data.circle.id) })

  const others = data.members.filter((m) => m.status === 'member' && !sameAddr(m.address, address))
  const raw = tryParseUsdc(amount)
  const policy = policies.data?.items.find((p) => sameAddr(p.payer, payer) && sameAddr(p.payee, address))
  const withinPolicy = !!policy && !!raw && BigInt(policy.per_obligation) >= raw
  const valid = !!payer && !!raw && number.trim().length > 0 && description.trim().length > 0

  const submit = async (): Promise<void> => {
    if (!address || !raw || !CONTRACT) return
    setSending(true)
    try {
      const doc: InvoiceDocument = {
        version: 1,
        circleId: data.circle.id,
        payer: payer.toLowerCase(),
        payee: address.toLowerCase(),
        number: number.trim(),
        amount,
        currency: 'USDC',
        issued: new Date().toISOString().slice(0, 10),
        description: description.trim(),
      }
      const auth = await signIn()
      const published = await api.publishDocument(doc, auth)
      const ref = hashDocument(doc)
      if (published.ref.toLowerCase() !== ref.toLowerCase()) throw new Error('The server returned a different document hash. Nothing was sent onchain.')
      const ok = await run({
        kind: 'propose',
        label: `Invoice ${usd(raw)} USDC to ${shortAddr(payer)}`,
        circleId: data.circle.id,
        params: { payer, amount: raw.toString(), number: number.trim() },
        call: { address: CONTRACT, abi: clearingHouseAbi, functionName: 'proposeObligation', args: [BigInt(data.circle.id), payer, raw, ref] },
      })
      if (ok) {
        setAmount('')
        setNumber('')
        setDescription('')
      }
    } catch (e) {
      const d = describeError(e)
      if (!d.rejected) toast.error(d.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <Card>
      <h2 className="font-display text-lg font-semibold">Send an invoice</h2>
      <p className="mb-4 text-sm text-muted">You are owed money by another member. It joins this cycle once they accept, or at once if their rule for you allows it.</p>
      <div className="space-y-4">
        <Field label="Who owes you?">
          <select className={inputCls} value={payer} onChange={(e) => setPayer(e.target.value)}>
            <option value="">Choose a member</option>
            {others.map((m) => (
              <option key={m.address} value={m.address}>
                {shortAddr(m.address)}
              </option>
            ))}
          </select>
        </Field>
        <AmountInput value={amount} onChange={setAmount} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Invoice number">
            <input className={inputCls} value={number} maxLength={80} onChange={(e) => setNumber(e.target.value)} placeholder="INV-2041" />
          </Field>
          <Field label="What is it for?">
            <input className={inputCls} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} placeholder="October freight" />
          </Field>
        </div>
        {payer && raw !== null && (
          <p className={`flex items-start gap-2 rounded-lg p-3 text-xs ${withinPolicy ? 'bg-ok/10 text-ok' : 'bg-paper text-muted'}`}>
            {withinPolicy ? <Zap className="mt-0.5 size-3.5 shrink-0" /> : <FileText className="mt-0.5 size-3.5 shrink-0" />}
            {withinPolicy
              ? 'Within this member\'s auto-accept limit for you. It settles into the cycle immediately if their collateral covers it.'
              : 'No auto-accept rule covers this amount. They will need to review and accept it.'}
          </p>
        )}
        <p className="text-xs text-muted">The invoice details are kept private. Only a fingerprint (hash) of them is written onchain, so either side can prove what was agreed.</p>
        <Button className="w-full" disabled={!valid} loading={busy || sending} onClick={() => void submit()}>
          Sign and send invoice
        </Button>
      </div>
    </Card>
  )
}

export function Invoices({ data, isMember }: { data: CircleDetail; isMember: boolean }) {
  const { address } = useAccount()
  const { run, busy } = useTx()
  const [filter, setFilter] = useState<string>('')
  const [docRef, setDocRef] = useState<string | null>(null)
  const chain = useCircleChain(isMember ? data.circle.id : undefined)

  const list = useInfiniteQuery({
    queryKey: ['obligations', data.circle.id, filter],
    queryFn: ({ pageParam }) => api.obligations(data.circle.id, { status: filter || undefined, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 6000,
  })
  const items = list.data?.pages.flatMap((p) => p.items) ?? []
  const coverage = chain.balance !== undefined && chain.net !== undefined ? chain.balance + chain.net : undefined

  const act = (o: ObligationItem, fn: 'acceptObligation' | 'rejectObligation' | 'cancelObligation', kind: string, label: string) =>
    CONTRACT &&
    run({
      kind,
      label,
      circleId: data.circle.id,
      params: { obligationId: o.id },
      call: { address: CONTRACT, abi: clearingHouseAbi, functionName: fn, args: [BigInt(o.id)] },
    })

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-lg font-semibold">Invoices</h2>
            <SourceTag source="INDEXED" />
          </div>
          <div className="flex gap-1" role="tablist" aria-label="Filter invoices">
            {FILTERS.map(([v, label]) => (
              <button
                key={v}
                role="tab"
                aria-selected={filter === v}
                onClick={() => setFilter(v)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${filter === v ? 'bg-ink text-paper' : 'bg-card text-muted hover:text-ink'} border border-line`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {list.isLoading ? (
          <Skeleton className="h-48" />
        ) : list.error ? (
          <ErrorNote message={list.error.message} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <Empty title="No invoices here yet" body="When a member invoices another, it appears here with its status and the document behind it." />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-card shadow-card">
            <ul className="divide-y divide-line">
              {items.map((o) => {
                const iAmPayer = sameAddr(o.payer, address)
                const iAmPayee = sameAddr(o.payee, address)
                const live = o.status === 'proposed' && !o.expired
                const short = coverage !== undefined && iAmPayer && live && coverage < BigInt(o.amount)
                return (
                  <li key={o.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-muted">#{o.id}</span>
                        {statusBadge(o)}
                        <span className="text-xs text-muted">cycle {o.cycle} · {relTime(o.proposed_at)}</span>
                      </div>
                      <p className="mt-1 text-sm">
                        {iAmPayer ? <strong>You owe </strong> : iAmPayee ? <strong>You are owed by </strong> : null}
                        {iAmPayer ? shortAddr(o.payee) : iAmPayee ? shortAddr(o.payer) : `${shortAddr(o.payer)} owes ${shortAddr(o.payee)}`}
                      </p>
                      <button onClick={() => setDocRef(o.ref)} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
                        <FileText className="size-3" /> View document
                      </button>
                      {short && <p className="mt-1 text-xs text-warn">Needs {usd(BigInt(o.amount) - (coverage ?? 0n))} more collateral to accept. Add it under Collateral.</p>}
                    </div>
                    <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                      <p className="num font-display text-lg font-semibold">{usd(o.amount)}</p>
                      {live && isMember && iAmPayer && (
                        <div className="flex gap-2">
                          <Button className="min-h-8 px-3 text-xs" disabled={short} loading={busy} onClick={() => void act(o, 'acceptObligation', 'accept', `Accept invoice #${o.id}`)}>
                            Accept
                          </Button>
                          <Button variant="secondary" className="min-h-8 px-3 text-xs" disabled={busy} onClick={() => void act(o, 'rejectObligation', 'reject', `Reject invoice #${o.id}`)}>
                            Reject
                          </Button>
                        </div>
                      )}
                      {live && isMember && iAmPayee && (
                        <Button variant="ghost" className="min-h-8 px-3 text-xs" disabled={busy} onClick={() => void act(o, 'cancelObligation', 'cancel', `Withdraw invoice #${o.id}`)}>
                          Withdraw invoice
                        </Button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
            {list.hasNextPage && (
              <div className="border-t border-line p-3 text-center">
                <Button variant="secondary" loading={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                  Load older
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      <div>{isMember && !data.circle.paused ? <ProposeForm data={data} /> : <Empty title={data.circle.paused ? 'New invoices are paused' : 'Members only'} body={data.circle.paused ? 'The circle admin paused new activity. Withdrawals and closing still work.' : 'Join the circle to send and accept invoices.'} />}</div>
      <DocumentModal refHash={docRef} onClose={() => setDocRef(null)} />
    </div>
  )
}
