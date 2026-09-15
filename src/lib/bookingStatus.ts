// bookingStatus: keeps bookings.booking_status in sync with its
// itineraries. A booking can cover multiple delivery orders (each its
// own itinerary row -- see QuoteReviewModal's Approve flow), so it only
// counts as 'Delivered' once EVERY one of them is -- flipping it after
// just one of several would be wrong.
//
// Called from wherever an itinerary actually reaches 'Delivered':
// DeliveryReceiptModal.tsx (the driver's own flow -- the normal way
// this happens) and DispatchBoardSection.tsx (Admin's direct status
// override). Best-effort, fire-and-forget at both call sites -- same
// reasoning as the truck/trailer "Available" sync already done
// alongside this in DispatchBoardSection.tsx: the itinerary status
// change itself already succeeded, so this isn't worth blocking on or
// alarming the user over.
import { supabase } from './supabaseClient'

export async function syncBookingStatusIfFullyDelivered(
  itineraryId: number,
): Promise<{ error: string | null }> {
  const { data: thisItinerary, error: itineraryError } = await supabase
    .from('itineraries')
    .select('booking_id')
    .eq('itinerary_id', itineraryId)
    .single()

  if (itineraryError || !thisItinerary) {
    return { error: itineraryError?.message ?? 'Could not find this itinerary.' }
  }

  const { data: siblingItineraries, error: loadError } = await supabase
    .from('itineraries')
    .select('itinerary_status')
    .eq('booking_id', thisItinerary.booking_id)

  if (loadError) {
    return { error: loadError.message }
  }

  const allDelivered = siblingItineraries.every(
    (i) => i.itinerary_status === 'Delivered',
  )
  if (!allDelivered) {
    return { error: null }
  }

  const { error: updateError } = await supabase
    .from('bookings')
    .update({ booking_status: 'Delivered' })
    .eq('booking_id', thisItinerary.booking_id)

  return { error: updateError?.message ?? null }
}
