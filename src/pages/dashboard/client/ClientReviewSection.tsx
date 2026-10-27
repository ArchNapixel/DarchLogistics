// ClientReviewSection: the "Rate Us" card on My Profile (the canvas's
// Client My Profile board) -- one overall 1-5 star review of the business,
// like a Steam profile review -- not tied to a specific booking. Self-contained (reads clientId from
// useAuth()) so it can be dropped into ClientDashboard.tsx directly.
import { useEffect, useEffectEvent, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { loadMyReview, saveMyReview } from '../../../lib/clientReviews'
import { showToast } from '../../../components/Toast'
import { formatDate } from '../../../lib/format'

// Five star buttons, as a radio group (arrow keys aren't wired -- each
// star is its own button with a clear label).
function StarPicker({
  rating,
  onChange,
}: {
  rating: number
  onChange: (value: number) => void
}) {
  return (
    <div role="radiogroup" aria-label="Your rating" className="flex gap-1.5">
      {[1, 2, 3, 4, 5].map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={value === rating}
          onClick={() => onChange(value)}
          aria-label={`${value} star${value > 1 ? 's' : ''}`}
          className={`flex h-11 w-11 items-center justify-center rounded-[2px] border ${
            value <= rating ? 'border-amber-600 bg-amber-50 text-amber-600' : 'border-line-control bg-white text-ink-muted hover:bg-slate-50'
          }`}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill={value <= rating ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z" />
          </svg>
        </button>
      ))}
    </div>
  )
}

function ClientReviewSection() {
  const { clientId } = useAuth()
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function load(id: number) {
    setLoading(true)
    const { review, error: loadError } = await loadMyReview(id)

    if (loadError) {
      setError(loadError)
      setLoading(false)
      return
    }

    if (review) {
      setRating(review.rating)
      setComment(review.comment ?? '')
      setLastSavedAt(review.updated_at)
    }

    setError(null)
    setLoading(false)
  }

  // Load when this opens and whenever clientId changes.
  // (useEffectEvent + 0 ms timer: see "Loading data in an effect" in CLAUDE.md.)
  const loadNow = useEffectEvent(() => {
    if (clientId) load(clientId)
  })
  useEffect(() => {
    const timer = setTimeout(loadNow, 0)
    return () => clearTimeout(timer)
  }, [clientId])

  async function handleSave() {
    if (!clientId) return

    if (rating === 0) {
      setError('Pick a star rating first.')
      return
    }

    setSaving(true)
    setError(null)

    const { error: saveError } = await saveMyReview({
      clientId,
      rating,
      comment,
    })

    setSaving(false)

    if (saveError) {
      setError(saveError)
      return
    }

    setLastSavedAt(new Date().toISOString())
    showToast(lastSavedAt ? 'Review updated.' : 'Thanks for your review!')
  }

  return (
    <section aria-labelledby="pf-r" className="card flex flex-col">
      <div className="border-b border-line px-5 py-4">
        <h2 id="pf-r" className="text-base font-semibold text-ink">
          Rate Us
        </h2>
        <p className="text-[13px] text-ink-muted">How was our service on your bookings?</p>
      </div>
      {loading ? (
        <p className="px-5 py-4 text-ink-muted">Loading...</p>
      ) : (
        <>
          <div className="flex flex-col gap-4 px-5 py-4">
            {error && <p className="bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-semibold text-ink">Your rating</p>
              <StarPicker rating={rating} onChange={setRating} />
              <p className="text-[13px] text-ink-muted">{rating ? `${rating} of 5 stars` : 'No rating yet. Choose 1 to 5 stars.'}</p>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-ink">
                Comment <span className="font-normal text-ink-muted">(optional)</span>
              </span>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={4}
                maxLength={1000}
                placeholder="What went well? What can we do better?"
                className="min-h-11 w-full resize-none rounded-[2px] border border-line-control bg-white px-3 py-2.5 text-sm font-medium text-ink-metric placeholder:font-normal placeholder:text-ink-muted focus:border-primary"
              />
            </label>
            <p className="text-[13px] leading-[18px] text-ink-muted">
              {lastSavedAt
                ? `Last updated ${formatDate(lastSavedAt)}. Editing your review sends it back to our team before it can appear on our homepage.`
                : 'You can change your review later. After you submit, this button becomes Update Review.'}
            </p>
          </div>
          <div className="mt-auto flex justify-end border-t border-line px-5 py-4">
            <button type="button" onClick={() => void handleSave()} disabled={saving} className="btn-primary px-5 text-sm">
              {saving ? 'Saving...' : lastSavedAt ? 'Update Review' : 'Submit Review'}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

export default ClientReviewSection
