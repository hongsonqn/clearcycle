/** HTTP API (node:http so it runs under Bun and Node). JSON in, JSON out, strict input validation. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { isAddress, verifyMessage } from 'viem'
import { AUTH_TTL_MS, authMessage, decodeToken } from '../src/lib/auth'
import { hashDocument, parseInvoiceDocument } from '../src/lib/canonical'
import { client } from './chain'
import { config } from './config'
import { lc, sql } from './db'
import { indexerStatus } from './indexer'
import { HttpError, createIntent, listIntents, markRejected, markSubmitted, refreshIntent } from './intents'
import {
  circleDetail,
  circlesForAddress,
  inbox,
  listCycles,
  listEvents,
  listObligations,
  listPolicies,
  statementCsv,
} from './queries'
import { latestReconciliation, reconcileCircle } from './reconcile'

const MAX_BODY = 16 * 1024
const hits = new Map<string, { count: number; reset: number }>()

function limited(key: string, max: number): boolean {
  const now = Date.now()
  const entry = hits.get(key)
  if (!entry || entry.reset < now) {
    hits.set(key, { count: 1, reset: now + 60_000 })
    return false
  }
  entry.count += 1
  return entry.count > max
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers })
  res.end(text)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > MAX_BODY) throw new HttpError(413, 'Request body too large')
    chunks.push(buf)
  }
  if (size === 0) return {}
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
    return parsed as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'Body must be a JSON object')
  }
}

const isId = (v: string | undefined): v is string => v !== undefined && /^\d{1,18}$/.test(v)
const needAddress = (v: string | null): string => {
  if (!v || !isAddress(v)) throw new HttpError(400, 'A valid address is required')
  return v
}

/** Verifies the signed sign-in header and returns the lowercase address that signed it. */
async function authenticate(req: IncomingMessage): Promise<string> {
  const header = req.headers['x-clearcycle-auth']
  const token = typeof header === 'string' ? decodeToken(header) : null
  if (!token || !isAddress(token.address)) throw new HttpError(401, 'Sign in with your wallet to continue')
  const issued = Date.parse(token.issuedAt)
  const now = Date.now()
  if (Number.isNaN(issued) || issued > now + 5 * 60_000 || now - issued > AUTH_TTL_MS) {
    throw new HttpError(401, 'Your sign-in expired. Sign in again.')
  }
  const valid = await verifyMessage({
    address: token.address,
    message: authMessage(token.address, token.issuedAt),
    signature: token.signature as `0x${string}`,
  }).catch(() => false)
  if (!valid) throw new HttpError(401, 'Sign-in signature is not valid')
  return lc(token.address)
}

type Handler = (ctx: { req: IncomingMessage; res: ServerResponse; params: string[]; query: URLSearchParams }) => Promise<void>

const routes: { method: string; pattern: RegExp; handler: Handler }[] = []
const route = (method: string, pattern: string, handler: Handler): void => {
  routes.push({ method, pattern: new RegExp(`^${pattern}$`), handler })
}

route('GET', '/health', async ({ res }) => {
  const dbOk = await sql`select 1`.then(() => true, () => false)
  const head = await client.getBlockNumber({ cacheTime: 0 }).then((n) => n.toString(), () => null)
  const indexer = await indexerStatus().catch(() => null)
  const lag = indexer && head ? (BigInt(head) - BigInt(indexer.lastBlock)).toString() : null
  const healthy = dbOk && head !== null && lag !== null && BigInt(lag) <= 10n
  send(res, healthy ? 200 : 503, {
    status: healthy ? 'ok' : 'degraded',
    database: dbOk,
    rpc: { reachable: head !== null, head, source: config.rpcSource },
    indexer: indexer ? { ...indexer, lagBlocks: lag } : null,
    chainId: config.chainId,
    contract: config.contract,
    deployBlock: config.deployBlock.toString(),
  })
})

route('GET', '/me/circles', async ({ res, query }) => {
  send(res, 200, { items: await circlesForAddress(needAddress(query.get('address'))) })
})

route('GET', '/inbox', async ({ res, query }) => {
  send(res, 200, await inbox(needAddress(query.get('address'))))
})

route('GET', '/circles/(\\d+)', async ({ res, params }) => {
  const detail = await circleDetail(params[0] as string)
  if (!detail) throw new HttpError(404, 'Circle not found (it may not be indexed yet)')
  send(res, 200, detail)
})

route('GET', '/circles/(\\d+)/obligations', async ({ res, params, query }) => {
  const limit = Number(query.get('limit') ?? '25')
  send(
    res,
    200,
    await listObligations(params[0] as string, {
      status: query.get('status') ?? undefined,
      address: query.get('address') ?? undefined,
      cursor: isId(query.get('cursor') ?? undefined) ? (query.get('cursor') as string) : undefined,
      limit: Number.isFinite(limit) ? limit : 25,
    }),
  )
})

