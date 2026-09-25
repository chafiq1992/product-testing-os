"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { KeyRound, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react"
import { systemHealthLogin, systemHealthMe } from "@/lib/api"

type ManagedUser = { username: string, created_at: string, updated_at: string }
const base = process.env.NEXT_PUBLIC_API_BASE_URL || ""

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem("ptos_system_admin_token") || ""}`, "Content-Type": "application/json" }
}

async function usersRequest(path: string, options: RequestInit = {}) {
  const response = await fetch(`${base}/api/users${path}`, { ...options, headers: authHeaders(), cache: "no-store" })
  const payload = await response.json()
  if (!response.ok || payload.error) throw new Error(payload.detail || payload.error || `Request failed (${response.status})`)
  return payload.data
}

export default function UsersPage() {
  const [authorized, setAuthorized] = useState(false)
  const [checking, setChecking] = useState(true)
  const [email, setEmail] = useState("")
  const [adminPassword, setAdminPassword] = useState("")
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [resetFor, setResetFor] = useState("")
  const [resetPassword, setResetPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  useEffect(() => {
    systemHealthMe().then(result => setAuthorized(!result.error)).catch(() => setAuthorized(false)).finally(() => setChecking(false))
  }, [])

  async function refreshUsers() {
    try { setUsers(await usersRequest("") as ManagedUser[]) }
    catch (err: any) { setError(String(err?.message || err)) }
  }
  useEffect(() => { if (authorized) void refreshUsers() }, [authorized])

  async function signIn(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setError("")
    try {
      const result = await systemHealthLogin({ email, password: adminPassword, remember: true })
      if (result.error || !result.data?.token) throw new Error(result.error || "Sign in failed")
      localStorage.setItem("ptos_system_admin_token", result.data.token)
      setAuthorized(true); setAdminPassword("")
    } catch (err: any) { setError(String(err?.response?.data?.detail || err?.message || err)) }
    finally { setBusy(false) }
  }

  async function createUser(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setError(""); setNotice("")
    try {
      await usersRequest("", { method: "POST", body: JSON.stringify({ username, password }) })
      setNotice(`User ${username.trim().toLowerCase()} was created.`)
      setUsername(""); setPassword("")
      await refreshUsers()
    } catch (err: any) { setError(String(err?.message || err)) }
    finally { setBusy(false) }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setError(""); setNotice("")
    try {
      await usersRequest(`/${encodeURIComponent(resetFor)}/password`, { method: "PUT", body: JSON.stringify({ password: resetPassword }) })
      setNotice(`Password changed for ${resetFor}. Their existing sessions have been revoked.`)
      setResetFor(""); setResetPassword("")
      await refreshUsers()
    } catch (err: any) { setError(String(err?.message || err)) }
    finally { setBusy(false) }
  }

  async function removeUser(name: string) {
    if (!window.confirm(`Remove ${name}? Their active session will stop working.`)) return
    setBusy(true); setError(""); setNotice("")
    try {
      await usersRequest(`/${encodeURIComponent(name)}`, { method: "DELETE" })
      setNotice(`User ${name} was removed.`)
      await refreshUsers()
    } catch (err: any) { setError(String(err?.message || err)) }
    finally { setBusy(false) }
  }

  return <main className="min-h-screen bg-slate-50 text-slate-900">
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:py-10">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">Product Testing OS / Settings</p><h1 className="mt-2 text-3xl font-bold">Users</h1><p className="mt-2 text-sm text-slate-600">Create usernames and passwords for people who need to use the app.</p></div>
        <nav className="flex gap-2 text-sm font-semibold"><Link href="/settings/connections" className="rounded-lg border bg-white px-3 py-2 hover:bg-slate-100">Connections</Link><Link href="/" className="rounded-lg bg-slate-900 px-3 py-2 text-white">Home</Link></nav>
      </header>

      {checking ? <p className="text-sm text-slate-500">Checking administrator access…</p> : !authorized ? <form onSubmit={signIn} className="max-w-md rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3"><ShieldCheck className="h-6 w-6 text-blue-700" /><div><h2 className="font-bold">Administrator sign in</h2><p className="text-sm text-slate-500">Only System Health administrators can manage users.</p></div></div>
        <label className="block text-sm font-medium">Email<input required type="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-1 w-full rounded-lg border p-2.5" /></label>
        <label className="mt-3 block text-sm font-medium">Password<input required type="password" value={adminPassword} onChange={event => setAdminPassword(event.target.value)} className="mt-1 w-full rounded-lg border p-2.5" /></label>
        <button disabled={busy} className="mt-5 rounded-lg bg-blue-700 px-4 py-2.5 font-semibold text-white disabled:opacity-50">Sign in</button>
      </form> : <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <section className="h-fit rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2"><UserPlus className="h-5 w-5 text-blue-700" /><h2 className="text-lg font-bold">Add a user</h2></div>
          <p className="mt-2 text-sm text-slate-600">This user can sign in to Product Testing OS with their own credentials.</p>
          <form onSubmit={createUser} className="mt-5 space-y-4">
            <label className="block text-sm font-medium">Username<input required minLength={3} maxLength={64} autoComplete="off" value={username} onChange={event => setUsername(event.target.value)} placeholder="e.g. media-buyer" className="mt-1 w-full rounded-lg border p-2.5" /><span className="mt-1 block text-xs text-slate-500">3–64 letters, numbers, dots, underscores, or hyphens.</span></label>
            <label className="block text-sm font-medium">Password<input required minLength={12} type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} className="mt-1 w-full rounded-lg border p-2.5" /><span className="mt-1 block text-xs text-slate-500">At least 12 characters.</span></label>
            <button disabled={busy} className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Create user</button>
          </form>
        </section>
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between"><div className="flex items-center gap-2"><Users className="h-5 w-5 text-slate-700" /><h2 className="text-lg font-bold">Managed users</h2></div><span className="text-xs font-semibold text-slate-500">{users.length} users</span></div>
          <p className="mt-2 text-sm text-slate-600">Passwords are never displayed. Resetting a password or removing a user revokes their current session.</p>
          <div className="mt-5 space-y-2">{users.length ? users.map(user => <div key={user.username} className="rounded-lg border bg-slate-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">{user.username}</p><p className="text-xs text-slate-500">Added {new Date(user.created_at).toLocaleDateString()}</p></div><div className="flex gap-2"><button onClick={() => { setResetFor(user.username); setResetPassword(""); setError("") }} className="inline-flex items-center gap-1 rounded-lg border bg-white px-2.5 py-1.5 text-xs font-semibold hover:bg-slate-100"><KeyRound className="h-3.5 w-3.5" />Reset password</button><button onClick={() => void removeUser(user.username)} disabled={busy} className="rounded-lg border border-red-200 bg-white p-1.5 text-red-700 hover:bg-red-50 disabled:opacity-50" aria-label={`Remove ${user.username}`}><Trash2 className="h-4 w-4" /></button></div></div>
            {resetFor === user.username && <form onSubmit={changePassword} className="mt-3 flex flex-wrap gap-2 border-t pt-3"><input required minLength={12} type="password" autoComplete="new-password" value={resetPassword} onChange={event => setResetPassword(event.target.value)} placeholder="New password (12+ characters)" className="min-w-52 flex-1 rounded-lg border bg-white px-3 py-2 text-sm" /><button disabled={busy} className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Save password</button><button type="button" onClick={() => setResetFor("")} className="rounded-lg border px-3 py-2 text-xs font-semibold">Cancel</button></form>}
          </div>) : <p className="rounded-lg border border-dashed bg-slate-50 p-6 text-center text-sm text-slate-500">No managed users yet. Add the first user using the form.</p>}</div>
        </section>
      </div>}
      {(error || notice) && <p role={error ? "alert" : "status"} className={`mt-5 rounded-lg border p-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{error || notice}</p>}
    </div>
  </main>
}
