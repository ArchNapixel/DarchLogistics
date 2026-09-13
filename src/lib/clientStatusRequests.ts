// clientStatusRequests: shared data access for a client asking staff
// for a status update on one of their bookings (optionally a specific
// itinerary within it). Same request/respond shape as
// cashAdvanceRequests.ts -- client submits 'Pending', staff responds
// and it becomes 'Responded'.
import { supabase } from './supabaseClient'

export type StatusRequestStatus = 'Pending' | 'Responded'

export type ClientStatusRequest = {
  request_id: number
  client_id: number
  booking_id: number
  itinerary_id: number | null
  message: string
  status: StatusRequestStatus
  staff_response: string | null
  responded_at: string | null
  created_at: string
}

const REQUEST_COLUMNS =
  'request_id, client_id, booking_id, itinerary_id, message, status, staff_response, responded_at, created_at'

export async function requestClientStatus({
  clientId,
  bookingId,
  itineraryId,
  message,
}: {
  clientId: number
  bookingId: number
  itineraryId?: number | null
  message: string
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from('client_status_requests').insert({
    client_id: clientId,
    booking_id: bookingId,
    itinerary_id: itineraryId ?? null,
    message,
  })

  return { error: error?.message ?? null }
}

export async function loadStatusRequestsForClient(
  clientId: number,
): Promise<{ requests: ClientStatusRequest[]; error: string | null }> {
  const { data, error } = await supabase
    .from('client_status_requests')
    .select(REQUEST_COLUMNS)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (error) {
    return { requests: [], error: error.message }
  }

  return { requests: data, error: null }
}

export type PendingStatusRequest = ClientStatusRequest & {
  client_name: string
  pickup_place_name: string
  delivery_place_name: string
}

export async function loadPendingStatusRequests(): Promise<{
  requests: PendingStatusRequest[]
  error: string | null
}> {
  const { data: rows, error } = await supabase
    .from('client_status_requests')
    .select(REQUEST_COLUMNS)
    .eq('status', 'Pending')
    .order('created_at', { ascending: true })

  if (error) {
    return { requests: [], error: error.message }
  }
  if (rows.length === 0) {
    return { requests: [], error: null }
  }

  const clientIds = Array.from(new Set(rows.map((row) => row.client_id)))
  const bookingIds = Array.from(new Set(rows.map((row) => row.booking_id)))

  const [clientsResult, bookingsResult] = await Promise.all([
    supabase.from('clients').select('client_id, client_name').in('client_id', clientIds),
    supabase
      .from('bookings')
      .select('booking_id, place_of_pickup_id, place_of_delivery_id')
      .in('booking_id', bookingIds),
  ])

  if (clientsResult.error) {
    return { requests: [], error: clientsResult.error.message }
  }
  if (bookingsResult.error) {
    return { requests: [], error: bookingsResult.error.message }
  }

  const placeIds = Array.from(
    new Set(
      bookingsResult.data.flatMap((b) => [b.place_of_pickup_id, b.place_of_delivery_id]),
    ),
  )

  const { data: places, error: placesError } =
    placeIds.length > 0
      ? await supabase.from('places').select('place_id, place_name').in('place_id', placeIds)
      : { data: [], error: null }

  if (placesError) {
    return { requests: [], error: placesError.message }
  }

  const clientNameById = new Map(
    clientsResult.data.map((c) => [c.client_id, c.client_name]),
  )
  const bookingById = new Map(bookingsResult.data.map((b) => [b.booking_id, b]))
  const placeNameById = new Map((places ?? []).map((p) => [p.place_id, p.place_name]))

  return {
    requests: rows.map((row) => {
      const booking = bookingById.get(row.booking_id)
      return {
        ...row,
        client_name: clientNameById.get(row.client_id) ?? `Client #${row.client_id}`,
        pickup_place_name: booking
          ? (placeNameById.get(booking.place_of_pickup_id) ?? '—')
          : '—',
        delivery_place_name: booking
          ? (placeNameById.get(booking.place_of_delivery_id) ?? '—')
          : '—',
      }
    }),
    error: null,
  }
}

// Not race-guarded like decideCashAdvanceRequest -- responding to a
// question isn't a one-shot resource two staff could double-spend, so
// a plain update is fine here.
export async function respondToStatusRequest({
  requestId,
  response,
  respondedByEmployeeId,
}: {
  requestId: number
  response: string
  respondedByEmployeeId: number
}): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('client_status_requests')
    .update({
      status: 'Responded',
      staff_response: response,
      responded_by: respondedByEmployeeId,
      responded_at: new Date().toISOString(),
    })
    .eq('request_id', requestId)

  return { error: error?.message ?? null }
}
