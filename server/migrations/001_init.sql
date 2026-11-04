-- Clearcycle schema.
--
-- Source-of-truth map
--   ONCHAIN   : funds, balances, net positions, membership, obligations (the ClearingHouse contract)
--   INDEXED   : chain_events (append-only copy of contract logs, idempotent on tx_hash + log_index)
--   DERIVED   : circles, members, obligations, policies, cycles (fully rebuildable by replaying chain_events)
--   OFFCHAIN  : documents (content-addressed invoice bodies, verified against the onchain `ref` hash)
--   OPERATIONAL: tx_intents, reconciliation_runs, indexer_state

create table if not exists schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

-- Indexer checkpoint. One row per (chain, contract).
create table if not exists indexer_state (
  id text primary key,
  last_block bigint not null,
  last_block_hash text,
  head_block bigint,
  last_error text,
  updated_at timestamptz not null default now()
);

-- INDEXED: raw decoded logs. The unique key makes re-ingestion a no-op.
create table if not exists chain_events (
  id bigserial primary key,
  chain_id integer not null,
  block_number bigint not null,
  block_hash text not null,
  block_time timestamptz not null,
  tx_hash text not null,
  log_index integer not null,
  name text not null,
  circle_id bigint,
  args jsonb not null,
  unique (tx_hash, log_index)
);
create index if not exists chain_events_replay_idx on chain_events (block_number, log_index);
create index if not exists chain_events_circle_idx on chain_events (circle_id, block_number desc, log_index desc);
create index if not exists chain_events_tx_idx on chain_events (tx_hash);

-- DERIVED
create table if not exists circles (
  id bigint primary key,
  admin text not null,
  name text not null,
  cycle_duration integer not null,
  cycle_start bigint not null,
  current_cycle bigint not null default 1,
  paused boolean not null default false,
  created_block bigint not null,
  created_at timestamptz not null
);
create index if not exists circles_admin_idx on circles (admin);

create table if not exists members (
  circle_id bigint not null references circles (id) on delete cascade,
  address text not null,
  status text not null check (status in ('invited', 'member', 'left')),
  balance numeric(78, 0) not null default 0,
  net numeric(78, 0) not null default 0,
  joined_at timestamptz,
  primary key (circle_id, address)
);
create index if not exists members_address_idx on members (address, status);

create table if not exists obligations (
  id bigint primary key,
  circle_id bigint not null references circles (id) on delete cascade,
  cycle bigint not null,
  payer text not null,
  payee text not null,
  amount numeric(78, 0) not null check (amount > 0),
  ref text not null,
  status text not null check (status in ('proposed', 'accepted', 'rejected', 'cancelled')),
  automatic boolean not null default false,
  proposed_tx text not null,
  resolved_tx text,
  proposed_at timestamptz not null,
  resolved_at timestamptz
);
create index if not exists obligations_circle_idx on obligations (circle_id, id desc);
create index if not exists obligations_payer_idx on obligations (payer, status, circle_id);
create index if not exists obligations_payee_idx on obligations (payee, status, circle_id);
create index if not exists obligations_cycle_idx on obligations (circle_id, cycle, status);

create table if not exists policies (
  circle_id bigint not null references circles (id) on delete cascade,
  payer text not null,
  payee text not null,
  per_obligation numeric(78, 0) not null,
  per_cycle numeric(78, 0) not null,
  updated_at timestamptz not null,
  primary key (circle_id, payer, payee)
);

create table if not exists cycles (
  circle_id bigint not null references circles (id) on delete cascade,
  cycle bigint not null,
  gross numeric(78, 0) not null,
  net_volume numeric(78, 0) not null,
  obligation_count integer not null,
  closed_at timestamptz not null,
  tx_hash text not null,
  primary key (circle_id, cycle)
);

-- Per-member settlement result of a closed cycle (statement lines).
create table if not exists cycle_positions (
  circle_id bigint not null references circles (id) on delete cascade,
  cycle bigint not null,
  member text not null,
  net numeric(78, 0) not null,
  primary key (circle_id, cycle, member)
);

-- OFFCHAIN: invoice documents, content-addressed. `ref` must equal keccak256(canonical JSON).
create table if not exists documents (
  ref text primary key,
  body jsonb not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

-- OPERATIONAL: client intents. An intent carries no authority; success is decided from the receipt.
create table if not exists tx_intents (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  address text not null,
  kind text not null,
  circle_id bigint,
  params jsonb not null default '{}'::jsonb,
  status text not null check (status in
    ('prepared', 'submitted', 'verified', 'indexed', 'failed', 'rejected')),
  tx_hash text,
  detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tx_intents_address_idx on tx_intents (address, created_at desc);
create index if not exists tx_intents_hash_idx on tx_intents (tx_hash);

create table if not exists reconciliation_runs (
  id bigserial primary key,
  circle_id bigint not null,
  checked_block bigint not null,
  ok boolean not null,
  members_checked integer not null,
  drift jsonb not null default '[]'::jsonb,
  ran_at timestamptz not null default now()
);
create index if not exists reconciliation_runs_circle_idx on reconciliation_runs (circle_id, ran_at desc);
