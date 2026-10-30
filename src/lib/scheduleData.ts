// scheduleData: loaders for the Schedule Overview page. Every tab turns its
// data into the same shape -- rows of bars (trips) and bands (leave,
// maintenance...) -- so one Timeline component can draw all of them.
// Times are epoch milliseconds. Read-only.
import { supabase } from './supabaseClient'
import { manilaTimestamp } from './format'
import { loadApprovedLeave } from './leaveRequests'
import { toManilaDate } from './payslip'

export const HOUR_MS = 3_600_000
export const DAY_MS = 24 * HOUR_MS
// The timeline's day starts at 6 AM, not midnight.
export const DAY_START_HOUR = 6

export type CrewRole = 'Driver' | 'Helper'
export type VehicleKind = 'Truck' | 'Trailer'
export type ScheduleTab = CrewRole | 'Vehicle' | 'Trip' | 'Booking'

// One trip drawn as a block.
export type Bar = {
  itinerary_id: number
  booking_id: number
  status: string
  trip_start_at: string
  trip_end_at: string
  route: string
  // Last free storage day of its booking (must be Picked Up by 11:59 PM).
  storage_deadline: string | null
}

// A grey stretch behind the bars (approved leave, a truck in the shop...).
export type Band = { key: string; start: number; end: number; label: string }

export type TimelineRow = {
  id: number | string
  label: string
  sublabel?: string
  bars: Bar[]
  bands: Band[]
}

// A trip that can't be drawn or run yet because something is missing.
export type AttentionItem = {
  itinerary_id: number
  booking_id: number
  client_name: string
  missing: string[]
}

export type ScheduleData = { rows: TimelineRow[]; attention: AttentionItem[] }

type TripRow = {
  itinerary_id: number
  booking_id: number
  itinerary_status: string | null
  trip_start_at: string | null
  trip_end_at: string | null
  place_of_pickup_id: number
  place_of_delivery_id: number
  plate_number: string | null
  trailer_id: number | null
}

const TRIP_COLUMNS =
  'itinerary_id, booking_id, itinerary_status, trip_start_at, trip_end_at, place_of_pickup_id, place_of_delivery_id, plate_number, trailer_id'

// Manila midnight of a YYYY-MM-DD date, in ms.
const dayStartMs = (date: string) => new Date(manilaTimestamp(date, 0)).getTime()

// Trips in the window (not cancelled, with a time slot) plus everything
// drawn from them: place names, booking storage deadlines, client names.
// Trips starting before the window ends; the 3-day look-back catches long
// trips that began earlier and spill into it. Trips still ON THE ROAD are
// added whenever they started -- an overdue trip from a week ago still
// keeps its driver busy now.
async function fetchTrips(from: number, to: number) {
  const [windowResult, onRoadResult] = await Promise.all([
    supabase
      .from('itineraries')
      .select(TRIP_COLUMNS)
      .neq('itinerary_status', 'Cancelled')
      .not('trip_start_at', 'is', null)
      .lt('trip_start_at', new Date(to).toISOString())
      .gte('trip_start_at', new Date(from - 3 * DAY_MS).toISOString()),
    supabase
      .from('itineraries')
      .select(TRIP_COLUMNS)
      .in('itinerary_status', ['Dispatched', 'PickedUp', 'InTransit'])
      .not('trip_start_at', 'is', null)
      .lt('trip_start_at', new Date(to).toISOString()),
  ])
  if (windowResult.error) throw new Error(windowResult.error.message)
  if (onRoadResult.error) throw new Error(onRoadResult.error.message)
  // Same trip can come back from both queries -- keep it once.
  const trips = [
    ...new Map(
      [...((windowResult.data ?? []) as TripRow[]), ...((onRoadResult.data ?? []) as TripRow[])].map((t) => [t.itinerary_id, t]),
    ).values(),
  ].sort((a, b) => (a.trip_start_at as string).localeCompare(b.trip_start_at as string))
  return trips
}

