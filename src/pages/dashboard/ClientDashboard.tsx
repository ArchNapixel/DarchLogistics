// ClientDashboard: shown to the Client role.
//
// The welcome banner shows clients.client_name (the real business name
// on file), not users.username -- username is just a login handle and
// can be set to anything at account creation (e.g. staff typed
// "client" as a placeholder), while client_name is the name a client
// can now edit themselves in "My Profile" below. Profile state lives
// here (not inside ClientProfileSection) so an edit there updates the
// welcome banner immediately, without a second fetch.
import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import RoleBadge from '../../components/RoleBadge'
import MyBookingsSection from './client/MyBookingsSection'
import NewQuoteModal from './client/NewQuoteModal'
import ClientProfileSection, {
  type ClientProfile,
} from './client/ClientProfileSection'
import ClientPaymentsSection from './client/ClientPaymentsSection'

function ClientDashboard() {
  const { username, role, clientId } = useAuth()
  const [profile, setProfile] = useState<ClientProfile | null>(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [showNewQuote, setShowNewQuote] = useState(false)
  const [submittedMessage, setSubmittedMessage] = useState<string | null>(
    null,
  )

  useEffect(() => {
    if (clientId) {
      loadProfile(clientId)
    } else {
      setProfileLoading(false)
    }
  }, [clientId])

  async function loadProfile(id: number) {
    setProfileLoading(true)

    const { data, error: loadError } = await supabase
      .from('clients')
      .select('client_name, email, phone_number')
      .eq('client_id', id)
      .maybeSingle()

    if (loadError) {
      setProfileError(loadError.message)
      setProfileLoading(false)
      return
    }

    setProfile(data)
    setProfileError(null)
    setProfileLoading(false)
  }

  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-900">
          Welcome, {profile?.client_name ?? username}
        </h1>
        <RoleBadge role={role} />
      </div>

      {submittedMessage && (
        <p className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">
          {submittedMessage}
        </p>
      )}

      <div className="mt-8 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">My Profile</h2>
        <div className="mt-4">
          {clientId && (
            <ClientProfileSection
              clientId={clientId}
              profile={profile}
              loading={profileLoading}
              error={profileError}
              onSaved={(updated) => setProfile(updated)}
            />
          )}
        </div>
      </div>

      <div className="mt-8 flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">
              My Bookings
            </h2>
            {clientId && (
              <button
                onClick={() => setShowNewQuote(true)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
              >
                New Quote Request
              </button>
            )}
          </div>
          <div className="mt-4">
            <MyBookingsSection />
          </div>
        </div>

        <div className="w-full rounded-xl border border-slate-200 bg-white p-8 shadow-sm lg:max-w-sm">
          <h2 className="text-lg font-semibold text-slate-900">
            Payments Due
          </h2>
          <div className="mt-4">
            {clientId && <ClientPaymentsSection clientId={clientId} />}
          </div>
        </div>
      </div>

      {showNewQuote && clientId && (
        <NewQuoteModal
          clientId={clientId}
          onClose={() => setShowNewQuote(false)}
          onCreated={() => {
            setShowNewQuote(false)
            setSubmittedMessage(
              'Quote request submitted. Our team will review it and get back to you.',
            )
          }}
        />
      )}
    </div>
  )
}

export default ClientDashboard
