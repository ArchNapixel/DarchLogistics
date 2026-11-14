-- 2026-11-14: empty-container return, step C. Edit & resubmit (a rejected
-- quote sent back by the client) now saves the return place too; before, the
-- function listed only the old columns, so a changed return place was dropped.
-- Live definition of 2026-11-14 with only the return_* lines added.

CREATE OR REPLACE FUNCTION public.resubmit_quote_request(p_quote_id bigint, p_changes jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_client_id public.users.client_id%type;
  r public.quote_requests;
begin
  select client_id into v_client_id
  from public.users
  where auth_user_id = auth.uid() and user_role = 'Client';
  if v_client_id is null then
    raise exception 'Only a client can resubmit a quote.';
  end if;

  r := jsonb_populate_record(null::public.quote_requests, p_changes);

  update public.quote_requests set
    pickup_location_text        = r.pickup_location_text,
    pickup_landmark             = r.pickup_landmark,
    pickup_city                 = r.pickup_city,
    pickup_barangay             = r.pickup_barangay,
    pickup_lat                  = r.pickup_lat,
    pickup_lng                  = r.pickup_lng,
    delivery_location_text      = r.delivery_location_text,
    delivery_landmark           = r.delivery_landmark,
    delivery_city               = r.delivery_city,
    delivery_barangay           = r.delivery_barangay,
    delivery_lat                = r.delivery_lat,
    delivery_lng                = r.delivery_lng,
    -- Empty container return (ticked off = all cleared). Staff measure the
    -- return distance again in Review Quote.
    return_container            = coalesce(r.return_container, false),
    return_location_text        = r.return_location_text,
    return_landmark             = r.return_landmark,
    return_city                 = r.return_city,
    return_barangay             = r.return_barangay,
    return_lat                  = r.return_lat,
    return_lng                  = r.return_lng,
    return_distance_km          = null,
    cargo_lines                 = r.cargo_lines,
    preferred_pickup_date       = r.preferred_pickup_date,
    payment_terms               = r.payment_terms,
    proposed_rate               = r.proposed_rate,
    is_last_day_of_port_storage = r.is_last_day_of_port_storage,
    preferred_delivery_date     = r.preferred_delivery_date,
    delivery_order_count        = r.delivery_order_count,
    previous_rejection_reason   = rejection_reason,
    rejection_reason            = null,
    rejection_tag               = null,
    resubmit_count              = resubmit_count + 1,
    request_status              = 'Pending'
  where quote_request_id = p_quote_id
    and client_id = v_client_id
    and request_status = 'Rejected';

  if not found then
    raise exception 'This quote can''t be resubmitted (not yours, or no longer Rejected).';
  end if;
end;
$function$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20261114050000', 'resubmit_quote_return_place') on conflict (version) do nothing;