// Place names, booking storage deadline + client name for some trips.
async function fetchTripDetails(trips: TripRow[]) {
  const placeIds = Array.from(new Set(trips.flatMap((t) => [t.place_of_pickup_id, t.place_of_delivery_id])))
  const bookingIds = Array.from(new Set(trips.map((t) => t.booking_id)))
  const [placesResult, bookingsResult] = await Promise.all([
    placeIds.length
      ? supabase.from('places').select('place_id, place_name').in('place_id', placeIds)
      : Promise.resolve({ data: [] as { place_id: number; place_name: string }[], error: null }),
    bookingIds.length
      ? supabase.from('bookings').select('booking_id, client_id, storage_deadline').in('booking_id', bookingIds)
      : Promise.resolve({
          data: [] as { booking_id: number; client_id: number; storage_deadline: string | null }[],
          error: null,
        }),
  ])
  if (placesResult.error) throw new Error(placesResult.error.message)
  if (bookingsResult.error) throw new Error(bookingsResult.error.message)
  const bookings = bookingsResult.data ?? []
  const clientIds = Array.from(new Set(bookings.map((b) => b.client_id)))
  const clientsResult = clientIds.length
    ? await supabase.from('clients').select('client_id, client_name').in('client_id', clientIds)
    : { data: [] as { client_id: number; client_name: string }[], error: null }
  if (clientsResult.error) throw new Error(clientsResult.error.message)

  const placeName = new Map((placesResult.data ?? []).map((p) => [p.place_id, p.place_name]))
  const clientName = new Map((clientsResult.data ?? []).map((c) => [c.client_id, c.client_name]))
  const bookingById = new Map(bookings.map((b) => [b.booking_id, b]))
  return {
    route: (t: TripRow) => `${placeName.get(t.place_of_pickup_id) ?? '—'} → ${placeName.get(t.place_of_delivery_id) ?? '—'}`,
    storage: (t: TripRow) => bookingById.get(t.booking_id)?.storage_deadline ?? null,
    client: (t: TripRow) => clientName.get(bookingById.get(t.booking_id)?.client_id ?? -1) ?? '—',
  }
}

type Details = Awaited<ReturnType<typeof fetchTripDetails>>
const toBar = (t: TripRow, d: Details): Bar => ({
  itinerary_id: t.itinerary_id,
  booking_id: t.booking_id,
  status: t.itinerary_status ?? 'Awaiting',
  trip_start_at: t.trip_start_at as string,
  trip_end_at: t.trip_end_at as string,
  route: d.route(t),
  storage_deadline: d.storage(t),
})

// Active crew of some trips: itinerary_id -> employee ids (one role).
async function fetchCrew(tripIds: number[], role: CrewRole) {
  if (tripIds.length === 0) return [] as { itinerary_id: number; employee_id: number }[]
  const { data, error } = await supabase
    .from('itinerary_crews')
    .select('itinerary_id, employee_id')
    .eq('crew_role', role)
    .eq('is_active', true)
    .in('itinerary_id', tripIds)
  if (error) throw new Error(error.message)
  return data ?? []
}

// Drivers or Helpers, one row each, with their trips and approved leave.
async function fetchCrewSchedule(role: CrewRole, from: number, to: number): Promise<TimelineRow[]> {
  // Everyone whose Employees-page position is Driver (or Helper) -- with
  // or without a login yet (an employee is added before Set Up Account).
  const [employeesResult, statusesResult, leaveResult] = await Promise.all([
    supabase.from('employees').select('employee_id, full_name, employment_status_id').eq('position', role),
    supabase.from('employment_status').select('status_id, status_name'),
    loadApprovedLeave(toManilaDate(new Date(from))),
  ])
  if (employeesResult.error) throw new Error(employeesResult.error.message)
  if (statusesResult.error) throw new Error(statusesResult.error.message)
  if (leaveResult.error) throw new Error(leaveResult.error)

  const inactive = new Set(
    statusesResult.data
      .filter((st) => st.status_name === 'Deactivated' || st.status_name === 'Terminated')
      .map((st) => st.status_id),
  )
  const people = employeesResult.data
    .filter((e) => e.employment_status_id === null || !inactive.has(e.employment_status_id))
    .sort((a, b) => a.full_name.localeCompare(b.full_name))

  const trips = await fetchTrips(from, to)
  const [crew, details] = await Promise.all([fetchCrew(trips.map((t) => t.itinerary_id), role), fetchTripDetails(trips)])
  const tripById = new Map(trips.map((t) => [t.itinerary_id, t]))

  return people.map((p) => ({
    id: p.employee_id,
    label: p.full_name,
    bands: (leaveResult.byEmployee.get(p.employee_id) ?? []).map((l) => ({
      key: `${l.start_date}-${l.end_date}`,
      start: dayStartMs(l.start_date),
      end: dayStartMs(l.end_date) + DAY_MS,
      label: 'On leave',
    })),
    bars: crew
      .filter((c) => c.employee_id === p.employee_id)
      .map((c) => tripById.get(c.itinerary_id))
      .filter((t) => t !== undefined)
      .map((t) => toBar(t, details)),
  }))
}

