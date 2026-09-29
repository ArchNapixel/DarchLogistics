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

// Steam-style "% positive" summary label. Steam uses thumbs up/down;
// this adapts it to 1-5 stars by treating 4-5 as "positive". Needs a
// small sample before the label means anything, same as Steam holding
// off on a descriptor until a game has enough reviews.
export function reviewSummary(reviews: { rating: number }[]): {
  label: string
  percentPositive: number | null
  averageRating: number | null
} {
  if (reviews.length === 0) {
    return { label: 'No reviews yet', percentPositive: null, averageRating: null }
  }

  const positive = reviews.filter((r) => r.rating >= 4).length
  const percentPositive = Math.round((positive / reviews.length) * 100)
  const avg = averageRating(reviews)

  let label: string
  if (reviews.length < 3) {
    label = 'Not enough reviews yet'
  } else if (percentPositive >= 95) {
    label = 'Overwhelmingly Positive'
  } else if (percentPositive >= 80) {
    label = 'Very Positive'
  } else if (percentPositive >= 70) {
    label = 'Mostly Positive'
  } else if (percentPositive >= 40) {
    label = 'Mixed'
  } else if (percentPositive >= 20) {
    label = 'Mostly Negative'
  } else {
    label = 'Overwhelmingly Negative'
  }

  return { label, percentPositive, averageRating: avg }
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
      // Any edit takes the review off the public landing page until
      // staff re-feature it -- otherwise a client could change the text
      // of an already-approved featured review with no one checking.
      is_featured: false,
    },
    { onConflict: 'client_id' },
  )

  return { error: error?.message ?? null }
}

export type AdminClientReview = ClientReview & {
  client_name: string
  is_featured: boolean
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
    .select('review_id, client_id, rating, comment, created_at, updated_at, is_featured')
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

export async function setReviewFeatured({
  reviewId,
  isFeatured,
}: {
  reviewId: number
  isFeatured: boolean
}): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('client_reviews')
    .update({ is_featured: isFeatured })
    .eq('review_id', reviewId)

  return { error: error?.message ?? null }
}

export type PublicClientReview = {
  review_id: number
  rating: number
  comment: string | null
  created_at: string
  total_bookings: number
}

// Public-facing, anonymized: no client_id/client_name leaves this
// function, and only reviews staff has explicitly marked is_featured
// are ever returned (also enforced at the RLS level -- see
// client_reviews_select_featured_public -- this is defense in depth,
// not the only thing stopping an unfeatured review from leaking).
export async function loadFeaturedReviews(): Promise<{
  reviews: PublicClientReview[]
  error: string | null
}> {
  const { data: rows, error } = await supabase
    .from('client_reviews')
    .select('review_id, client_id, rating, comment, created_at')
    .eq('is_featured', true)
    .order('created_at', { ascending: false })

  if (error) {
    return { reviews: [], error: error.message }
  }
  if (rows.length === 0) {
    return { reviews: [], error: null }
  }

  const clientIds = Array.from(new Set(rows.map((r) => r.client_id)))
  // A public visitor has no SELECT access to `bookings` (it holds rates,
  // cargo details, contract info), so this goes through a narrow
  // SECURITY DEFINER function that returns only aggregate counts --
  // never a real booking row -- instead of querying bookings directly.
  const { data: counts, error: countsError } = await supabase.rpc(
    'count_bookings_for_clients',
    { client_ids: clientIds },
  )

  if (countsError) {
    return { reviews: [], error: countsError.message }
  }

  const bookingCountByClient = new Map<number, number>(
    (counts ?? []).map((row: { client_id: number; booking_count: number }) => [
      row.client_id,
      row.booking_count,
    ]),
  )

  return {
    reviews: rows.map((row) => ({
      review_id: row.review_id,
      rating: row.rating,
      comment: row.comment,
      created_at: row.created_at,
      total_bookings: bookingCountByClient.get(row.client_id) ?? 0,
    })),
    error: null,
  }
}

export function averageRating(reviews: { rating: number }[]): number | null {
  if (reviews.length === 0) return null
  return reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
}
