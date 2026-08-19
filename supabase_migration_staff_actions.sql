-- Run this in Supabase Dashboard -> SQL Editor.
-- Lets any logged-in (authenticated) user create/read the records needed
-- when Staff approves a quote request: a clients row, two places rows
-- (pickup + delivery), and a bookings row -- plus updating the original
-- quote_requests row.
--
-- Note: this only checks "is logged in", not "is this user Admin or
-- Dispatcher" -- the Approve/Reject buttons are hidden from other roles
-- in the UI, but these policies don't enforce that at the database level.
-- Fine for now; worth tightening later with a role-checking policy.

CREATE POLICY "Authenticated can update quote_requests"
  ON quote_requests
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated can insert clients"
  ON clients
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated can select clients"
  ON clients
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can insert places"
  ON places
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated can select places"
  ON places
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can insert bookings"
  ON bookings
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated can select bookings"
  ON bookings
  FOR SELECT
  TO authenticated
  USING (true);
