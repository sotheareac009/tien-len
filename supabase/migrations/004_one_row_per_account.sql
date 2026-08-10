-- One profile per Google account, enforced by the database.
--
-- google_id is already the primary key, and auth.js now sets it to Google's
-- own account id (stable for the life of the account) rather than the random
-- uuid Auth.js generates per sign-in. That alone stops the duplicates.
--
-- This index is the backstop. If the identity ever drifts again, a second row
-- for the same person cannot be created: the insert fails, the player sees an
-- error, and nobody's points are silently split across two wallets. A loud
-- failure is the right one when the row holds money.

create unique index if not exists profiles_email_unique
  on public.profiles (lower(email))
  where email is not null;