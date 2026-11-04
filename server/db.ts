import postgres from 'postgres'
import { config } from './config'

export const sql = postgres(config.databaseUrl, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  // postgres.js returns int8 and numeric as strings, so money never passes through a JS float.
  onnotice: () => {},
})

export type Sql = postgres.Sql
export type Tx = postgres.TransactionSql

/** Lowercase an address for storage and comparison. */
export function lc(value: string): string {
  return value.toLowerCase()
}
