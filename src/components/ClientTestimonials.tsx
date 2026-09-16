// ClientTestimonials: public "What clients say" section, styled after
// Steam's review presentation -- a "% positive" summary badge, then
// individual review cards. Only reviews staff explicitly marked
// Featured (ClientReviewsSection.tsx) ever appear here, and always
// anonymized (see clientReviews.ts's loadFeaturedReviews -- no
// client_id/client_name leaves that function, enforced again at the
// RLS level as a second layer). "N bookings" plays the same role Steam
// gives "X hours played" next to a reviewer -- a credibility signal
// without revealing who they are.
import { useEffect, useState } from 'react'
import {
  loadFeaturedReviews,
  reviewSummary,
  type PublicClientReview,
} from '../lib/clientReviews'

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-amber-400" aria-label={`${rating} out of 5 stars`}>
      {'★'.repeat(rating)}
      <span className="text-slate-300">{'★'.repeat(5 - rating)}</span>
    </span>
  )
}

// Steam's badge color roughly tracks the label's positivity -- green for
// positive tiers, yellow for mixed, red for negative.
function summaryTone(label: string): string {
  if (label.includes('Positive')) return 'bg-emerald-600'
  if (label === 'Mixed') return 'bg-amber-500'
  if (label.includes('Negative')) return 'bg-red-600'
  return 'bg-slate-400'
}

function ClientTestimonials() {
  const [reviews, setReviews] = useState<PublicClientReview[] | null>(null)

  useEffect(() => {
    loadFeaturedReviews().then(({ reviews: loaded, error }) => {
      if (!error) {
        setReviews(loaded)
      }
    })
  }, [])

  // Nothing to show yet -- don't render an empty/awkward section on the
  // public homepage while reviews load or if none are featured.
  if (!reviews || reviews.length === 0) {
    return null
  }

  const summary = reviewSummary(reviews)

  return (
    <section id="reviews" className="bg-brand-paper pb-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-t border-slate-300 pt-10">
          <h2 className="font-display text-3xl font-semibold text-slate-900 uppercase sm:text-4xl">
            What Clients Say
          </h2>
          <p className="text-xs font-semibold tracking-[0.15em] text-slate-500 uppercase">
            {reviews.length} verified review{reviews.length === 1 ? '' : 's'}
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <span
            className={`rounded px-3 py-1.5 text-sm font-bold tracking-wide text-white uppercase ${summaryTone(summary.label)}`}
          >
            {summary.label}
          </span>
          {summary.percentPositive !== null && (
            <p className="text-sm text-slate-600">
              {summary.percentPositive}% of clients rated their service positively
            </p>
          )}
          {summary.averageRating !== null && (
            <div className="flex items-center gap-2">
              <Stars rating={Math.round(summary.averageRating)} />
              <span className="text-sm text-slate-600">
                {summary.averageRating.toFixed(1)} / 5
              </span>
            </div>
          )}
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reviews.map((review) => (
            <div
              key={review.review_id}
              className="border border-slate-300 bg-white p-5"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">Verified Client</p>
                <Stars rating={review.rating} />
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {review.total_bookings} booking{review.total_bookings === 1 ? '' : 's'} with us
              </p>
              {review.comment && (
                <p className="mt-3 text-sm text-slate-700">{review.comment}</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

export default ClientTestimonials
