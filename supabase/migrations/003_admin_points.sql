-- Lets the operator set or adjust a player's points by hand from /admin —
-- correcting a mistyped top-up, granting a bonus, clearing a negative wallet.
--
-- Every hand edit is written to point_adjustments. A balance that can be
-- changed silently is a balance nobody can audit, so the row is written in the
-- same statement as the change.

create table if not exists public.point_adjustments (
  id            uuid primary key default gen_random_uuid(),
  google_id     text not null references public.profiles (google_id) on delete cascade,
  mode          text not null check (mode in ('set', 'add')),
  before_points bigint not null,
  after_points  bigint not null,
  delta         bigint not null,
  note          text,
  admin_email   text not null,
  created_at    timestamptz not null default now()
);

create index if not exists point_adjustments_google_idx
  on public.point_adjustments (google_id, created_at desc);

alter table public.point_adjustments enable row level security;

-- Applies the edit and records it. Returns {"before": n, "after": n}, or null
-- when the player does not exist.
--   mode 'set' — p_amount becomes the new balance
--   mode 'add' — p_amount is added (negative to take points away)
create or replace function public.admin_adjust_points(
  p_google_id text,
  p_mode      text,
  p_amount    bigint,
  p_admin     text,
  p_note      text
)
returns jsonb
language plpgsql
as $$
declare
  before_points bigint;
  after_points  bigint;
begin
  if p_mode not in ('set', 'add') then
    raise exception 'mode must be set or add';
  end if;

  -- Locks the row so two admins editing at once cannot both read the same
  -- starting balance and lose one of the edits.
  select points into before_points
    from public.profiles
   where google_id = p_google_id
     for update;

  if not found then
    return null;
  end if;

  after_points := case when p_mode = 'set' then p_amount else before_points + p_amount end;

  update public.profiles
     set points = after_points, updated_at = now()
   where google_id = p_google_id;

  insert into public.point_adjustments
    (google_id, mode, before_points, after_points, delta, note, admin_email)
  values
    (p_google_id, p_mode, before_points, after_points, after_points - before_points,
     nullif(p_note, ''), p_admin);

  return jsonb_build_object('before', before_points, 'after', after_points);
end;
$$;