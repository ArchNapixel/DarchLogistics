// myProfile: data access + validation for the "My Profile" page, where an
// employee views and edits their OWN contact / emergency / government-ID info.
//
// Goes through two Postgres functions (SECURITY DEFINER) instead of
// reading/updating `employees` directly: row-level security can't limit
// WHICH COLUMNS an update touches, so opening UPDATE on the employee's own
// row would also let them change their salary or position. The functions
// only ever touch the fields listed in EDITABLE_KEYS, for the logged-in
// employee's own row.
//
// The limits and format rules below are mirrored in the SQL function
// update_my_profile() -- keep the two in sync (the page checks for friendly
// messages, the function checks so a direct API call can't skip them).
import { supabase } from './supabaseClient'
import { phoneDigits, phoneError, phoneInput } from './quoteRequest'

export type MyProfile = {
  // Read-only here (Admin edits these)
  employee_id: number
  full_name: string
  position: string
  hire_date: string
  // Editable
  phone_number: string | null
  date_of_birth: string | null
  email: string | null
  address: string | null
  city: string | null
  province: string | null
  zip_code: string | null
  emergency_contact_name: string | null
  emergency_contact_number: string | null
  tin_number: string | null
  sss_number: string | null
  philhealth_number: string | null
  pagibig_number: string | null
}

export type EditableKey =
  | 'phone_number' | 'date_of_birth' | 'email' | 'address' | 'city' | 'province' | 'zip_code'
  | 'emergency_contact_name' | 'emergency_contact_number'
  | 'tin_number' | 'sss_number' | 'philhealth_number' | 'pagibig_number'

// The editable fields as plain strings while typing ('' = blank).
export type ProfileForm = Record<EditableKey, string>

const LABELS: Record<EditableKey, string> = {
  phone_number: 'Phone number',
  date_of_birth: 'Date of birth',
  email: 'Personal email',
  address: 'Address',
  city: 'City',
  province: 'Province',
  zip_code: 'Zip code',
  emergency_contact_name: 'Emergency contact name',
  emergency_contact_number: 'Emergency contact number',
  tin_number: 'TIN',
  sss_number: 'SSS number',
  philhealth_number: 'PhilHealth number',
  pagibig_number: 'Pag-IBIG number',
}

// Max characters per field (also used as the inputs' maxLength).
export const PROFILE_MAX_LENGTH: Record<EditableKey, number> = {
  phone_number: 13, // 11 digits + 2 display spaces (0966 047 5467)
  date_of_birth: 10,
  email: 100,
  address: 200,
  city: 80,
  province: 80,
  zip_code: 10,
  emergency_contact_name: 100,
  emergency_contact_number: 13,
  tin_number: 20,
  sss_number: 20,
  philhealth_number: 20,
  pagibig_number: 20,
}

export const EDITABLE_KEYS = Object.keys(LABELS) as EditableKey[]

// Phone boxes: shown spaced (0966 047 5467), saved as digits only.
const PHONE_KEYS: EditableKey[] = ['phone_number', 'emergency_contact_number']

export const MIN_BIRTH_DATE = '1900-01-01'

export function profileToForm(p: MyProfile): ProfileForm {
  return Object.fromEntries(
    EDITABLE_KEYS.map((key) => [key, PHONE_KEYS.includes(key) ? phoneInput(p[key] ?? '') : (p[key] ?? '')]),
  ) as ProfileForm
}

// Trim spaces and drop control characters (a stray null/tab from a weird
// paste would otherwise make the database refuse the save).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g
export function cleanProfileForm(form: ProfileForm): ProfileForm {
  return Object.fromEntries(
    EDITABLE_KEYS.map((key) => {
      const value = form[key].replace(CONTROL_CHARS, '').trim()
      // Phones are saved without the display spaces: 09660475467.
      return [key, PHONE_KEYS.includes(key) ? phoneDigits(value) : value]
    }),
  ) as ProfileForm
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const GOV_ID_PATTERN = /^[A-Za-z0-9 -]+$/
// Names / places: letters (any language, accents ok), spaces, . ' -
const NAME_PATTERN = /^[\p{L}\p{M} .'’-]+$/u
const NAME_KEYS: EditableKey[] = ['emergency_contact_name', 'city', 'province']

// Applied on every keystroke/paste so a box never even HOLDS characters it
// can't accept (validation on Save alone lets people type anything).
// Returns the value with the disallowed characters removed.
export function filterInput(key: EditableKey, value: string): string {
  switch (key) {
    case 'phone_number':
    case 'emergency_contact_number':
      return phoneInput(value) // digits only, max 11, spaced 0966 047 5467
    case 'email':
      return value.replace(/\s/g, '')
    case 'tin_number':
    case 'sss_number':
    case 'philhealth_number':
    case 'pagibig_number':
    case 'zip_code':
      return value.replace(/[^A-Za-z0-9 -]/g, '')
    case 'emergency_contact_name':
    case 'city':
    case 'province':
      return value.replace(/[^\p{L}\p{M} .'’-]/gu, '')
    default:
      return value // address (free text) and the date picker
  }
}

// Returns the first problem as a plain sentence, or null if all is well.
// Expects a cleaned form (see cleanProfileForm). `today` is YYYY-MM-DD.
export function validateProfileForm(form: ProfileForm, today: string): string | null {
  if (!form.phone_number) return 'Enter your phone number.'

  for (const key of EDITABLE_KEYS) {
    if (form[key].length > PROFILE_MAX_LENGTH[key]) {
      return `${LABELS[key]} is too long (max ${PROFILE_MAX_LENGTH[key]} characters).`
    }
  }

  const phoneProblem = phoneError(form.phone_number)
  if (phoneProblem) return phoneProblem
  if (form.emergency_contact_number && phoneError(form.emergency_contact_number)) {
    return 'Emergency contact number must be 11 digits and start with 09.'
  }
  for (const key of NAME_KEYS) {
    if (form[key] && !NAME_PATTERN.test(form[key])) {
      return `${LABELS[key]} can only have letters, spaces and . ' -`
    }
  }
  if (form.zip_code && !GOV_ID_PATTERN.test(form.zip_code)) {
    return 'Zip code can only have letters, digits, spaces and dashes.'
  }
  if (form.email && !EMAIL_PATTERN.test(form.email)) {
    return 'Enter a valid email address, like name@example.com.'
  }
  if (form.date_of_birth && (form.date_of_birth < MIN_BIRTH_DATE || form.date_of_birth > today)) {
    return 'Enter a real date of birth (not in the future).'
  }
  for (const key of ['tin_number', 'sss_number', 'philhealth_number', 'pagibig_number'] as const) {
    if (form[key] && !GOV_ID_PATTERN.test(form[key])) {
      return `${LABELS[key]} can only have letters, digits, spaces and dashes.`
    }
  }
  return null
}

export async function loadMyProfile(): Promise<{ profile: MyProfile | null; error: string | null }> {
  const { data, error } = await supabase.rpc('get_my_profile')
  if (error) return { profile: null, error: error.message }
  return { profile: (data as MyProfile | null) ?? null, error: null }
}

// Sends ONLY the fields that changed, so saving can't overwrite something
// Admin edited meanwhile in a field the employee didn't touch. A blank
// value ('' ) clears that field (the function stores it as null).
export async function saveMyProfile(changes: Partial<ProfileForm>): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('update_my_profile', { p_changes: changes })
  return { error: error?.message ?? null }
}
