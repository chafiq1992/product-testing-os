'use client'
import { useEffect, useRef, useState } from 'react'
import axios from 'axios'

// Operator sign-in for every page that talks to the operator API.
//
// The API enforces the session (backend/app/auth_gate.py); this component only
// asks for it. Pages used by people who are not operators keep their own login:
// wholesale vendors, the confirmation team and its admins.
const API = process.env.NEXT_PUBLIC_API_BASE_URL || ''
const OWN_LOGIN = [/^\/wholesale\/?$/, /^\/confirmation(\/|$)/, /^\/confirmation-admin(\/|$)/, /^\/legal(\/|$)/]
const ADMIN_TOKEN_KEY = 'ptos_system_admin_token'

function hasOwnLogin(path: string) {
  return OWN_LOGIN.some(re => re.test(path))
}

function isGateDenial(status: number, body: any) {
  return status === 401 && body && typeof body === 'object' && body.error === 'unauthorized' && body.detail === 'Authentication required'
}

export default function AuthGate() {
  const [state, setState] = useState<'checking' | 'ok' | 'login'>('checking')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const exempt = useRef(false)

  useEffect(() => {
    exempt.current = hasOwnLogin(window.location.pathname)
    if (exempt.current) { setState('ok'); return }
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await axios.get(`${API}/api/auth/session`)
        if (data?.data?.operator || data?.data?.gate === false) { if (!cancelled) setState('ok'); return }
        // Already signed in to System Health? Swap that token for the session cookie.
        let token = ''
        try { token = localStorage.getItem(ADMIN_TOKEN_KEY) || '' } catch {}
        if (token) {
          try {
            await axios.post(`${API}/api/auth/session`, {}, { headers: { Authorization: `Bearer ${token}` } })
            if (!cancelled) window.location.reload()
            return
          } catch {}
        }
        if (!cancelled) setState('login')
      } catch {
        if (!cancelled) setState('ok') // never lock the page because the check itself failed
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Session expired or revoked while the page is open: ask again.
  useEffect(() => {
    if (exempt.current) return
    const id = axios.interceptors.response.use(undefined, err => {
      if (isGateDenial(err?.response?.status, err?.response?.data)) setState('login')
      return Promise.reject(err)
    })
    const originalFetch = window.fetch
    window.fetch = async (...args) => {
      const res = await originalFetch(...args)
      if (res.status === 401) {
        res.clone().json().then(body => { if (isGateDenial(401, body)) setState('login') }).catch(() => {})
      }
      return res
    }
    return () => { axios.interceptors.response.eject(id); window.fetch = originalFetch }
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const { data } = await axios.post(`${API}/api/auth/login`, { username: username.trim(), password, remember })
      const tok = data?.data?.system_admin_token
      if (tok) { try { localStorage.setItem(ADMIN_TOKEN_KEY, tok) } catch {} }
      window.location.reload()
    } catch (err: any) {
      const code = err?.response?.data?.error
      setError(code === 'too_many_attempts' ? 'Too many attempts. Try again in 15 minutes.' : 'Wrong username or password.')
      setBusy(false)
    }
  }

  if (state !== 'login') return null
  return (
    <div className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-slate-100 p-4" role="dialog" aria-modal="true" aria-labelledby="pto-login-title">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-7 shadow-xl">
        <h1 id="pto-login-title" className="text-xl font-semibold text-slate-900">Product Testing OS</h1>
        <p className="mt-1 mb-5 text-sm text-slate-500">Sign in to continue.</p>
        <label htmlFor="pto-login-user" className="mb-1 block text-xs font-semibold text-slate-600">Username or email</label>
        <input id="pto-login-user" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" autoFocus required
          className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200" />
        <label htmlFor="pto-login-pass" className="mb-1 block text-xs font-semibold text-slate-600">Password</label>
        <input id="pto-login-pass" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required
          className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200" />
        <label className="mb-4 flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /> Keep me signed in for 30 days
        </label>
        {error && <p className="mb-3 text-sm text-red-600" role="alert">{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-slate-900 py-2.5 font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
