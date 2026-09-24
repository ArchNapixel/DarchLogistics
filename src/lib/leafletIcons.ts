// leafletIcons: shared Leaflet marker icon + default map center, used by
// both LocationPicker.tsx and NewQuoteLocationMap.tsx. Kept in its own
// plain (non-component) file so it doesn't trip the
// react-refresh/only-export-components lint rule the way exporting
// these straight out of a component file would.
import L from 'leaflet'
import markerIconUrl from 'leaflet/dist/images/marker-icon.png'
import markerIconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png'

// Leaflet's default marker icon points at relative image paths that
// don't resolve through Vite's bundler unless given the bundled asset
// URLs explicitly.
export const markerIcon = L.icon({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIconRetinaUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
})

// Centered on Davao City -- the service area location_reference covers.
export const DEFAULT_CENTER: [number, number] = [7.1907, 125.4553]
