// ClientReviewSection: lets a client leave (or edit) one overall 1-5
// star review of the business, like a Steam profile review -- not tied
// to a specific booking. Self-contained (reads clientId from
// useAuth()) so it can be dropped into ClientDashboard.tsx directly.
import { useEffect, useState } from 'react'
import { useAuth } from '../../../context/AuthContext'
import { loadMyReview, saveMyReview } from '../../../lib/clientReviews'

function StarPicker({
  rating,
  onChange,
}: {
  rating: number
  onChange: (value: number) => void
}) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          className={`text-3xl leading-none ${
            value <= rating ? 'text-amber-400' : 'text-slate-300'
          } hover:text-amber-400`}
          aria-label={`${value} star${value > 1 ? 's' : ''}`}
        >
          ★
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
  const [savedMessage, setSavedMessage] = useState<string | null>(null)

  useEffect(() => {
    if (clientId) load(clientId)
  }, [clientId])

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

  async function handleSave() {
    if (!clientId) return

    if (rating === 0) {
      setError('Pick a star rating first.')
      return
    }

    setSaving(true)
    setError(null)
    setSavedMessage(null)

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
    setSavedMessage(lastSavedAt ? 'Review updated.' : 'Thanks for your review!')
  }

  if (loading) {
    return <p className="text-slate-500">Loading...</p>
  }

  return (
    <div>
      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {savedMessage && (
        <p className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
          {savedMessage}
        </p>
      )}

      <StarPicker rating={rating} onChange={setRating} />

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
        placeholder="Tell us about your experience (optional)"
        className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none"
      />

      {lastSavedAt && (
        <p className="mt-2 text-xs text-slate-400">
          Last updated {new Date(lastSavedAt).toLocaleDateString()} · Editing
          your review sends it back to our team before it can appear on our
          homepage.
        </p>
      )}

      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-4 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {saving ? 'Saving...' : lastSavedAt ? 'Update Review' : 'Submit Review'}
      </button>
    </div>
  )
}

export default ClientReviewSection
