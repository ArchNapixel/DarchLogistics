// NewQuoteLocationMap: the full-screen map behind NewQuoteRequestModal.
// One shared map for both fields, instead of each LocationPicker having
// its own small map -- click anywhere, reverse-geocode the pin (same
// Nominatim lookup LocationPicker itself uses), then choose whether that
// point is the Pickup or the Delivery. Whichever is picked updates that
// field on the form directly; city/barangay stay editable there
// afterward if the guess is wrong, same "never trusted blindly" rule as
// LocationPicker's own map.
import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  loadLocationReference,
  matchLocationFromText,
  type LocationReferenceRow,
} from '../../../lib/locationReference'
import { markerIcon, DEFAULT_CENTER } from '../../../lib/leafletIcons'

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

// Plain colored dots (Leaflet's built-in divIcon -- no new image assets)
// so an already-set Pickup/Delivery pin reads apart from the pending
// (still-choosing) pin, which uses the default blue marker.
function coloredDotIcon(color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="background:${color};width:16px;height:16px;border-radius:9999px;border:2px solid white;box-shadow:0 0 4px rgba(0,0,0,0.5)"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  })
}

const pickupIcon = coloredDotIcon('#16a34a')
const deliveryIcon = coloredDotIcon('#ea580c')

function NewQuoteLocationMap({
  pickupPin,
  deliveryPin,
  onPick,
}: {
  pickupPin: [number, number] | null
  deliveryPin: [number, number] | null
  onPick: (
    role: 'pickup' | 'delivery',
    location: { city: string; barangay: string } | null,
    latlng: [number, number],
  ) => void
}) {
  const [rows, setRows] = useState<LocationReferenceRow[]>([])
  const [pendingPin, setPendingPin] = useState<[number, number] | null>(null)
  const [pendingMatch, setPendingMatch] = useState<{ city: string; barangay: string } | null>(null)
  const [geocoding, setGeocoding] = useState(false)
  const [noMatchNote, setNoMatchNote] = useState(false)

  useEffect(() => {
    loadLocationReference().then(({ rows: loaded }) => setRows(loaded))
  }, [])

  async function handleMapClick(lat: number, lng: number) {
    setPendingPin([lat, lng])
    setPendingMatch(null)
    setNoMatchNote(false)
    setGeocoding(true)

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
        setPendingMatch(match)
      } else {
        setNoMatchNote(true)
      }
    } catch {
      setNoMatchNote(true)
    } finally {
      setGeocoding(false)
    }
  }

  function choose(role: 'pickup' | 'delivery') {
    if (!pendingPin) return
    onPick(role, pendingMatch, pendingPin)
    setPendingPin(null)
    setPendingMatch(null)
    setNoMatchNote(false)
  }

  return (
    <div className="relative h-full w-full">
      <p className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-lg">
        Click the map to set a location, then choose Pickup or Delivery.
      </p>

      <MapContainer center={DEFAULT_CENTER} zoom={11} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickHandler onPick={handleMapClick} />

        {pickupPin && <Marker position={pickupPin} icon={pickupIcon} />}
        {deliveryPin && <Marker position={deliveryPin} icon={deliveryIcon} />}

        {pendingPin && (
          <Marker
            position={pendingPin}
            icon={markerIcon}
            eventHandlers={{ add: (e) => e.target.openPopup() }}
          >
            <Popup autoClose={false} closeOnClick={false}>
              <div className="flex flex-col gap-2 text-sm">
                {geocoding ? (
                  <p>Looking up this location...</p>
                ) : (
                  <>
                    {pendingMatch ? (
                      <p className="font-medium">
                        Brgy. {pendingMatch.barangay}, {pendingMatch.city}
                      </p>
                    ) : noMatchNote ? (
                      <p className="text-slate-500">
                        Couldn't match a known barangay -- you can still set the pin, then fix
                        city/barangay manually in the form.
                      </p>
                    ) : null}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => choose('pickup')}
                        className="rounded bg-green-600 px-2 py-1 text-xs font-semibold text-white hover:bg-green-500"
                      >
                        Set as Pickup
                      </button>
                      <button
                        type="button"
                        onClick={() => choose('delivery')}
                        className="rounded bg-orange-600 px-2 py-1 text-xs font-semibold text-white hover:bg-orange-500"
                      >
                        Set as Delivery
                      </button>
                    </div>
                  </>
                )}
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  )
}

export default NewQuoteLocationMap
