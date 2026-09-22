// ClientReviewsSection: admin view of every client's 1-5 star review of
// the business (client/ClientReviewSection.tsx). One row per client
// (they edit in place), so this is a snapshot of current sentiment, not
// a growing feed. "Feature" publishes a review to the public landing
// page (anonymized -- see clientReviews.ts's loadFeaturedReviews) --
// staff picks which reviews go public, nothing shows there by default.
import { useEffect, useState } from 'react'
import {
  loadAllReviews,
  setReviewFeatured,
  averageRating,
  type AdminClientReview,
} from '../../../lib/clientReviews'

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
  const [actionError, setActionError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)

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

  async function handleToggleFeatured(review: AdminClientReview) {
    setSavingId(review.review_id)
    setActionError(null)

    const { error: saveError } = await setReviewFeatured({
      reviewId: review.review_id,
      isFeatured: !review.is_featured,
    })

    setSavingId(null)

    if (saveError) {
      setActionError(saveError)
      return
    }

    setReviews((prev) =>
      prev.map((r) =>
        r.review_id === review.review_id ? { ...r, is_featured: !r.is_featured } : r,
      ),
    )
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

      {actionError && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
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
                {review.is_featured && (
                  <span className="bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">
                    Public
                  </span>
                )}
              </div>
              <Stars rating={review.rating} />
            </div>
            {review.comment && (
              <p className="mt-2 text-sm text-slate-700">{review.comment}</p>
            )}
            <div className="mt-2 flex items-center justify-between">
              <p className="text-xs text-slate-400">
                Updated {new Date(review.updated_at).toLocaleDateString()}
              </p>
              <button
                onClick={() => handleToggleFeatured(review)}
                disabled={savingId === review.review_id}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                  review.is_featured
                    ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    : 'bg-slate-900 text-white hover:bg-slate-700'
                }`}
              >
                {savingId === review.review_id
                  ? 'Saving...'
                  : review.is_featured
                    ? 'Unfeature'
                    : 'Feature on website'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default ClientReviewsSection
