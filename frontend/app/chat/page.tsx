"use client"

import { useEffect, useState } from 'react'
import { MessageSquare, LogOut, ArrowRight } from 'lucide-react'
import ChatInbox from '../../components/chat/ChatInbox'
import { registerAccount, Me } from '../../components/chat/chatApi'

const STORAGE_KEY = 'chat_identity'

function loadIdentity(): Me | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const v = JSON.parse(raw)
    return v?.id ? v : null
  } catch { return null }
}

function IdentityGate({ onReady }: { onReady: (me: Me) => void }) {
  const [handle, setHandle] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const id = handle.trim().toLowerCase().replace(/^@/, '')
    if (!id) { setError('Pick an id (e.g. @sara)'); return }
    if (!/^[a-z0-9._-]{2,32}$/.test(id)) { setError('Use 2–32 letters, numbers, . _ -'); return }
    const me: Me = { id, handle: id, name: name.trim() || id, kind: 'agent' }
    setBusy(true)
    try {
      await registerAccount(me)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(me))
      onReady(me)
    } catch (err: any) {
      setError(err?.message || 'Could not register')
    } finally { setBusy(false) }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-900 p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-7">
        <div className="flex items-center gap-2 mb-1 text-blue-600">
          <MessageSquare size={24} />
          <h1 className="text-xl font-black text-slate-900">Team Chat</h1>
        </div>
        <p className="text-sm text-slate-500 mb-5">Pick the id others will use to reach you.</p>

        <label className="block text-xs font-bold text-slate-500 mb-1">Your id / handle</label>
        <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 mb-3 focus-within:ring-2 focus-within:ring-blue-300">
          <span className="text-slate-400 font-semibold">@</span>
          <input
            autoFocus
            value={handle}
            onChange={e => setHandle(e.target.value)}
            placeholder="sara"
            className="flex-1 bg-transparent py-2.5 px-1 focus:outline-none text-slate-900"
          />
        </div>

        <label className="block text-xs font-bold text-slate-500 mb-1">Display name (optional)</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Sara from Support"
          className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 px-3 mb-5 focus:outline-none focus:ring-2 focus:ring-blue-300 text-slate-900"
        />

        {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 transition disabled:opacity-60"
        >
          {busy ? 'Connecting…' : <>Enter chat <ArrowRight size={18} /></>}
        </button>
        <p className="mt-4 text-[11px] text-center text-slate-400">
          Anyone with your id can message you. Share it like a username.
        </p>
      </form>
    </div>
  )
}

export default function ChatPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    setMe(loadIdentity())
    setReady(true)
  }, [])

  const logout = () => {
    try { localStorage.removeItem(STORAGE_KEY) } catch {}
    setMe(null)
  }

  if (!ready) return <div className="min-h-screen bg-slate-900" />
  if (!me) return <IdentityGate onReady={setMe} />

  return (
    <div className="h-screen flex flex-col bg-slate-100">
      <header className="flex items-center justify-between px-4 py-2.5 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center">
            <MessageSquare size={16} />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-bold text-slate-900">{me.name}</p>
            <p className="text-[11px] text-slate-400">@{me.handle || me.id}</p>
          </div>
        </div>
        <button onClick={logout} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-red-600 transition" title="Sign out">
          <LogOut size={16} /> <span className="hidden sm:inline">Sign out</span>
        </button>
      </header>
      <div className="flex-1 min-h-0 p-2 md:p-4">
        <ChatInbox me={me} heightClass="h-full" />
      </div>
    </div>
  )
}
