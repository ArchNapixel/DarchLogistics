// LocationPicker: one end of a quote's route (pickup or delivery) --
// City + Barangay dropdowns (from location_reference), an optional
// landmark/address field, one-click picks (known ports/terminals, plus
// the client's own recent locations in the client portal), and an
// optional map for the exact spot. Used by all three quote channels.
// Barangay is what places/route_cache key routing/distance-caching off
// of -- the landmark detail is just for a driver to find the spot.
//
// The map pin is saved as lat/lng (the most precise thing we know about
// the location -- QuoteReviewModal routes between the two pins for the
// trip distance, and it's copied onto the booking for drivers). A pin
// (map click or "Use my location") is reverse-geocoded to
// *suggest* a city/barangay:
//   - a spot that can't be placed in a serviced city changes nothing
//   - otherwise the pin, city and barangay are replaced together; a
//     barangay the lookup couldn't confirm is left blank for the user
//     to pick, never carried over from an earlier pick, so the pin and
//     the dropdowns can't silently disagree
//   - the dropdowns stay editable -- correcting the barangay keeps the
//     pin, switching to a different city drops it (it can't be right)
import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import {
  loadLocationReference,
  loadNamedLocations,
  citiesFrom,
  barangaysForCity,
  matchLocation,
  type LocationReferenceRow,
  type NamedLocation,
} from '../lib/locationReference'
import { geocodePlace, reverseGeocode } from '../lib/geocoding'
import { pickupIcon, deliveryIcon, DEFAULT_CENTER } from '../lib/leafletIcons'
import type { LocationValue, RecentLocation } from '../lib/quoteRequest'

const STOP_LABELS = { pickup: 'Pickup', delivery: 'Delivery' }

const selectClasses =
  'border-2 border-slate-300 bg-white px-3 py-2 text-slate-900 transition-colors hover:border-slate-500 hover:bg-slate-50 focus:border-slate-500 focus:outline-none disabled:bg-slate-100 disabled:text-slate-400'

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

// Moves the map whenever `target` changes (a barangay chosen, or the
// user's own location found).
function FlyTo({ target }: { target: { point: [number, number]; zoom: number } | null }) {
  const map = useMap()

  useEffect(() => {
    if (target) map.flyTo(target.point, target.zoom)
  }, [map, target])

  return null
}

function PinIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
      <path
        fillRule="evenodd"
        d="M10 18s6-5.3 6-10a6 6 0 1 0-12 0c0 4.7 6 10 6 10Zm0-7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function LocationPicker({
  stop,
  value,
  onChange,
  error,
  recentLocations = [],
}: {
  stop: 'pickup' | 'delivery'
  value: LocationValue
  onChange: (value: LocationValue) => void
  error?: string
  // Client portal only: spots from the client's own past bookings.
  recentLocations?: RecentLocation[]
}) {
  const [rows, setRows] = useState<LocationReferenceRow[]>([])
  const [namedLocations, setNamedLocations] = useState<NamedLocation[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  // false = quick picks only; true = manual City/Barangay/Address + map.
  // Starts open if a location is already filled in (e.g. stepping back in the wizard).
  const [specific, setSpecific] = useState(value.city !== '')
  const [showMap, setShowMap] = useState(false)
  // Shown the instant a spot is chosen, before the lookup finishes.
  const [pendingPin, setPendingPin] = useState<[number, number] | null>(null)
  const [mapNote, setMapNote] = useState<string | null>(null)
  const [flyTarget, setFlyTarget] = useState<{ point: [number, number]; zoom: number } | null>(
    null,
  )
  const [locating, setLocating] = useState(false)
  // Bumped on every pin, so a slow lookup for an earlier pin can't land
  // after a newer one and overwrite it.
  const latestPin = useRef(0)

  useEffect(() => {
    loadLocationReference().then(({ rows: loaded, error: rowsError }) => {
      if (rowsError) {
        setLoadError("We couldn't load the list of locations. Refresh the page to try again.")
        return
      }
      setRows(loaded)
    })
    loadNamedLocations().then(({ locations }) => {
      // Quick picks are only a shortcut -- if they fail to load, the
      // dropdowns still work, so no error is shown.
      setNamedLocations(locations)
    })
  }, [])

  // With no pin yet, centre the map on the chosen barangay (or city) so
  // the user only has to find the exact spot inside it.
  const hasPin = value.lat !== null
  useEffect(() => {
    if (!showMap || hasPin || !value.city) return

    let cancelled = false
    const query = value.barangay
      ? `Barangay ${value.barangay}, ${value.city}, Philippines`
      : `${value.city}, Philippines`
    geocodePlace(query).then((point) => {
      if (!cancelled && point) {
        setFlyTarget({ point: [point.lat, point.lon], zoom: value.barangay ? 15 : 13 })
      }
    })
    return () => {
      cancelled = true
    }
  }, [showMap, hasPin, value.city, value.barangay])

  function pickShortcut(location: LocationValue) {
    onChange({
      city: location.city,
      barangay: location.barangay,
      detail: location.detail,
      lat: location.lat,
      lng: location.lng,
    })
    setMapNote(null)
  }

  async function placePin(lat: number, lng: number) {
    const pinId = ++latestPin.current
    setPendingPin([lat, lng])
    setMapNote('Finding spot…')

    const address = await reverseGeocode(lat, lng)
    if (pinId !== latestPin.current) return
    setPendingPin(null)

    // A spot we can't place in a serviced city changes nothing -- the
    // form keeps whatever (consistent) pick it had before.
    if (!address) {
      setMapNote("Couldn't look up that spot. Try again.")
      return
    }
    const match = matchLocation(rows, address)
    if (!match) {
      setMapNote("Outside our service area.")
      return
    }

    const barangay = match.barangay ?? ''
    // The landmark text belonged to the old spot -- keep it only if the
    // pin is still in the same barangay.
    const sameBarangay =
      match.city === value.city && barangay === value.barangay && barangay !== ''

    onChange({
      city: match.city,
      barangay,
      detail: sameBarangay ? value.detail : '',
      lat,
      lng,
    })

    setMapNote(
      match.barangay
        ? `Brgy. ${match.barangay}, ${match.city}`
        : `${match.city}. Pick the barangay.`,
    )
  }

  function locateMe() {
    if (!navigator.geolocation) {
      setMapNote("Location unavailable. Click the map.")
      return
    }
    setShowMap(true)
    setLocating(true)
    setMapNote('Locating…')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false)
        const { latitude, longitude } = position.coords
        setFlyTarget({ point: [latitude, longitude], zoom: 17 })
        placePin(latitude, longitude)
      },
      (geoError) => {
        setLocating(false)
        setMapNote(
          geoError.code === geoError.PERMISSION_DENIED
            ? 'Location blocked. Click the map.'
            : "Location not found. Click the map.",
        )
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const cities = citiesFrom(rows)
  const barangays = barangaysForCity(rows, value.city)
  const savedPin: [number, number] | null =
    value.lat !== null && value.lng !== null ? [value.lat, value.lng] : null
  const shownPin = pendingPin ?? savedPin
  const isSelected = (location: LocationValue) =>
    value.city === location.city &&
    value.barangay === location.barangay &&
    value.detail === location.detail
  const namedShortcuts: RecentLocation[] = namedLocations.map((named) => ({
    city: named.city,
    barangay: named.barangay,
    detail: named.landmark_detail ?? named.full_name,
    lat: null,
    lng: null,
    label: named.abbreviation,
  }))

  function renderShortcuts(title: string, items: RecentLocation[]) {
    if (items.length === 0) return null
    return (
      <>
        {title && <span className="text-xs font-medium text-slate-500">{title}</span>}
        {items.map((location, index) => {
          const selected = isSelected(location)
          return (
            <button
              key={`${location.label}-${index}`}
              type="button"
              onClick={() => pickShortcut(location)}
              title={`${location.detail ? `${location.detail}, ` : ''}Brgy. ${location.barangay}, ${location.city}`}
              aria-pressed={selected}
              className={`w-32 truncate border-2 px-3 py-1.5 text-center text-sm font-medium transition-colors ${
                selected
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 text-slate-700 hover:border-slate-500 hover:bg-slate-50'
              }`}
            >
              {location.label}
            </button>
          )
        })}
      </>
    )
  }

  return (
    <fieldset
      aria-invalid={error ? true : undefined}
      className={`col-span-full grid gap-3 border-2 bg-white p-4 sm:grid-cols-2 sm:gap-x-4 ${
        error ? 'border-red-400' : 'border-slate-300'
      }`}
    >
      <legend className="sr-only">{STOP_LABELS[stop]}</legend>
      {/* Visible heading lives inside the grid: a flex <legend> straddles the border and breaks the layout */}
      <div
        aria-hidden="true"
        className="col-span-full flex items-center gap-2 text-sm font-semibold text-slate-800"
      >
        <span
          className={`flex h-5 w-5 items-center justify-center text-[11px] font-bold text-white ${
            stop === 'pickup' ? 'bg-brand-steel' : 'bg-brand-navy'
          }`}
        >
          {stop === 'pickup' ? 'A' : 'B'}
        </span>
        {STOP_LABELS[stop]}
      </div>

      {loadError && <p className="col-span-full text-sm text-red-600">{loadError}</p>}

      {/* Quick picks first; "Select specific" swaps them for the manual inputs + map */}
      {!specific && (
        <div className="col-span-full flex flex-wrap items-center gap-2">
          {renderShortcuts('Recent', recentLocations)}
          {renderShortcuts('', namedShortcuts)}
          <button
              type="button"
              onClick={() => setSpecific(true)}
              className="inline-flex w-32 items-center justify-center gap-1.5 border-2 border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-500 hover:bg-slate-50"
            >
              <PinIcon />
              Select
            </button>
        </div>
      )}

      {specific && (
        <div className="col-span-full">
          <button
            type="button"
            onClick={() => setSpecific(false)}
            className="text-sm font-medium text-slate-600 underline hover:text-slate-900"
          >
            ← Back to quick picks
          </button>
        </div>
      )}

      {specific && <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        City
        <select
          value={value.city}
          onChange={(e) =>
            onChange({
              ...value,
              city: e.target.value,
              barangay: '',
              // Switching away from a city the pin was in makes the pin wrong.
              ...(value.city ? { lat: null, lng: null } : {}),
            })
          }
          className={selectClasses}
        >
          <option value="">Select</option>
          {cities.map((city) => (
            <option key={city} value={city}>
              {city}
            </option>
          ))}
        </select>
      </label>}

      {specific && <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
        Barangay
        <select
          value={value.barangay}
          onChange={(e) => onChange({ ...value, barangay: e.target.value })}
          disabled={!value.city}
          className={selectClasses}
        >
          <option value="">{value.city ? 'Select' : '—'}</option>
          {barangays.map((barangay) => (
            <option key={barangay} value={barangay}>
              {barangay}
            </option>
          ))}
        </select>
      </label>}

      {specific && <label className="col-span-full flex flex-col gap-1 text-sm font-medium text-slate-700">
        Address
        <input
          type="text"
          value={value.detail}
          onChange={(e) => onChange({ ...value, detail: e.target.value })}
          placeholder="Street, building, landmark (optional)"
          className={selectClasses}
        />
      </label>}

      {error && (
        <p className="col-span-full text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {specific && <div className="col-span-full flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowMap((prev) => !prev)}
          aria-expanded={showMap}
          className="inline-flex items-center gap-1.5 border-2 border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-500 hover:bg-slate-50"
        >
          <PinIcon />
          {showMap ? 'Hide map' : savedPin ? 'Move pin' : 'Pin on map'}
        </button>
        <button
          type="button"
          onClick={locateMe}
          disabled={locating}
          className="inline-flex items-center gap-1.5 px-2 py-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50"
        >
          Use my location
        </button>
        {savedPin && (
          <span className="ml-auto inline-flex items-center gap-2 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1 font-medium text-green-700">
              <PinIcon /> Pinned
            </span>
            <button
              type="button"
              onClick={() => {
                onChange({ ...value, lat: null, lng: null })
                setMapNote(null)
              }}
              className="underline hover:text-slate-800"
            >
              Remove
            </button>
          </span>
        )}
      </div>}

      {specific && showMap && (
        <div className="col-span-full">
          <div className="h-80 w-full overflow-hidden border-2 border-slate-300">
            <MapContainer
              center={savedPin ?? DEFAULT_CENTER}
              zoom={savedPin ? 16 : 11}
              // Muted base map so the brand-colored pin stands out. Plain
              // OSM tiles restyled with CSS rather than a styled tile
              // provider -- the good-looking free ones (CARTO, Stadia)
              // need a paid license for commercial use.
              className="h-full w-full [&_.leaflet-tile-pane]:saturate-[.35] [&_.leaflet-tile-pane]:contrast-[1.05]"
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <ClickHandler onPick={placePin} />
              <FlyTo target={flyTarget} />
              {shownPin && (
                <Marker
                  position={shownPin}
                  icon={stop === 'pickup' ? pickupIcon : deliveryIcon}
                />
              )}
            </MapContainer>
          </div>
          <p className="mt-1.5 text-xs text-slate-500" aria-live="polite">
            {mapNote ?? 'Click the map to drop a pin.'}
          </p>
        </div>
      )}
    </fieldset>
  )
}

export default LocationPicker
