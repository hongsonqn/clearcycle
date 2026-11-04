/** Typed client for the Clearcycle API. Everything returned here is INDEXED or DERIVED data. */

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } })
  } catch {
    throw new ApiError(0, 'Cannot reach the Clearcycle service. Check your connection and retry.')
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      /* keep default */
    }
    throw new ApiError(res.status, message)
  }
  return (await res.json()) as T
}

export interface Health {
  status: 'ok' | 'degraded'
  database: boolean
  rpc: { reachable: boolean; head: string | null; source: string }
  indexer: { lastBlock: string; lagBlocks: string | null; lastError: string | null; updatedAt: string } | null
  chainId: number
  contract: string
  deployBlock: string
}

export interface CircleSummary {
  id: string
  admin: string
  name: string
  cycle_duration: number
  cycle_start: string
  current_cycle: string
  paused: boolean
  my_status: 'member' | 'invited'
  my_balance: string
  my_net: string
  member_count: number
  open_gross: string
}

export interface Member {
  address: string
  status: 'member' | 'invited'
  balance: string
  net: string
}

export interface CircleDetail {
  circle: { id: string; admin: string; name: string; cycle_duration: number; cycle_start: string; current_cycle: string; paused: boolean }
  members: Member[]
  closed: { cycles: number; gross: string; net_volume: string; obligations: number }
  open: { gross: string; count: number; auto: number; awaiting: number }
  automation: { auto: number; total: number }
}

export interface ObligationItem {
  id: string
  cycle: string
  payer: string
  payee: string
  amount: string
  ref: string
  status: 'proposed' | 'accepted' | 'rejected' | 'cancelled'
  automatic: boolean
  proposed_tx: string
  resolved_tx: string | null
  proposed_at: string
  resolved_at: string | null
  expired: boolean
}

export interface EventItem {
  id: string
  name: string
  args: Record<string, string | boolean | number>
  block_number: string
  block_time: string
  tx_hash: string
  log_index: number
}

export interface CycleItem {
  cycle: string
  gross: string
  net_volume: string
  obligation_count: number
  closed_at: string
  tx_hash: string
}

export interface PolicyItem {
  payer: string
  payee: string
  per_obligation: string
  per_cycle: string
  updated_at: string
}

export interface Inbox {
  invites: { circle_id: string; name: string }[]
  toReview: { id: string; circle_id: string; circle_name: string; payee: string; amount: string; ref: string }[]
  awaitingPayer: { id: string; circle_id: string; circle_name: string; payer: string; amount: string }[]
  closable: { circle_id: string; name: string; ends_at: string }[]
  settled: { circle_id: string; circle_name: string; cycle: string; net: string; closed_at: string }[]
}

export interface Reconciliation {
  status: 'ok' | 'drift' | 'indexer_behind'
  checkedBlock: string
  membersChecked: number
  drift: { member: string; field: string; database: string; onchain: string }[]
  custody: { contractUsdc: string | null; totalBalances: string; covered: boolean | null }
  ranAt: string
}

export interface Intent {
  id: string
  kind: string
  status: 'prepared' | 'submitted' | 'verified' | 'indexed' | 'failed' | 'rejected'
  tx_hash: string | null
  detail: string | null
}

export const api = {
  health: () => request<Health>('/health'),
  circlesFor: (address: string) => request<{ items: CircleSummary[] }>(`/me/circles?address=${address}`),
  inbox: (address: string) => request<Inbox>(`/inbox?address=${address}`),
  circle: (id: string) => request<CircleDetail>(`/circles/${id}`),
  obligations: (id: string, params: { status?: string; cursor?: string; limit?: number }) => {
    const q = new URLSearchParams()
    if (params.status) q.set('status', params.status)
    if (params.cursor) q.set('cursor', params.cursor)
    q.set('limit', String(params.limit ?? 25))
    return request<{ items: ObligationItem[]; nextCursor: string | null }>(`/circles/${id}/obligations?${q.toString()}`)
  },
  events: (id: string, cursor?: string) =>
    request<{ items: EventItem[]; nextCursor: string | null }>(`/circles/${id}/events?limit=30${cursor ? `&cursor=${cursor}` : ''}`),
  cycles: (id: string) =>
    request<{ cycles: CycleItem[]; positions: { cycle: string; member: string; net: string }[] }>(`/circles/${id}/cycles`),
  policies: (id: string) => request<{ items: PolicyItem[] }>(`/circles/${id}/policies`),
  reconciliation: (id: string) =>
    request<{ latest: { ok: boolean; checked_block: string; members_checked: number; ran_at: string } | null }>(`/circles/${id}/reconciliation`),
  reconcile: (id: string) => request<Reconciliation>(`/circles/${id}/reconcile`, { method: 'POST', body: '{}' }),
  createIntent: (body: {
    idempotencyKey: string
    address: string
    kind: string
    circleId?: string
    params?: Record<string, string | number | boolean>
  }) => request<Intent>('/intents', { method: 'POST', body: JSON.stringify(body) }),
  submitIntent: (id: string, txHash: string) =>
    request<Intent>(`/intents/${id}/submitted`, { method: 'POST', body: JSON.stringify({ txHash }) }),
  rejectIntent: (id: string) => request<Intent>(`/intents/${id}/rejected`, { method: 'POST', body: '{}' }),
  intent: (id: string) => request<Intent>(`/intents/${id}`),
  publishDocument: (document: unknown, auth: string) =>
    request<{ ref: string }>('/documents', { method: 'POST', body: JSON.stringify({ document }), headers: { 'x-clearcycle-auth': auth } }),
  document: (ref: string, auth: string) =>
    request<{ ref: string; document: Record<string, string> }>(`/documents/${ref}`, { headers: { 'x-clearcycle-auth': auth } }),
}
