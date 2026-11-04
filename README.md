# Clearcycle

Clearcycle lets companies that invoice each other net what they owe every cycle and settle only the difference in USDC on Arc. Members post collateral for their net payable, set narrow auto-accept limits per partner, and anyone can close a cycle when it ends. Each cycle produces a statement both sides can verify.

Built with [Arc Studio](https://studio.arc.io)

## Tech stack

- React 18, Vite, TypeScript, Tailwind CSS
- wagmi, viem, ConnectKit (Arc Testnet, USDC)
- Solidity 0.8.28 with Foundry (OpenZeppelin)
- A small API and event indexer running on Bun, backed by PostgreSQL

## Development

Prerequisites: Bun, Foundry, and a PostgreSQL 16+ database (Docker works well).

```bash
bun install
docker run -d --name clearcycle-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=clearcycle \
  -v clearcycle_pg:/var/lib/postgresql -p 5433:5432 postgres:18-alpine
bun run api     # applies migrations, starts the indexer and the API on :3001
bun run dev     # web app on :5173, proxies /api to the API
```

### Environment variables

| Name | Purpose |
| --- | --- |
| `VITE_CLEARCYCLE_ADDRESS` | Deployed ClearingHouse contract address |
| `VITE_CLEARCYCLE_DEPLOY_BLOCK` | Block the contract was deployed at (where indexing starts) |
| `VITE_CLEARCYCLE_CHAIN_ID` | Chain ID, defaults to 5042002 (Arc Testnet) |
| `DATABASE_URL` | PostgreSQL connection string |
| `API_PORT` | API port, defaults to 3001 |
| `CLEARCYCLE_RPC_URL` | Optional RPC override (used for local testing) |
| `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS` | Optional outside Arc Studio. Provisioned by Arc Studio for a keyed RPC |
| `INDEXER_CONFIRMATIONS`, `INDEXER_REORG_DEPTH`, `INDEXER_MAX_RANGE`, `INDEXER_POLL_MS` | Optional indexer tuning |

### Scripts

- `bun run dev` start the web app
- `bun run api` start the API and indexer
- `bun run db:migrate` apply database migrations
- `bun run db:rebuild` rebuild every derived table from the stored event log
- `bun run contracts:build` and `bun run contracts:test` build and test the contract
- `bun run abi:gen` regenerate the shared ABI after a contract change
- `bun run test:e2e` run the end-to-end test on a local chain with a throwaway database
- `bun run check` lint and typecheck

## Data sources

Collateral, net positions and invoice status are read from the contract. Lists and statements come from PostgreSQL, which is filled from contract events and can be rebuilt at any time. Invoice documents are stored privately and checked against a hash written onchain.
