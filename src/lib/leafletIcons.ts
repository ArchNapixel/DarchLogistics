// leafletIcons: the map pins + default map center used by
// LocationPicker.tsx. Kept in its own plain (non-component) file so it
// doesn't trip the react-refresh/only-export-components lint rule the
// way exporting these straight out of a component file would.
import L from 'leaflet'

// A lettered teardrop pin drawn as inline SVG (Leaflet's divIcon) -- no
// image assets, and it takes the brand colors instead of Leaflet's
// stock blue marker. "A" is always pickup, "B" always delivery, same as
// the route summary.
function stopIcon(letter: string, color: string) {
  return L.divIcon({
    className: '',
    html: `<svg width="30" height="40" viewBox="0 0 30 40" style="filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))"><path d="M15 1C7.3 1 1 7.3 1 15c0 10.5 14 24 14 24s14-13.5 14-24C29 7.3 22.7 1 15 1z" fill="${color}" stroke="#fff" stroke-width="2"/><text x="15" y="20" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="700" fill="#fff">${letter}</text></svg>`,
    iconSize: [30, 40],
    iconAnchor: [15, 39],
  })
}

// brand-steel / brand-navy from index.css.
export const pickupIcon = stopIcon('A', '#4d7ea8')
export const deliveryIcon = stopIcon('B', '#16233b')

// Centered on Davao City -- the service area location_reference covers.
export const DEFAULT_CENTER: [number, number] = [7.1907, 125.4553]
