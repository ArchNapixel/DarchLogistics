// MechanicTasks: placeholder for the Mechanic's work order list.
// The `work_orders` table (and its dependencies, maintenance_requests and
// inspection_reports) were removed in the last schema cleanup and haven't
// been rebuilt yet -- that's a scope decision still pending with the team.
// Showing an honest "coming soon" message here instead of querying a table
// that doesn't exist.
import ComingSoonPage from '../../../components/ComingSoonPage'

function MechanicTasks() {
  return <ComingSoonPage title="Work Order Management" />
}

export default MechanicTasks
