-- Run this in Supabase Dashboard -> SQL Editor.
-- Lets any logged-in (authenticated) user read itinerary_crews,
-- itineraries, and work_orders -- needed for a Driver/Mechanic to see
-- their own assigned trips/work orders. The app filters to "their own"
-- by employee_id in the query itself; these policies don't restrict rows
-- at the database level (same simplification noted in the earlier
-- staff_actions migration).

CREATE POLICY "Authenticated can select itinerary_crews"
  ON itinerary_crews
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can select itineraries"
  ON itineraries
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can select work_orders"
  ON work_orders
  FOR SELECT
  TO authenticated
  USING (true);
