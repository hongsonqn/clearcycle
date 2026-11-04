# Clearcycle

> Built with Arc Studio

Multilateral netting clearing house for B2B payables settled in USDC on Arc.

## Deployed contracts

- ClearingHouse (Arc Testnet, chain 5042002): `0x38fdd0019267d9bd86cb394eeb74e9243bb30e45`, deployed at block 69693806. USDC: `0x3600000000000000000000000000000000000000`.
- Address and deploy block live in `.env` as `VITE_CLEARCYCLE_ADDRESS` and `VITE_CLEARCYCLE_DEPLOY_BLOCK`.

## Architecture

UI (`src/`) -> API (`server/api.ts`) -> queries/projector -> PostgreSQL; blockchain adapter in `server/chain.ts`.

- ONCHAIN is canonical for funds, balances, net positions and invoice status. The UI reads the user's own money from the contract.
- PostgreSQL holds INDEXED events (`chain_events`), DERIVED tables rebuildable with `bun run db:rebuild`, OFFCHAIN invoice documents (content-addressed by keccak256 of canonical JSON), and operational tables (`tx_intents`, `reconciliation_runs`).
- Indexer (`server/indexer.ts`): starts at the deploy block, adaptive `eth_getLogs` range (the public RPC rejected 2000 blocks, 1000 worked), checkpoint hash for reorg detection, idempotent on (tx_hash, log_index).
- Transactions (`src/hooks/tx.tsx`): intent -> simulate -> sign -> receipt -> server verifies receipt and event -> indexed.
- `server/` is run with `bun run api` (not `node`) so `.env` is loaded.

## Contract facts

- Coverage invariant: balance + net >= 0 for every member. Cycle close can never fail for lack of funds.
- Invoicing is blocked once a cycle's calendar end passes until someone calls `closeCycle`.
- No owner, fee or upgrade key. Admin can invite and pause (pause never blocks withdraw or close).
- Contract changes: `forge build`, `bun run abi:gen`, redeploy, update `.env`, restart `bun run api`.

## Testing

- `bun run contracts:test` (138 Foundry tests incl. invariants), `bun run test:e2e` (local anvil, throwaway database `clearcycle_e2e`).

## Known limits

USDC only (no FX). Shared custody contract (a USDC freeze on it would block withdrawals). Sign-in for private invoices supports EOA wallets only. The final deadline fix was covered by tests but not re-run through the full security review.
