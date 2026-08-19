// App: defines the app's routes. "/dashboard/*" covers the dashboard and
// all its role-specific sub-pages -- see DashboardRouter for how those
// are picked based on the logged-in user's role.
import { Routes, Route } from 'react-router-dom'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import DashboardRouter from './pages/dashboard/DashboardRouter'
import ProtectedRoute from './components/ProtectedRoute'

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/dashboard/*"
        element={
          <ProtectedRoute>
            <DashboardRouter />
          </ProtectedRoute>
        }
      />
    </Routes>
  )
}

export default App
