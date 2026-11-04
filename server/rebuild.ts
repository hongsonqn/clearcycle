/** Rebuilds every DERIVED table by replaying chain_events. Safe to run any time. */
import { sql } from './db'
import { rebuildDerived } from './projector'

const replayed = await rebuildDerived()
console.log(`replayed ${replayed} events into derived tables`)
await sql.end()
