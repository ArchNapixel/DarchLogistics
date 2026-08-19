-- Run this in Supabase Dashboard -> SQL Editor.
-- Lets any logged-in (authenticated) user update itinerary status and
-- record delivery receipts/damage records/status-change logs. Same
-- simplification as earlier migrations: checks "is logged in", not
-- "is this user the assigned driver."

CREATE POLICY "Authenticated can update itineraries"
  ON itineraries
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated can insert dispatch_status_logs"
  ON dispatch_status_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated can select dispatch_status_logs"
  ON dispatch_status_logs
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can insert delivery_receipts"
  ON delivery_receipts
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated can select delivery_receipts"
  ON delivery_receipts
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can insert delivery_damage_records"
  ON delivery_damage_records
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated can select delivery_damage_records"
  ON delivery_damage_records
  FOR SELECT
  TO authenticated
  USING (true);
