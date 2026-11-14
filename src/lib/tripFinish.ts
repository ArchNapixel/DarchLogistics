// tripFinish: what happens once a trip is FINISHED (lib/tripStatusFlow.ts) --
// Delivered for a normal trip, Container Returned for one that brings the
// empty container back. Its slot ends then and the trips after it re-time
// from it (retimeAfterDelivery), and its km go on the truck's odometer
// (recordTripKm, PMS counts on it). Problems only show as toasts: the
// status change itself is already saved.
import { showToast } from '../components/Toast'
import { retimeAfterDelivery } from './tripRetime'
import { pmsNotice, recordTripKm } from './odometer'

export async function afterTripFinished(itineraryId: number, finishedAt: number): Promise<void> {
  const retime = await retimeAfterDelivery(itineraryId, finishedAt)
  if (retime.warning) showToast(retime.warning, 'error')
  // At the current pace a booking misses its delivery-by date: remind the admin.
  for (const message of retime.late) showToast(message, 'error')

  // Runs on its own (routing can take a few seconds); a failure leaves the
  // trip on Truck Monitoring's "Trips not counted yet" list.
  void recordTripKm(itineraryId).then(async (result) => {
    if ('error' in result) {
      showToast(`Trip #${itineraryId}'s km weren't added to the odometer (${result.error}). Count it on Truck Monitoring.`, 'error')
      return
    }
    // Close to (or past) PMS now? Say so.
    const notice = await pmsNotice(result.plate)
    if (notice) showToast(notice.message, notice.due ? 'error' : 'success')
  })
}
