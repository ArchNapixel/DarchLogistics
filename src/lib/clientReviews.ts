// clientReviews: shared data access for a client's one-time (but
// editable) 1-5 star review of the business, like a Steam profile
// review -- not tied to a specific booking. `client_reviews.client_id`
// is unique, so saving is always an upsert: the first save inserts,
// every save after that updates the same row.
import { supabase } from './supabaseClient'

export type ClientReview = {
  review_id: number
  client_id: number
  rating: number
  comment: string | null
  created_at: string
  updated_at: string
}

export async function loadMyReview(
  clientId: number,
): Promise<{ review: ClientReview | null; error: string | null }> {
  const { data, error } = await supabase
    .from('client_reviews')
    .select('review_id, client_id, rating, comment, created_at, updated_at')
    .eq('client_id', clientId)
    .maybeSingle()

  if (error) {
    return { review: null, error: error.message }
  }

  return { review: data, error: null }
}

export async function saveMyReview({
  clientId,
  rating,
  comment,
}: {
  clientId: number
  rating: number
  comment: string
}): Promise<{ error: string | null }> {
  const { error } = await supabase.from('client_reviews').upsert(
    {
      client_id: clientId,
      rating,
      comment: comment.trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'client_id' },
  )

  return { error: error?.message ?? null }
}

export type AdminClientReview = ClientReview & {
  client_name: string
  // Total bookings this client has ever made (any status) -- shown next
  // to their review the way Steam shows a reviewer's hours played, as a
  // rough "how much history do they actually have with us" signal.
  total_bookings: number
}

export async function loadAllReviews(): Promise<{
  reviews: AdminClientReview[]
  error: string | null
}> {
  const { data: rows, error } = await supabase
    .from('client_reviews')
    .select('review_id, client_id, rating, comment, created_at, updated_at')
    .order('created_at', { ascending: false })

  if (error) {
    return { reviews: [], error: error.message }
  }
  if (rows.length === 0) {
    return { reviews: [], error: null }
  }

  const clientIds = Array.from(new Set(rows.map((r) => r.client_id)))
  const [clientsResult, bookingsResult] = await Promise.all([
    supabase.from('clients').select('client_id, client_name').in('client_id', clientIds),
    supabase.from('bookings').select('client_id').in('client_id', clientIds),
  ])

  if (clientsResult.error) {
    return { reviews: [], error: clientsResult.error.message }
  }
  if (bookingsResult.error) {
    return { reviews: [], error: bookingsResult.error.message }
  }

  const clientNameById = new Map(clientsResult.data.map((c) => [c.client_id, c.client_name]))
  const bookingCountByClient = new Map<number, number>()
  for (const booking of bookingsResult.data) {
    bookingCountByClient.set(
      booking.client_id,
      (bookingCountByClient.get(booking.client_id) ?? 0) + 1,
    )
  }

  return {
    reviews: rows.map((row) => ({
      ...row,
      client_name: clientNameById.get(row.client_id) ?? `Client #${row.client_id}`,
      total_bookings: bookingCountByClient.get(row.client_id) ?? 0,
    })),
    error: null,
  }
}

export function averageRating(reviews: { rating: number }[]): number | null {
  if (reviews.length === 0) return null
  return reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
}
