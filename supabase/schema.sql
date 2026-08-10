-- Tien Len — Supabase schema
-- Run this once in the Supabase dashboard → SQL Editor.
--
-- Everything is written by the game server using the service role key, so
-- row-level security stays on with no policies: the anon key can read
-- nothing, and only the server can touch these tables.

-- ---------------------------------------------------------------------------
-- Players who signed in with Google. Guests are never stored.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  google_id   text primary key,           -- Auth.js token.sub
  name        text not null,
  email       text,
  image       text,
  qr_url      text,                       -- saved KHQR, restored on next login
  coins       bigint not null default 1000, -- single-player balance
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Existing installs: add the coin balance without touching anything else.
alter table public.profiles
  add column if not exists coins bigint not null default 1000;

-- Applies a single-player win/loss to a signed-in player's balance and returns
-- the new total. Done in the database so two tabs (or a retry) can never
-- clobber each other the way a read-modify-write from the client would, and
-- so a balance can never go negative.
create or replace function public.add_coins(p_google_id text, p_delta bigint)
returns bigint
language sql
as $$
  update public.profiles
     set coins = greatest(0, coins + p_delta),
         updated_at = now()
   where google_id = p_google_id
  returning coins;
$$;

-- ---------------------------------------------------------------------------
-- One row per finished round.
-- ---------------------------------------------------------------------------
create table if not exists public.rounds (
  id          uuid primary key default gen_random_uuid(),
  room_code   text not null,
  currency    text not null,
  settings    jsonb not null,             -- stakes in force for this round
  finished_at timestamptz not null default now()
);

create index if not exists rounds_room_code_idx on public.rounds (room_code);

-- ---------------------------------------------------------------------------
-- Finish order of a round. google_id is null for guest seats.
-- ---------------------------------------------------------------------------
create table if not exists public.round_players (
  id         uuid primary key default gen_random_uuid(),
  round_id   uuid not null references public.rounds (id) on delete cascade,
  google_id  text references public.profiles (google_id) on delete set null,
  name       text not null,
  place      int  not null,               -- 1 = winner
  net        numeric(12, 2) not null      -- won (+) or lost (-) this round
);

create index if not exists round_players_round_id_idx on public.round_players (round_id);
create index if not exists round_players_google_id_idx on public.round_players (google_id);

-- ---------------------------------------------------------------------------
-- Who owes whom, and whether the KHQR transfer was confirmed.
-- ---------------------------------------------------------------------------
create table if not exists public.debts (
  id           text primary key,          -- the in-memory debt id
  round_id     uuid not null references public.rounds (id) on delete cascade,
  from_name    text not null,
  from_google  text,
  to_name      text not null,
  to_google    text,
  amount       numeric(12, 2) not null,
  currency     text not null,
  settled      boolean not null default false,
  settled_at   timestamptz
);

create index if not exists debts_round_id_idx on public.debts (round_id);

alter table public.profiles      enable row level security;
alter table public.rounds        enable row level security;
alter table public.round_players enable row level security;
alter table public.debts         enable row level security;

-- ---------------------------------------------------------------------------
-- Public bucket for the uploaded KHQR images (see SUPABASE_QR_BUCKET).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('khqr', 'khqr', true)
on conflict (id) do nothing;