// Trucks or trailers, one row each: the trips they are on, plus bands for
// open work orders and maintenance coming due.
async function fetchVehicleSchedule(kind: VehicleKind, from: number, to: number): Promise<TimelineRow[]> {
  const [trucksResult, trailersResult, workOrdersResult, schedulesResult] = await Promise.all([
    kind === 'Truck'
      ? supabase.from('truck_profiles').select('plate_number, model, current_status, next_service_date').order('plate_number')
      : Promise.resolve({ data: [], error: null }),
    kind === 'Trailer'
      ? supabase.from('trailers').select('trailer_id, plate_number, trailer_type, current_status').order('trailer_id')
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('work_orders')
      .select('work_order_id, work_order_number, plate_number, trailer_id, scheduled_start_date')
      .not('work_order_status', 'in', '("Completed","Cancelled")'),
    supabase.from('maintenance_schedules').select('schedule_id, plate_number, trailer_id, maintenance_type, due_date').eq('status', 'Pending'),
  ])
  if (trucksResult.error) throw new Error(trucksResult.error.message)
  if (trailersResult.error) throw new Error(trailersResult.error.message)
  if (workOrdersResult.error) throw new Error(workOrdersResult.error.message)
  if (schedulesResult.error) throw new Error(schedulesResult.error.message)

  const trips = await fetchTrips(from, to)
  const details = await fetchTripDetails(trips)

  const todayEnd = dayStartMs(toManilaDate(new Date())) + DAY_MS
  // ponytail: an open work order has no end date, so it is drawn from its
  // start until the end of today. Add an expected-finish column if it matters.
  const orderBand = (wo: { work_order_id: number; work_order_number: string | null; scheduled_start_date: string | null }): Band => {
    const start = wo.scheduled_start_date ? dayStartMs(wo.scheduled_start_date) : todayEnd - DAY_MS
    return {
      key: `wo${wo.work_order_id}`,
      start,
      end: Math.max(start + DAY_MS, todayEnd),
      label: `In shop · ${wo.work_order_number ?? `WO #${wo.work_order_id}`}`,
    }
  }
  const dueBand = (key: string, date: string, label: string): Band => ({
    key,
    start: dayStartMs(date),
    end: dayStartMs(date) + DAY_MS,
    label,
  })

  const workOrders = workOrdersResult.data ?? []
  const schedules = schedulesResult.data ?? []

  if (kind === 'Truck') {
    return trucksResult.data.map((v) => {
      const plate = v.plate_number as string
      const bands = [
        ...workOrders.filter((w) => w.plate_number === plate).map(orderBand),
        ...schedules
          .filter((s) => s.plate_number === plate)
          .map((s) => dueBand(`ms${s.schedule_id}`, s.due_date, `Due · ${s.maintenance_type}`)),
      ]
      if (v.next_service_date) bands.push(dueBand('next-service', v.next_service_date, 'Service due'))
      return {
        id: plate,
        label: plate,
        sublabel: [v.model, v.current_status && v.current_status !== 'Available' ? v.current_status : null].filter(Boolean).join(' · '),
        bands,
        bars: trips.filter((t) => t.plate_number === plate).map((t) => toBar(t, details)),
      }
    })
  }
  return trailersResult.data.map((v) => {
    const id = v.trailer_id as number
    return {
      id,
      label: v.plate_number ?? `Trailer #${id}`,
      sublabel: [v.trailer_type, v.current_status && v.current_status !== 'Available' ? v.current_status : null].filter(Boolean).join(' · '),
      bands: [
        ...workOrders.filter((w) => w.trailer_id === id).map(orderBand),
        ...schedules
          .filter((s) => s.trailer_id === id)
          .map((s) => dueBand(`ms${s.schedule_id}`, s.due_date, `Due · ${s.maintenance_type}`)),
      ],
      bars: trips.filter((t) => t.trailer_id === id).map((t) => toBar(t, details)),
    }
  })
}

