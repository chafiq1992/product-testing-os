"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { systemHealthLogin, systemHealthMe } from "@/lib/api"
import { useShopifyStores } from "@/lib/shopifyStores"

type MetaStatus = {
  connected: boolean
  configured: boolean
  user_name?: string | null
  accounts: Array<{ id: string, name: string, account_status?: number }>
  expires_at?: number | null
  callback_url?: string | null
}

const base = process.env.NEXT_PUBLIC_API_BASE_URL || ""

function adminHeaders(): HeadersInit {
  const token = localStorage.getItem("ptos_system_admin_token") || ""
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
}

export default function ConnectionsPage() {
  const [store, setStore] = useState("irrakids")
  const { stores, registry } = useShopifyStores(store)
  const [authorized, setAuthorized] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [status, setStatus] = useState<MetaStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const shopify = stores.find(item => item.label === store)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setStore(params.get("store") || localStorage.getItem("ptos_store") || "irrakids")
    if (params.get("meta_error")) setError("Meta connection failed or access was declined. Please try again.")
    systemHealthMe().then(result => setAuthorized(!result.error)).catch(() => setAuthorized(false))
  }, [])

  async function refreshStatus(selected = store) {
    if (!authorized) return
    try {
      setError("")
      const response = await fetch(`${base}/api/connections/meta/status?store=${encodeURIComponent(selected)}`, {
        headers: adminHeaders(), cache: "no-store",
      })
      const payload = await response.json()
      if (!response.ok || payload.error) throw new Error(payload.error || "Could not load Meta connection")
      setStatus(payload.data)
    } catch (err: any) {
      setStatus(null)
      setError(String(err?.message || err))
    }
  }

  useEffect(() => { if (authorized) void refreshStatus(store) }, [authorized, store])

  async function signIn(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setError("")
    try {
      const result = await systemHealthLogin({ email, password, remember: true })
      if (result.error || !result.data?.token) throw new Error(result.error || "Sign in failed")
      localStorage.setItem("ptos_system_admin_token", result.data.token)
      setAuthorized(true)
      setPassword("")
    } catch (err: any) {
      setError(String(err?.response?.data?.detail || err?.message || err))
    } finally { setBusy(false) }
  }

  async function connectMeta() {
    setBusy(true); setError("")
    try {
      const response = await fetch(`${base}/api/connections/meta/start`, {
        method: "POST", headers: adminHeaders(), body: JSON.stringify({ store, return_origin: window.location.origin }),
      })
      const payload = await response.json()
      if (!response.ok || payload.error || !payload.data?.url) throw new Error(payload.error || "Could not start Meta connection")
      window.location.assign(payload.data.url)
    } catch (err: any) {
      setError(String(err?.message || err))
      setBusy(false)
    }
  }

  return <main className="min-h-screen bg-slate-50 p-5 text-slate-900 md:p-8">
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-wide text-blue-600">Product Testing OS</p><h1 className="text-2xl font-bold">Connections</h1></div>
        <div className="flex gap-2"><Link href="/ads-management" className="rounded-lg border bg-white px-3 py-2 text-sm font-semibold">Ads manager</Link><Link href="/" className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">Home</Link></div>
      </header>

      {!authorized ? <form onSubmit={signIn} className="max-w-md rounded-2xl border bg-white p-6 shadow-sm">
        <h2 className="text-lg font-bold">Administrator sign in</h2>
        <p className="mt-1 text-sm text-slate-500">Use your System Health administrator account to manage connections.</p>
        <label className="mt-4 block text-sm font-medium">Email<input required type="email" value={email} onChange={e => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label>
        <label className="mt-3 block text-sm font-medium">Password<input required type="password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label>
        <button disabled={busy} className="mt-4 rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50">Sign in</button>
      </form> : <>
        <div className="mb-5 max-w-sm"><label className="mb-1 block text-sm font-semibold">Workspace store</label><select value={store} onChange={e => { setStore(e.target.value); localStorage.setItem("ptos_store", e.target.value) }} className="w-full rounded-lg border bg-white p-2">{stores.map(item => <option key={item.label} value={item.label}>{item.label}</option>)}</select></div>
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">Meta Ads</h2>
            <p className="mt-1 text-sm text-slate-600">Connect a Facebook account to discover its business ad accounts and load ads data for this store.</p>
            <p className="mt-4 text-sm font-semibold">{status?.connected ? `Connected as ${status.user_name || "Facebook user"}` : "Not connected"}</p>
            {status?.connected && <><p className="mt-1 text-sm text-slate-500">{status.accounts.length} ad account{status.accounts.length === 1 ? "" : "s"} available</p><div className="mt-2 max-h-44 overflow-auto rounded-lg bg-slate-50 p-2 text-xs">{status.accounts.map(account => <div key={account.id} className="py-1">{account.name || account.id} · {account.id}</div>)}</div></>}
            {status?.expires_at && <p className="mt-2 text-xs text-slate-500">Token expires {new Date(status.expires_at * 1000).toLocaleDateString()}; reconnect before then.</p>}
            {!status?.configured && <p className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">Backend setup required: META_APP_ID, META_APP_SECRET, OAUTH_STATE_SECRET, CONNECTION_ENCRYPTION_KEY, DATABASE_URL, and a public HTTPS BASE_URL.</p>}
            <div className="mt-4 flex gap-2"><button onClick={connectMeta} disabled={busy || !status?.configured} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{status?.connected ? "Reconnect Meta" : "Connect Meta"}</button><button onClick={() => refreshStatus()} className="rounded-lg border px-3 py-2 text-sm font-semibold">Refresh</button></div>
            {status?.callback_url && <p className="mt-3 break-all text-xs text-slate-500">Meta redirect URI: {status.callback_url}</p>}
          </section>
          <section className="rounded-2xl border bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">Shopify</h2>
            <p className="mt-1 text-sm text-slate-600">Connect a Shopify store to load products, orders, and attribution data.</p>
            <p className="mt-4 text-sm font-semibold">{shopify?.connected ? `Connected: ${shopify.shop || store}` : "Not connected"}</p>
            <Link href={`/shopify-connect?store=${encodeURIComponent(store)}`} className="mt-4 inline-block rounded-lg bg-green-700 px-3 py-2 text-sm font-semibold text-white">{shopify?.connected ? "Manage Shopify" : "Connect Shopify"}</Link>
            {registry.persistent_token_storage === false && <p className="mt-3 text-xs text-amber-800">Configure DATABASE_URL for persistent OAuth tokens.</p>}
          </section>
          {(["Google Ads", "TikTok Ads"] as const).map(name => <section key={name} className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="text-lg font-bold">{name}</h2><p className="mt-1 text-sm text-slate-600">Integration planned for a future connection flow.</p><button disabled className="mt-4 rounded-lg border bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-500">Coming soon</button></section>)}
        </div>
      </>}
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </div>
  </main>
}
