// AddClientModal: staff add a client by hand (a walk-in or phone-in
// customer) or edit one's details -- the canvas's "Add Client" / "Edit
// Client" on the Clients page. Pass `client` to edit that row; leave it out
// to add a new one. Name and phone are required; contact person, email,
// address and notes are optional. Phone and email use the same rules as
// every other form (lib/quoteRequest.ts). Adding warns first when another
// client already has the same name, phone or email (likely a duplicate).
// Logins are separate: "Set Up Account" on the Clients page.
import { useState } from 'react'
import { supabase } from '../../../lib/supabaseClient'
import { emailError, phoneDigits, phoneError, phoneInput } from '../../../lib/quoteRequest'
import { confirmDialog } from '../../../components/ConfirmDialog'

export type EditableClient = {
  client_id: number
  client_name: string
  contact_person: string | null
  email: string | null
  phone_number: string | null
  address: string | null
  notes: string | null
}

function AddClientModal({
  client,
  existing,
  onClose,
  onSaved,
}: {
  client?: EditableClient
  // Every client on file, for the duplicate warning.
  existing: { client_id: number; client_name: string; email: string | null; phone_number: string | null }[]
  onClose: () => void
  onSaved: (clientId: number) => void
}) {
  const [name, setName] = useState(client?.client_name ?? '')
  const [contactPerson, setContactPerson] = useState(client?.contact_person ?? '')
  const [phone, setPhone] = useState(phoneInput(client?.phone_number ?? ''))
  const [email, setEmail] = useState(client?.email ?? '')
  const [address, setAddress] = useState(client?.address ?? '')
  const [notes, setNotes] = useState(client?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const problem = !name.trim() ? 'Enter the client name.' : (phoneError(phone) ?? emailError(email))
    if (problem) return setError(problem)

    // Adding: look for a client that is probably the same one.
    if (!client) {
      const digits = phoneDigits(phone)
      const lowerName = name.trim().toLowerCase()
      const lowerEmail = email.trim().toLowerCase()
      const twin = existing.find(
        (c) =>
          c.client_name.trim().toLowerCase() === lowerName ||
          (c.phone_number ?? '').replace(/\D/g, '') === digits ||
          (lowerEmail !== '' && (c.email ?? '').trim().toLowerCase() === lowerEmail),
      )
      if (
        twin &&
        !(await confirmDialog({
          title: 'This client may already exist',
          message: `"${twin.client_name}" has the same name, phone or email. Add a new client anyway?`,
          confirmLabel: 'Add anyway',
        }))
      ) {
        return
      }
    }

    setSaving(true)
    setError(null)
    const row = {
      client_name: name.trim(),
      contact_person: contactPerson.trim() || null,
      phone_number: phoneDigits(phone),
      email: email.trim() || null,
      address: address.trim() || null,
      notes: notes.trim() || null,
    }
    const result = client
      ? await supabase.from('clients').update(row).eq('client_id', client.client_id).select('client_id').maybeSingle()
      : await supabase.from('clients').insert(row).select('client_id').single()
    setSaving(false)

    if (result.error) return setError(result.error.message)
    // An update blocked by RLS reports no error but changes nothing.
    if (!result.data) return setError('The client was not saved (no permission to edit clients).')
    onSaved(result.data.client_id)
  }

  const field =
    'min-h-11 w-full rounded-[2px] border border-line-control bg-white px-3 py-2 text-[15px] text-ink-metric placeholder:text-ink-muted focus:border-primary'
  const label = 'flex flex-col gap-1.5 text-sm font-semibold text-ink'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 px-4 py-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-labelledby="client-form-title" className="card flex w-full max-w-lg flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
          <h2 id="client-form-title" className="text-lg font-bold text-ink">
            {client ? `Edit ${client.client_name}` : 'Add Client'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-[2px] border border-line-control bg-white text-ink-secondary hover:bg-slate-50"
          >
            ✕
          </button>
        </header>

        <form
          className="grid gap-4 px-6 py-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <label className={`${label} sm:col-span-2`}>
            Client name (person or company)
            <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} className={field} />
          </label>
          <label className={label}>
            Contact person <span className="text-[13px] font-normal text-ink-muted">optional</span>
            <input value={contactPerson} maxLength={120} onChange={(e) => setContactPerson(e.target.value)} className={field} />
          </label>
          <label className={label}>
            Phone number
            <input
              type="tel"
              inputMode="numeric"
              value={phone}
              onChange={(e) => setPhone(phoneInput(e.target.value))}
              placeholder="0966 047 5467"
              className={`${field} tabular-nums`}
            />
          </label>
          <label className={`${label} sm:col-span-2`}>
            Email <span className="text-[13px] font-normal text-ink-muted">optional</span>
            <input type="email" value={email} maxLength={120} onChange={(e) => setEmail(e.target.value.replace(/\s/g, ''))} className={field} />
          </label>
          <label className={`${label} sm:col-span-2`}>
            Address <span className="text-[13px] font-normal text-ink-muted">optional</span>
            <input value={address} maxLength={250} onChange={(e) => setAddress(e.target.value)} className={field} />
          </label>
          <label className={`${label} sm:col-span-2`}>
            Notes <span className="text-[13px] font-normal text-ink-muted">optional, staff only</span>
            <textarea value={notes} maxLength={500} rows={2} onChange={(e) => setNotes(e.target.value)} className={field} />
          </label>
          {error && <p className="bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{error}</p>}
          {/* Hidden submit so Enter saves. */}
          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
        </form>

        <footer className="flex justify-end gap-3 border-t border-line px-6 py-4">
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary px-5 text-sm font-medium">
            Cancel
          </button>
          <button type="button" onClick={() => void save()} disabled={saving} className="btn-primary px-6 text-sm">
            {saving ? 'Saving...' : client ? 'Save Changes' : 'Add Client'}
          </button>
        </footer>
      </div>
    </div>
  )
}

export default AddClientModal
