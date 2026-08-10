-- Online play moves from peer-to-peer KHQR settlement to a points wallet.
-- Players buy points from the operator (1 point = 1000 riel), rounds settle
-- straight out of the wallet, and nobody pays anybody else directly.
--
-- Run this in the Supabase SQL Editor after 001 (supabase/schema.sql).

-- Wallet balance in points. Can go negative when a bomb chain costs more than
-- the round-entry check reserved — the player must top up before playing again.
alter table public.profiles
  add column if not exists points bigint not null default 0;

-- ---------------------------------------------------------------------------
-- Coin purchases, credited only after the operator confirms the riel landed.
-- ---------------------------------------------------------------------------
create table if not exists public.topups (
  id          uuid primary key default gen_random_uuid(),
  google_id   text not null references public.profiles (google_id) on delete cascade,
  points      bigint not null check (points > 0),
  riel        bigint not null check (riel > 0),
  reference   text,                        -- bank transaction ref typed by the player
  proof_url   text,                        -- optional screenshot of the transfer
  status      text not null default 'pending'
              check (status in ('pending', 'approved', 'rejected')),
  note        text,                        -- operator's reason when rejecting
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);

create index if not exists topups_status_idx on public.topups (status, created_at);
create index if not exists topups_google_idx on public.topups (google_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Single-row-per-key operator settings (currently just the payment KHQR).
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

alter table public.topups       enable row level security;
alter table public.app_settings enable row level security;

-- ---------------------------------------------------------------------------
-- Wallet operations. All arithmetic happens in the database so concurrent
-- rounds, tabs, or a retried request can never lose or double-count points.
-- ---------------------------------------------------------------------------

create or replace function public.add_points(p_google_id text, p_delta bigint)
returns bigint
language sql
as $$
  update public.profiles
     set points = points + p_delta,
         updated_at = now()
   where google_id = p_google_id
  returning points;
$$;

-- Settles a whole round in one statement: {"<google_id>": <delta>, …}.
-- One UPDATE over the whole set keeps the round atomic — either every seat
-- moves or none does.
create or replace function public.apply_point_deltas(p_deltas jsonb)
returns void
language sql
as $$
  update public.profiles p
     set points = p.points + d.delta,
         updated_at = now()
    from (
      select key as google_id, value::bigint as delta
        from jsonb_each_text(p_deltas)
    ) d
   where p.google_id = d.google_id;
$$;

-- Approves a pending top-up and credits the points. Returns the new balance,
-- or null if the top-up was already reviewed — so a double-click, a retry, or
-- two admins clicking at once can only ever credit the points once.
create or replace function public.approve_topup(p_id uuid, p_admin text)
returns bigint
language plpgsql
as $$
declare
  t public.topups;
  new_balance bigint;
begin
  update public.topups
     set status = 'approved', reviewed_at = now(), reviewed_by = p_admin
   where id = p_id and status = 'pending'
  returning * into t;

  if not found then
    return null;
  end if;

  update public.profiles
     set points = points + t.points, updated_at = now()
   where google_id = t.google_id
  returning points into new_balance;

  return new_balance;
end;
$$;