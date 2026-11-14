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

// name@example.com: a dot-separated domain ending in a 2+ letter TLD.
const EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/
// Names / places: letters (any language, accents ok), spaces, . ' -
const NAME_PATTERN = /^[\p{L}\p{M} .'’-]+$/u
const NAME_KEYS: EditableKey[] = ['emergency_contact_name', 'city', 'province']

// Person names (employee first / middle / last, emergency contact) and
// city / province: letters of any language (ñ, accents ok) and spaces only --
// no digits or symbols, except the three marks real names use (Ma. /
// O'Brien / Dela Cruz-Reyes), and a mark only RIGHT AFTER a letter, so
// "-----", ". ." or a leading "-" can't be typed. Used as a typing filter;
// double spaces collapse and a leading space is dropped.
export function filterPersonName(value: string): string {
  return value
    .replace(/\s/g, ' ')
    .replace(/[^\p{L}\p{M} .'’-]/gu, '')
    .replace(/(?<![\p{L}\p{M}])[.'’-]/gu, '')
    .replace(/ {2,}/g, ' ')
    .replace(/^ /, '')
}

// A name made only of marks ("..", "-") isn't a name.
export const hasLetter = (value: string) => /\p{L}/u.test(value)

// Government IDs: digits only, the dashes are added while typing. Each ID's
// digit groups and the digit counts it may have (TIN = 9, or 12 with the
// branch code). Philippine zip codes are 4 digits.
const GOV_IDS = {
  tin_number: { groups: [3, 3, 3, 3], counts: [9, 12], example: '123-456-789 or 123-456-789-000' },
  sss_number: { groups: [2, 7, 1], counts: [10], example: '12-3456789-0' },
  philhealth_number: { groups: [2, 9, 1], counts: [12], example: '12-345678901-2' },
  pagibig_number: { groups: [4, 4, 4], counts: [12], example: '1234-5678-9012' },
} as const
type GovIdKey = keyof typeof GOV_IDS

// Which keyboard a phone shows for a field: number pad for IDs / zip,
// phone pad for phone numbers.
export function inputModeFor(key: EditableKey): 'tel' | 'numeric' | undefined {
  if (key === 'phone_number' || key === 'emergency_contact_number') return 'tel'
  if (key === 'zip_code' || key in GOV_IDS) return 'numeric'
  return undefined
}
const GOV_ID_KEYS = Object.keys(GOV_IDS) as GovIdKey[]

function formatGovId(key: GovIdKey, value: string): string {
  const { groups } = GOV_IDS[key]
  let digits = value.replace(/\D/g, '').slice(0, groups.reduce((a, b) => a + b, 0))
  const parts: string[] = []
  for (const size of groups) {
    if (!digits) break
    parts.push(digits.slice(0, size))
    digits = digits.slice(size)
  }
  return parts.join('-')
}

// Address: letters, digits, spaces and . , # - / ' ( ) -- a symbol can't
// repeat ("--", "..", "##" collapse to one; "St., Brgy." is fine) and no
// symbol at the very start except # (house no.) or ( .
function filterAddress(value: string): string {
  return value
    .replace(/\s/g, ' ')
    .replace(/[^\p{L}\p{M}0-9 .,#/'’()-]/gu, '')
    .replace(/([.,#/'’()-])\1+/g, '$1')
    .replace(/^[ .,/'’)-]+/, '')
    .replace(/ {2,}/g, ' ')
}

// Applied on every keystroke/paste so a box never even HOLDS characters it
// can't accept (validation on Save alone lets people type anything).
// Returns the value with the disallowed characters removed.
export function filterInput(key: EditableKey, value: string): string {
  switch (key) {
    case 'phone_number':
    case 'emergency_contact_number':
      return phoneInput(value) // digits only, max 11, spaced 0966 047 5467
    case 'email':
      return value.replace(/[^A-Za-z0-9._%+@-]/g, '')
    case 'tin_number':
    case 'sss_number':
    case 'philhealth_number':
    case 'pagibig_number':
      return formatGovId(key, value) // digits only, dashes added: 12-3456789-0
    case 'zip_code':
      return value.replace(/\D/g, '').slice(0, 4)
    case 'emergency_contact_name':
    case 'city':
    case 'province':
      return filterPersonName(value)
    case 'address':
      return filterAddress(value)
    default:
      return value // the date picker
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
    if (form[key] && (!NAME_PATTERN.test(form[key]) || !hasLetter(form[key]))) {
      return `${LABELS[key]} can only have letters, spaces and . ' -`
    }
  }
  if (form.zip_code && !/^\d{4}$/.test(form.zip_code)) {
    return 'Zip code must be 4 digits, like 8105.'
  }
  if (form.address && !hasLetter(form.address)) {
    return 'Address must include a street, barangay or place name.'
  }
  if (form.email && !EMAIL_PATTERN.test(form.email)) {
    return 'Enter a valid email address, like name@example.com.'
  }
  if (form.date_of_birth && (form.date_of_birth < MIN_BIRTH_DATE || form.date_of_birth > today)) {
    return 'Enter a real date of birth (not in the future).'
  }
  for (const key of GOV_ID_KEYS) {
    if (!form[key]) continue
    const { counts, example } = GOV_IDS[key]
    const digits = form[key].replace(/\D/g, '').length
    if (!/^[0-9-]+$/.test(form[key]) || !(counts as readonly number[]).includes(digits)) {
      return `${LABELS[key]} must be ${counts.join(' or ')} digits, like ${example}.`
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
