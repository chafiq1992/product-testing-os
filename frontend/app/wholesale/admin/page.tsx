"use client"

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { UserPlus, Users, Trash2, Loader2, ArrowLeft, Eye, EyeOff, CheckCircle, AlertCircle, Package } from 'lucide-react'

const API = process.env.NEXT_PUBLIC_API_BASE_URL || ''

async function apiPost(path: string, body: object) {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return res.json()
}
async function apiGet(path: string) {
  const res = await fetch(`${API}${path}`)
  return res.json()
}

export default function WholesaleAdminPage() {
  const [vendors, setVendors] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  async function loadVendors() {
    setLoading(true)
    try {
      const res = await apiGet('/api/wholesale/vendors')
      setVendors(res?.data || [])
    } catch { setVendors([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { loadVendors() }, [])

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !username.trim() || !password.trim()) {
      showToast('error', 'All fields are required')
      return
    }
    setSaving(true)
    try {
      const res = await apiPost('/api/wholesale/vendors', { name: name.trim(), username: username.trim(), password: password.trim() })
      if (res?.error) { showToast('error', res.error); return }
      showToast('success', `Vendor "${name.trim()}" created successfully!`)
      setName(''); setUsername(''); setPassword('')
      loadVendors()
    } catch (err: any) {
      showToast('error', err?.message || 'Network error')
    } finally { setSaving(false) }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 text-slate-900" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-4 rounded-2xl shadow-2xl text-sm font-bold animate-in border ${toast.type === 'success' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
          {toast.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/wholesale" className="p-2 rounded-xl hover:bg-slate-100 transition">
            <ArrowLeft size={20} className="text-slate-500" />
          </Link>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Package className="text-blue-600" size={22} />
              Vendor Admin
            </h1>
            <p className="text-xs text-slate-500">Create and manage wholesale vendor accounts</p>
          </div>
        </div>
        <Link href="/" className="text-xs font-bold text-slate-500 hover:text-blue-600 transition uppercase tracking-wider">
          ← Back to Home
        </Link>
      </header>

      <div className="max-w-5xl mx-auto p-6 md:p-10 space-y-8">
        {/* Create Vendor Form */}
        <section className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 md:p-8">
          <h2 className="text-lg font-bold mb-6 flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl"><UserPlus size={20} /></div>
            Create New Vendor
          </h2>
          <form onSubmit={handleCreate} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Vendor / Company Name</label>
                <input
                  value={name} onChange={e => setName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/30 transition"
                  placeholder="e.g. Ahmed Textiles"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Username (for login)</label>
                <input
                  value={username} onChange={e => setUsername(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/30 transition"
                  placeholder="e.g. ahmed"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password} onChange={e => setPassword(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 pr-12 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500/30 transition"
                    placeholder="Set a password"
                  />
                  <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition">
                    {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button
                type="submit"
                disabled={saving}
                className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-blue-200 transition-all active:scale-95 disabled:opacity-60 flex items-center gap-2 text-sm"
              >
                {saving ? <Loader2 className="animate-spin" size={18} /> : <UserPlus size={18} />}
                Create Vendor
              </button>
              <p className="text-xs text-slate-400">The vendor can then log in at <code className="bg-slate-100 px-2 py-1 rounded-lg font-mono text-blue-600">/wholesale</code></p>
            </div>
          </form>
        </section>

        {/* ─── How It Works ──────────────────────────── */}
        <section className="bg-blue-50 rounded-3xl border border-blue-100 p-6">
          <h3 className="text-sm font-black text-blue-700 mb-3">📋 How It Works</h3>
          <ol className="list-decimal list-inside text-sm text-blue-900 space-y-2 font-medium">
            <li>Fill in the <strong>Vendor Name</strong> (this will appear on products in Shopify)</li>
            <li>Set a <strong>Username</strong> and <strong>Password</strong> for the vendor to log in</li>
            <li>Click <strong>Create Vendor</strong></li>
            <li>Share the credentials with the vendor — they go to <code className="bg-white px-2 py-0.5 rounded-lg font-mono text-blue-600 text-xs">/wholesale</code> to log in</li>
            <li>When they add products, their name is automatically tagged on Shopify</li>
          </ol>
        </section>

        {/* Vendor List */}
        <section className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 md:p-8">
          <h2 className="text-lg font-bold mb-6 flex items-center gap-3">
            <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-xl"><Users size={20} /></div>
            Existing Vendors
            <span className="ml-auto text-xs font-bold text-slate-400 bg-slate-100 px-3 py-1 rounded-full">{vendors.length} vendor{vendors.length !== 1 ? 's' : ''}</span>
          </h2>

          {loading ? (
            <div className="py-12 text-center">
              <Loader2 className="animate-spin text-blue-500 mx-auto mb-2" size={24} />
              <p className="text-slate-400 text-sm">Loading vendors...</p>
            </div>
          ) : vendors.length === 0 ? (
            <div className="py-12 text-center">
              <div className="w-16 h-16 bg-slate-50 text-slate-200 rounded-full flex items-center justify-center mx-auto mb-4">
                <Users size={32} />
              </div>
              <p className="text-slate-400 font-medium">No vendors created yet.</p>
              <p className="text-xs text-slate-400 mt-1">Use the form above to create your first vendor.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {vendors.map((v: any) => (
                <div key={v.id || v.username} className="bg-slate-50 border border-slate-100 rounded-2xl p-5 hover:border-blue-200 transition-all group">
                  <div className="flex items-center gap-4 mb-3">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-2xl flex items-center justify-center text-white text-lg font-black shadow-md">
                      {(v.name || 'V').charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm">{v.name}</h4>
                      <p className="text-[10px] text-slate-500 font-mono">@{v.username}</p>
                    </div>
                  </div>
                  <div className="space-y-1.5 text-[10px] font-semibold text-slate-400">
                    <p>ID: <span className="text-slate-600 font-mono">{v.id}</span></p>
                    {v.created_at && <p>Created: <span className="text-slate-600">{new Date(v.created_at).toLocaleDateString()}</span></p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
