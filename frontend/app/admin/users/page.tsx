'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import axios from 'axios'
import { toast } from 'sonner'
import { Users, UserPlus, KeyRound, Trash2, ShieldCheck, Ban, CheckCircle2 } from 'lucide-react'

// Admin → Users. Per-person logins stored in the app_users table.
// The API (backend/app/auth_gate.py) enforces admin-only access; this page
// just renders what it returns.
const API = process.env.NEXT_PUBLIC_API_BASE_URL || ''
const MIN_PW = 10

type User = {
  id: string; username: string; name: string | null; role: 'admin' | 'operator'; active: boolean
  created_at: string | null; last_login_at: string | null; created_by: string | null
}
type Builtin = { username: string; name: string | null; role: string; source: string }

function errText(e: any, fallback: string) {
  const d = e?.response?.data
  return (typeof d?.detail === 'string' && d.detail) || d?.error || fallback
}
function when(iso: string | null) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString() } catch { return iso }
}

export default function UsersAdminPage() {
  const [state, setState] = useState<'loading' | 'ok' | 'forbidden'>('loading')
  const [users, setUsers] = useState<User[]>([])
  const [builtin, setBuiltin] = useState<Builtin[]>([])
  const [me, setMe] = useState<{ sub?: string, uid?: string | null }>({})
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ username: '', name: '', role: 'operator', password: '' })
  const [resetFor, setResetFor] = useState<User | null>(null)
  const [resetPw, setResetPw] = useState('')

  const load = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/api/auth/users`)
      setUsers(data.data.users || []); setBuiltin(data.data.builtin || []); setMe(data.data.me || {})
      setState('ok')
    } catch (e: any) {
      if (e?.response?.status === 403) setState('forbidden')
      else if (e?.response?.status !== 401) { toast.error(errText(e, 'Could not load users')); setState('ok') }
      // 401: the sign-in overlay takes over
    }
  }, [])
  useEffect(() => { load() }, [load])

  async function run(label: string, fn: () => Promise<any>, ok: string) {
    setBusy(true)
    try { await fn(); toast.success(ok); await load(); return true }
    catch (e: any) { toast.error(`${label}: ${errText(e, 'failed')}`); return false }
    finally { setBusy(false) }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (form.password.length < MIN_PW) { toast.error(`Password must be at least ${MIN_PW} characters`); return }
    const done = await run('Create user', () => axios.post(`${API}/api/auth/users`, {
      username: form.username.trim(), name: form.name.trim() || null, role: form.role, password: form.password,
    }), `Created ${form.username.trim().toLowerCase()}`)
    if (done) setForm({ username: '', name: '', role: 'operator', password: '' })
  }
  const setRole = (u: User, role: string) =>
    run('Change role', () => axios.patch(`${API}/api/auth/users/${u.id}`, { role }), `${u.username} is now ${role}`)
  const setActive = (u: User, active: boolean) =>
    run(active ? 'Enable' : 'Disable', () => axios.patch(`${API}/api/auth/users/${u.id}`, { active }),
      active ? `${u.username} enabled` : `${u.username} disabled and signed out`)
  async function remove(u: User) {
    if (!window.confirm(`Delete ${u.username}? They are signed out immediately. This cannot be undone.`)) return
    await run('Delete', () => axios.delete(`${API}/api/auth/users/${u.id}`), `${u.username} deleted`)
  }
  async function resetPassword(e: React.FormEvent) {
    e.preventDefault()
    if (!resetFor) return
    if (resetPw.length < MIN_PW) { toast.error(`Password must be at least ${MIN_PW} characters`); return }
    const done = await run('Reset password', () => axios.post(`${API}/api/auth/users/${resetFor.id}/password`, { password: resetPw }),
      `Password reset for ${resetFor.username}; their sessions were ended`)
    if (done) { setResetFor(null); setResetPw('') }
  }

  const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200'
  const btn = 'inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50'

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-10 flex h-16 items-center justify-between border-b bg-white px-4 md:px-6">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-blue-600" />
          <h1 className="text-lg font-semibold">Admin · Users</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/" className="rounded-xl border bg-white px-4 py-2 font-semibold hover:bg-slate-50">Home</Link>
          <Link href="/system-health" className="rounded-xl bg-slate-700 px-4 py-2 font-semibold text-white hover:bg-slate-800">System Health</Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        {state === 'loading' && <p className="text-sm text-slate-500">Loading…</p>}
        {state === 'forbidden' && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm">
            Only administrators can manage users. You are signed in as an operator.
          </div>
        )}
        {state === 'ok' && <>
          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="mb-1 flex items-center gap-2 font-semibold"><UserPlus className="h-4 w-4" /> Add a user</h2>
            <p className="mb-4 text-xs text-slate-500">Give each person their own login. Operators can use every tool; admins can also manage users, System Health, Social Agent and the Ad Launcher.</p>
            <form onSubmit={create} className="grid gap-3 md:grid-cols-5">
              <input className={input} placeholder="Username" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} autoComplete="off" required />
              <input className={input} placeholder="Display name (optional)" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoComplete="off" />
              <select className={input} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} aria-label="Role">
                <option value="operator">Operator</option>
                <option value="admin">Admin</option>
              </select>
              <input className={input} type="password" placeholder={`Initial password (min ${MIN_PW})`} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} autoComplete="new-password" required />
              <button type="submit" disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">Create user</button>
            </form>
          </section>

          <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr><th className="px-4 py-2">User</th><th className="px-4 py-2">Role</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Last sign-in</th><th className="px-4 py-2 text-right">Actions</th></tr>
                </thead>
                <tbody>
                  {users.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">No personal accounts yet.</td></tr>}
                  {users.map(u => {
                    const self = !!me.uid && me.uid === u.id
                    return (
                      <tr key={u.id} className="border-t">
                        <td className="px-4 py-3"><div className="font-medium">{u.username}{self && <span className="ml-2 text-xs text-blue-600">(you)</span>}</div>{u.name && <div className="text-xs text-slate-500">{u.name}</div>}</td>
                        <td className="px-4 py-3">
                          <select disabled={busy} value={u.role} onChange={e => setRole(u, e.target.value)} className="rounded border px-2 py-1 text-sm" aria-label={`Role for ${u.username}`}>
                            <option value="operator">Operator</option><option value="admin">Admin</option>
                          </select>
                        </td>
                        <td className="px-4 py-3">{u.active
                          ? <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 className="h-4 w-4" /> Active</span>
                          : <span className="inline-flex items-center gap-1 text-slate-500"><Ban className="h-4 w-4" /> Disabled</span>}</td>
                        <td className="px-4 py-3 text-xs text-slate-600">{when(u.last_login_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button className={btn} disabled={busy} onClick={() => setActive(u, !u.active)}>{u.active ? <><Ban className="h-3 w-3" /> Disable</> : <><CheckCircle2 className="h-3 w-3" /> Enable</>}</button>
                            <button className={btn} disabled={busy} onClick={() => { setResetFor(u); setResetPw('') }}><KeyRound className="h-3 w-3" /> Reset password</button>
                            <button className={`${btn} text-red-700`} disabled={busy} onClick={() => remove(u)}><Trash2 className="h-3 w-3" /> Delete</button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {builtin.length > 0 && (
            <section className="rounded-2xl border bg-white p-5 text-sm shadow-sm">
              <h2 className="mb-2 flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" /> Built-in logins</h2>
              <p className="mb-3 text-xs text-slate-500">Set in the server environment, not editable here. Keep one admin as a way back in. The shared login can be retired once everyone has their own account.</p>
              <ul className="space-y-1">
                {builtin.map(b => <li key={b.source + b.username} className="flex flex-wrap gap-2"><span className="font-medium">{b.username}</span><span className="text-slate-500">{b.role} · {b.source}</span></li>)}
              </ul>
            </section>
          )}
        </>}
      </main>

      {resetFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-labelledby="reset-title">
          <form onSubmit={resetPassword} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h2 id="reset-title" className="font-semibold">Reset password for {resetFor.username}</h2>
            <p className="mb-3 mt-1 text-xs text-slate-500">They are signed out everywhere and must use the new password.</p>
            <input className={input} type="password" autoFocus placeholder={`New password (min ${MIN_PW})`} value={resetPw} onChange={e => setResetPw(e.target.value)} autoComplete="new-password" required />
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setResetFor(null)} className="rounded-lg border px-3 py-1.5 text-sm">Cancel</button>
              <button type="submit" disabled={busy} className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">Reset password</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
