import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import './App.css'

function App() {
  const [status, setStatus] = useState<'checking' | 'ready' | 'error'>('checking')
  const [message, setMessage] = useState('Checking Supabase connection...')

  useEffect(() => {
    const checkConnection = async () => {
      const { error } = await supabase.auth.getSession()

      if (error) {
        setStatus('error')
        setMessage(error.message)
        return
      }

      setStatus('ready')
      setMessage('Supabase client is configured and reachable.')
    }

    void checkConnection()
  }, [])

  return (
    <main id="connection-screen">
      <section className={`status-card status-${status}`}>
        <p className="eyebrow">Supabase connection</p>
        <h1>{status === 'error' ? 'Connection needs attention' : 'Supabase is wired up'}</h1>
        <p className="status-message">{message}</p>
        <div className="env-lines">
          <span>VITE_SUPABASE_URL is loaded from .env.local</span>
          <span>VITE_SUPABASE_ANON_KEY is loaded from .env.local</span>
        </div>
      </section>
    </main>
  )
}

export default App
