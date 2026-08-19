-- Run this in Supabase Dashboard -> SQL Editor.
-- Adds the public-facing fields needed for the anonymous quote form,
-- and makes the internal foreign-key columns optional (a public visitor
-- has no client_id / place_of_pickup_id / place_of_delivery_id yet --
-- staff will link those later when reviewing the request).

ALTER TABLE quote_requests
  ADD COLUMN client_name VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN contact_number VARCHAR(20),
  ADD COLUMN contact_email VARCHAR(255),
  ADD COLUMN pickup_location_text VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN delivery_location_text VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN preferred_pickup_date DATE;

ALTER TABLE quote_requests
  ALTER COLUMN client_id DROP NOT NULL,
  ALTER COLUMN place_of_pickup_id DROP NOT NULL,
  ALTER COLUMN place_of_delivery_id DROP NOT NULL;

-- Allow anonymous (public) visitors to INSERT quote requests.
-- Without a policy like this, Row Level Security will silently block
-- the public form's insert even though the anon key can read the table.
CREATE POLICY "Public can submit quote requests"
  ON quote_requests
  FOR INSERT
  TO anon
  WITH CHECK (true);