route('GET', '/circles/(\\d+)/events', async ({ res, params, query }) => {
  const cursor = query.get('cursor') ?? undefined
  send(res, 200, await listEvents(params[0] as string, { cursor: isId(cursor) ? cursor : undefined, limit: Number(query.get('limit') ?? '30') || 30 }))
})

route('GET', '/circles/(\\d+)/cycles', async ({ res, params }) => {
  send(res, 200, await listCycles(params[0] as string))
})

route('GET', '/circles/(\\d+)/policies', async ({ res, params, query }) => {
  const address = query.get('address')
  send(res, 200, { items: await listPolicies(params[0] as string, address && isAddress(address) ? address : undefined) })
})

route('GET', '/circles/(\\d+)/statement.csv', async ({ res, params }) => {
  const csv = await statementCsv(params[0] as string)
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="clearcycle-circle-${params[0]}-statement.csv"`,
    'cache-control': 'no-store',
  })
  res.end(csv)
})

route('GET', '/circles/(\\d+)/reconciliation', async ({ res, params }) => {
  send(res, 200, { latest: await latestReconciliation(params[0] as string) })
})

route('POST', '/circles/(\\d+)/reconcile', async ({ req, res, params }) => {
  const key = `reconcile:${params[0]}:${req.socket.remoteAddress ?? ''}`
  if (limited(key, 6)) throw new HttpError(429, 'Reconciliation was run recently. Try again in a minute.')
  send(res, 200, await reconcileCircle(params[0] as string))
})

route('POST', '/documents', async ({ req, res }) => {
  const signer = await authenticate(req)
  const body = await readJson(req)
  const doc = parseInvoiceDocument(body.document)
  if (typeof doc === 'string') throw new HttpError(400, doc)
  if (doc.payee !== signer) throw new HttpError(403, 'Only the invoicing party can publish this document')
  const ref = hashDocument(doc)
  await sql`insert into documents (ref, body, created_by) values (${ref}, ${sql.json(doc as unknown as Record<string, string>)}, ${signer}) on conflict (ref) do nothing`
  send(res, 201, { ref })
})

route('GET', '/documents/(0x[0-9a-fA-F]{64})', async ({ req, res, params }) => {
  const signer = await authenticate(req)
  const ref = lc(params[0] as string)
  const rows = await sql<{ body: unknown; created_by: string }[]>`select body, created_by from documents where ref = ${ref}`
  const row = rows[0]
  if (!row) throw new HttpError(404, 'Document not found')
  const party = await sql<{ n: number }[]>`
    select count(*)::int as n from obligations where ref = ${ref} and (payer = ${signer} or payee = ${signer})`
  if (row.created_by !== signer && (party[0]?.n ?? 0) === 0) throw new HttpError(403, 'Only the parties to this invoice can read it')
  send(res, 200, { ref, document: row.body })
})

route('POST', '/intents', async ({ req, res }) => {
  if (limited(`intent:${req.socket.remoteAddress ?? ''}`, 60)) throw new HttpError(429, 'Too many requests')
  const body = await readJson(req)
  const params: Record<string, string | number | boolean> = {}
  if (body.params && typeof body.params === 'object') {
    for (const [k, v] of Object.entries(body.params as Record<string, unknown>).slice(0, 12)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') params[k.slice(0, 40)] = typeof v === 'string' ? v.slice(0, 200) : v
    }
  }
  const circleId = typeof body.circleId === 'string' && isId(body.circleId) ? body.circleId : null
  const row = await createIntent({
    idempotencyKey: String(body.idempotencyKey ?? ''),
    address: String(body.address ?? ''),
    kind: String(body.kind ?? ''),
    circleId,
    params,
  })
  send(res, 201, row)
})

route('GET', '/intents', async ({ res, query }) => {
  send(res, 200, { items: await listIntents(needAddress(query.get('address'))) })
})

route('GET', '/intents/([0-9a-f-]{36})', async ({ res, params }) => {
  send(res, 200, await refreshIntent(params[0] as string))
})

route('POST', '/intents/([0-9a-f-]{36})/submitted', async ({ req, res, params }) => {
  const body = await readJson(req)
  send(res, 200, await markSubmitted(params[0] as string, String(body.txHash ?? '')))
})

route('POST', '/intents/([0-9a-f-]{36})/rejected', async ({ res, params }) => {
  send(res, 200, await markRejected(params[0] as string))
})

export function startApi(log: (m: string) => void = console.log): () => void {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const path = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/'
        const method = req.method ?? 'GET'
        for (const r of routes) {
          if (r.method !== method) continue
          const m = r.pattern.exec(path)
          if (!m) continue
          await r.handler({ req, res, params: m.slice(1), query: url.searchParams })
          return
        }
        send(res, 404, { error: 'Not found' })
      } catch (error) {
        if (error instanceof HttpError) {
          send(res, error.status, { error: error.message })
        } else {
          log(`api: ${error instanceof Error ? error.message : 'unknown error'}`)
          send(res, 500, { error: 'Something went wrong. Please retry.' })
        }
      }
    })()
  })
  server.listen(config.port, '0.0.0.0', () => log(`api: listening on :${config.port}`))
  return () => server.close()
}
