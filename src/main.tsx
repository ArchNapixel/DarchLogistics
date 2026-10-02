import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './context/AuthContext'
import { ConfirmHost } from './components/ConfirmDialog'
import { ToastHost } from './components/Toast'

// Scrolling the mouse wheel over a focused number field would silently
// change its value. Un-focus it so the page scrolls instead -- one rule
// for every number field in the app.
document.addEventListener('wheel', () => {
  const el = document.activeElement
  if (el instanceof HTMLInputElement && el.type === 'number') el.blur()
}, { passive: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
        <ConfirmHost />
        <ToastHost />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
