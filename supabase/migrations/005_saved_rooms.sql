-- Saved rooms: a table the host has chosen to keep.
--
-- Rooms normally live only in the server's memory, so a restart would destroy
-- a half-played round and the seats around it. A saved room stores its members,
-- stakes, running tally and the round in progress, and is loaded back on boot —
-- players reconnect straight into the hand they were holding.
--
-- Only the host can save or delete a room (enforced in lib/socket-server.js).

create table if not exists public.game_rooms (
  code          text primary key,
  host_id       text not null,               -- seat id == Google account id
  status        text not null,               -- waiting | playing | paused | catch2
  settings      jsonb not null,
  members       jsonb not null default '[]', -- seat ids, in seat order
  seats         jsonb not null default '{}', -- seatId -> { name, image }
  tally         jsonb not null default '{}', -- seatId -> net points in this room
  rounds_played int  not null default 0,
  game          jsonb,                       -- TienLenGame.toJSON(), null between rounds
  last_ranks    jsonb,
  last_deltas   jsonb,
  saved_by      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists game_rooms_updated_idx on public.game_rooms (updated_at desc);

alter table public.game_rooms enable row level security;