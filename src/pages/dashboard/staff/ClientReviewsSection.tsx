// ClientReviewsSection: admin read-only view of every client's 1-5 star
// review of the business (client/ClientReviewSection.tsx). One row per
// client (they edit in place), so this is a snapshot of current
// sentiment, not a growing feed.
import { useEffect, useState } from 'react'
import { loadAllReviews, averageRating, type AdminClientReview } from '../../../lib/clientReviews'

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-amber-400" aria-label={`${rating} out of 5 stars`}>
      {'★'.repeat(rating)}
      <span className="text-slate-300">{'★'.repeat(5 - rating)}</span>
    </span>
  )
}

function ClientReviewsSection() {
  const [reviews, setReviews] = useState<AdminClientReview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    setLoading(true)
    const { reviews: loaded, error: loadError } = await loadAllReviews()

    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    setReviews(loaded)
    setError(null)
    setLoading(false)
  }

  if (loading) {
    return <p className="text-slate-500">Loading reviews...</p>
  }

  if (error) {
    return <p className="text-red-700">{error}</p>
  }

  if (reviews.length === 0) {
    return <p className="text-slate-500">No client reviews yet.</p>
  }

  const avg = averageRating(reviews)

  return (
    <div>
      {avg !== null && (
        <p className="mb-4 text-sm text-slate-600">
          Average rating: <span className="font-semibold text-slate-900">{avg.toFixed(1)}</span> /
          5 across {reviews.length} review{reviews.length === 1 ? '' : 's'}
        </p>
      )}

      <div className="grid gap-3">
        {reviews.map((review) => (
          <div
            key={review.review_id}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-baseline gap-2">
                <p className="font-semibold text-slate-900">{review.client_name}</p>
                <span className="text-xs text-slate-400">
                  {review.total_bookings} booking{review.total_bookings === 1 ? '' : 's'}
                </span>
              </div>
              <Stars rating={review.rating} />
            </div>
            {review.comment && (
              <p className="mt-2 text-sm text-slate-700">{review.comment}</p>
            )}
            <p className="mt-2 text-xs text-slate-400">
              Updated {new Date(review.updated_at).toLocaleDateString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default ClientReviewsSection