// Trips that still have to run but are missing a time slot, driver, truck or
// trailer (these can't all be drawn, so they get their own list).
async function fetchAttention(): Promise<AttentionItem[]> {
  const { data, error } = await supabase
    .from('itineraries')
    .select(TRIP_COLUMNS)
    .in('itinerary_status', ['Awaiting', 'Dispatched'])
    .order('itinerary_id')
    // ponytail: first 300 open trips; page it if there are ever more.
    .limit(300)
  if (error) throw new Error(error.message)
  const trips = (data ?? []) as TripRow[]
  const [crew, details] = await Promise.all([fetchCrew(trips.map((t) => t.itinerary_id), 'Driver'), fetchTripDetails(trips)])
  const hasDriver = new Set(crew.map((c) => c.itinerary_id))
  return trips
    .map((t) => ({
      itinerary_id: t.itinerary_id,
      booking_id: t.booking_id,
      client_name: details.client(t),
      missing: [
        !t.trip_start_at && 'time slot',
        !hasDriver.has(t.itinerary_id) && 'driver',
        !t.plate_number && 'truck',
        !t.trailer_id && 'trailer',
      ].filter((m): m is string => !!m),
    }))
    .filter((t) => t.missing.length > 0)
}

// fetchTrips looks back 3 days so crew/vehicle rows catch long trips; Trips
// and Bookings have a row per trip, so keep only trips that actually show in
// the window (or are still on the road, drawn up to now).
async function fetchTripsInWindow(from: number, to: number) {
  const onRoad = ['Dispatched', 'PickedUp', 'InTransit']
  return (await fetchTrips(from, to)).filter(
    (t) =>
      new Date(t.trip_start_at as string).getTime() < to &&
      (new Date(t.trip_end_at as string).getTime() > from || (onRoad.includes(t.itinerary_status ?? '') && Date.now() > from)),
  )
}

// One row per trip, with its booking and driver beside the number.
async function fetchTripRows(from: number, to: number): Promise<TimelineRow[]> {
  const trips = await fetchTripsInWindow(from, to)
  const [crew, details] = await Promise.all([fetchCrew(trips.map((t) => t.itinerary_id), 'Driver'), fetchTripDetails(trips)])
  const driverIds = Array.from(new Set(crew.map((c) => c.employee_id)))
  const namesResult = driverIds.length
    ? await supabase.from('employees').select('employee_id, full_name').in('employee_id', driverIds)
    : { data: [] as { employee_id: number; full_name: string }[], error: null }
  if (namesResult.error) throw new Error(namesResult.error.message)
  const name = new Map((namesResult.data ?? []).map((e) => [e.employee_id, e.full_name]))
  const driverOf = new Map(crew.map((c) => [c.itinerary_id, name.get(c.employee_id)]))
  return trips.map((t) => ({
    id: t.itinerary_id,
    label: `Trip #${t.itinerary_id}`,
    sublabel: `Booking #${t.booking_id} · ${details.client(t)} · ${driverOf.get(t.itinerary_id) ?? 'No driver'}`,
    bands: [],
    bars: [toBar(t, details)],
  }))
}

// One row per booking, all its trips on the row (one or more drivers).
async function fetchBookingRows(from: number, to: number): Promise<TimelineRow[]> {
  const trips = await fetchTripsInWindow(from, to)
  const details = await fetchTripDetails(trips)
  const byBooking = new Map<number, TripRow[]>()
  for (const t of trips) byBooking.set(t.booking_id, [...(byBooking.get(t.booking_id) ?? []), t])
  return [...byBooking.entries()].map(([bookingId, list]) => ({
    id: bookingId,
    label: `Booking #${bookingId}`,
    sublabel: `${details.client(list[0])} · ${list.length} ${list.length === 1 ? 'trip' : 'trips'}`,
    bands: [],
    bars: list.map((t) => toBar(t, details)),
  }))
}

// What each tab loads.
export async function loadSchedule(tab: ScheduleTab, kind: VehicleKind, from: number, to: number): Promise<ScheduleData> {
  if (tab === 'Driver' || tab === 'Helper') return { rows: await fetchCrewSchedule(tab, from, to), attention: [] }
  if (tab === 'Vehicle') return { rows: await fetchVehicleSchedule(kind, from, to), attention: [] }
  if (tab === 'Booking') return { rows: await fetchBookingRows(from, to), attention: [] }
  const [rows, attention] = await Promise.all([fetchTripRows(from, to), fetchAttention()])
  return { rows, attention }
}
