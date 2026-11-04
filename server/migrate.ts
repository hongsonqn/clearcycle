/** Applies server/migrations/*.sql in order, once each, inside a transaction. */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql } from './db'

export async function migrate(): Promise<string[]> {
  const dir = join(fileURLToPath(new URL('.', import.meta.url)), 'migrations')
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  await sql`create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`
  const applied: string[] = []
  for (const file of files) {
    const done = await sql<{ version: string }[]>`select version from schema_migrations where version = ${file}`
    if (done.length > 0) continue
    const body = readFileSync(join(dir, file), 'utf8')
    await sql.begin(async (tx) => {
      await tx.unsafe(body)
      await tx`insert into schema_migrations (version) values (${file})`
    })
    applied.push(file)
  }
  return applied
}

if (process.argv[1]?.endsWith('migrate.ts')) {
  const applied = await migrate()
  console.log(applied.length ? `applied: ${applied.join(', ')}` : 'schema up to date')
  await sql.end()
}
