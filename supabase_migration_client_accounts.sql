-- Run this in Supabase Dashboard -> SQL Editor.
-- Adds the missing link from `users` to `clients` (mirrors the existing
-- users.employee_id link to `employees`), and the policies needed for:
--   1. Staff creating a "pending" users row for an approved client
--      (auth_user_id starts NULL -- no login attached yet).
--   2. That client automatically claiming their own pending row the
--      first time they log in (matched by email, see AuthContext.tsx).

ALTER TABLE users
  ADD COLUMN client_id INT UNIQUE REFERENCES clients(client_id);

CREATE POLICY "Authenticated can insert users"
  ON users
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Note: broader than the other policies in this project so far -- this
-- lets any logged-in user (Driver, Mechanic, Client, Staff) read every
-- row in `users`, including everyone's email/username/role. Needed so
-- the Staff "Clients" page can check which clients already have an
-- account linked. Worth tightening later with a role-checking function
-- (same flag as the earlier "authenticated = true" policies, just more
-- sensitive here since this table is an account directory).
CREATE POLICY "Authenticated can select users"
  ON users
  FOR SELECT
  TO authenticated
  USING (true);

-- Narrowly scoped on purpose: only lets a user claim a row that (a) has
-- no login attached yet, and (b) has their own email -- and only ever
-- lets them set auth_user_id to their own id. They can't touch anyone
-- else's row this way.
CREATE POLICY "Authenticated can claim own unclaimed profile"
  ON users
  FOR UPDATE
  TO authenticated
  USING (auth_user_id IS NULL AND email = (auth.jwt() ->> 'email'))
  WITH CHECK (auth_user_id = auth.uid() AND email = (auth.jwt() ->> 'email'));
