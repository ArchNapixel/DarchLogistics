// LocationPicker: City + Barangay dropdowns (from location_reference)
// plus an optional free-text landmark/detail field, for picking a
// pickup or delivery location. Barangay is what places.ts/route_cache
// key routing/distance-caching off of -- the landmark detail is just
// for a driver to find the exact spot, it never affects place identity.
//
// "Pick on map instead" reveals a Leaflet + OpenStreetMap view. Clicking
// it reverse-geocodes the pin via Nominatim and tries to match the
// result against the known city/barangay list (locationReference.ts) --
// this is only ever a convenience guess to save scrolling through a long
// barangay dropdown, so the City/Barangay selects above always stay
// editable afterward for the user to correct if the guess is wrong.
import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import markerIconUrl from 'leaflet/dist/images/marker-icon.png'
import markerIconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png'
import 'leaflet/dist/leaflet.css'
import {
  loadLocationReference,
  loadNamedLocations,
  citiesFrom,
  barangaysForCity,
  matchLocationFromText,
  type LocationReferenceRow,
  type NamedLocation,
} from '../lib/locationReference'

// Leaflet's default marker icon points at relative image paths that
// don't resolve through Vite's bundler unless given the bundled asset
// URLs explicitly.
const markerIcon = L.icon({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIconRetinaUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
})

// Centered on Davao City -- the service area location_reference covers.
const DEFAULT_CENTER: [number, number] = [7.1907, 125.4553]

export type LocationValue = {
  city: string
  barangay: string
  detail: string
}

export const emptyLocationValue: LocationValue = { city: '', barangay: '', detail: '' }

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

function LocationPicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: LocationValue
  onChange: (value: LocationValue) => void
}) {
  const [rows, setRows] = useState<LocationReferenceRow[]>([])
  const [namedLocations, setNamedLocations] = useState<NamedLocation[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showMap, setShowMap] = useState(false)
  const [pin, setPin] = useState<[number, number] | null>(null)
  const [geocoding, setGeocoding] = useState(false)
  const [geocodeNote, setGeocodeNote] = useState<string | null>(null)

  useEffect(() => {
    loadLocationReference().then(({ rows: loaded, error }) => {
      if (error) {
        setLoadError(error)
        return
      }
      setRows(loaded)
    })
    loadNamedLocations().then(({ locations, error }) => {
      if (error) {
        setLoadError(error)
        return
      }
      setNamedLocations(locations)
    })
  }, [])

  function pickNamedLocation(named: NamedLocation) {
    onChange({
      city: named.city,
      barangay: named.barangay,
      detail: named.landmark_detail ?? named.full_name,
    })
  }

  const cities = citiesFrom(rows)
  const barangays = barangaysForCity(rows, value.city)

  async function handleMapClick(lat: number, lng: number) {
    setPin([lat, lng])
    setGeocoding(true)
    setGeocodeNote(null)

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1&zoom=18`,
      )
      const data = await response.json()
      const addressBlob = [data.display_name, ...Object.values(data.address ?? {})]
        .filter((part): part is string => typeof part === 'string')
        .join(' ')
      const match = matchLocationFromText(rows, addressBlob)

      if (match) {
        onChange({ ...value, city: match.city, barangay: match.barangay })
        setGeocodeNote(`Matched to Brgy. ${match.barangay}, ${match.city} -- confirm below.`)
      } else {
        setGeocodeNote(
          "Couldn't match that pin to a barangay in our service area -- please pick manually below.",
        )
      }
    } catch {
      setGeocodeNote('Could not look up that location. Please pick manually below.')
    } finally {
      setGeocoding(false)
    }
  }

  return (
    <div className="col-span-full grid gap-3 rounded-lg border border-slate-200 p-4 sm:grid-cols-2">
      <p className="col-span-full text-sm font-semibold text-slate-700">{label}</p>

      {loadError && <p className="col-span-full text-sm text-red-600">{loadError}</p>}

      {namedLocations.length > 0 && (
        <div className="col-span-full flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">Quick pick:</span>
          {namedLocations.map((named) => (
            <button
              key={named.abbreviation}
              type="button"
              onClick={() => pickNamedLocation(named)}
              title={named.full_name}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                value.city === named.city && value.barangay === named.barangay
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 text-slate-600 hover:border-slate-500'
              }`}
            >
              {named.abbreviation}
            </button>
          ))}
        </div>
      )}

      <label className="flex flex-col gap-1 text-sm text-slate-600">
        City
        <select
          value={value.city}
          onChange={(e) => onChange({ ...value, city: e.target.value, barangay: '' })}
          required
          className="rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none"
        >
          <option value="">Select city</option>
          {cities.map((city) => (
            <option key={city} value={city}>
              {city}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm text-slate-600">
        Barangay
        <select
          value={value.barangay}
          onChange={(e) => onChange({ ...value, barangay: e.target.value })}
          required
          disabled={!value.city}
          className="rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none disabled:bg-slate-100"
        >
          <option value="">Select barangay</option>
          {barangays.map((barangay) => (
            <option key={barangay} value={barangay}>
              {barangay}
            </option>
          ))}
        </select>
      </label>

      <label className="col-span-full flex flex-col gap-1 text-sm text-slate-600">
        Landmark / specific address (optional)
        <input
          type="text"
          value={value.detail}
          onChange={(e) => onChange({ ...value, detail: e.target.value })}
          placeholder="Building name, street, or nearby landmark"
          className="rounded-md border border-slate-300 px-3 py-2 text-slate-900 focus:border-slate-500 focus:outline-none"
        />
      </label>

      <button
        type="button"
        onClick={() => setShowMap((prev) => !prev)}
        className="col-span-full w-fit text-sm font-medium text-slate-600 underline hover:text-slate-900"
      >
        {showMap ? 'Hide map' : 'Pick on map instead'}
      </button>

      {showMap && (
        <div className="col-span-full">
          <div className="h-64 w-full overflow-hidden rounded-lg border border-slate-300">
            <MapContainer
              center={DEFAULT_CENTER}
              zoom={11}
              style={{ height: '100%', width: '100%' }}
            >
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <ClickHandler onPick={handleMapClick} />
              {pin && <Marker position={pin} icon={markerIcon} />}
            </MapContainer>
          </div>
          {geocoding && (
            <p className="mt-1 text-xs text-slate-500">Looking up that location...</p>
          )}
          {geocodeNote && <p className="mt-1 text-xs text-slate-500">{geocodeNote}</p>}
        </div>
      )}
    </div>
  )
}

export default LocationPicker
