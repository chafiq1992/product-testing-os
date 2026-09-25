"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { ArrowRight, CheckCircle2, Facebook, RefreshCw, ShieldCheck, Store, Users } from "lucide-react"
import { systemHealthLogin, systemHealthMe } from "@/lib/api"
import { useShopifyStores } from "@/lib/shopifyStores"

type AdAccount = { id: string, name: string, account_status?: number, business_name?: string | null }
type MetaStatus = {
  connected: boolean
  configured: boolean
  user_name?: string | null
  accounts: AdAccount[]
  expires_at?: number | null
  callback_url?: string | null
}

const base = process.env.NEXT_PUBLIC_API_BASE_URL || ""
const adminHeaders = (): HeadersInit => ({
  Authorization: `Bearer ${localStorage.getItem("ptos_system_admin_token") || ""}`,
  "Content-Type": "application/json",
})

function Badge({ connected, loading = false }: { connected: boolean, loading?: boolean }) {
  const style = loading ? "bg-slate-100 text-slate-600" : connected ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>{loading ? "Checking…" : connected ? "Connected" : "Not connected"}</span>
}

export default function ConnectionsPage() {
  const [store, setStore] = useState("irrakids")
  const { stores, registry, loading: storesLoading, refresh: refreshStores } = useShopifyStores(store)
  const [authorized, setAuthorized] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [meta, setMeta] = useState<MetaStatus | null>(null)
  const [metaLoading, setMetaLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const requestSeq = useRef(0)
  const selectedShopify = stores.find(item => item.label === store)
  const connectedShops = stores.filter(item => item.connected).length
  const accountGroups = useMemo(() => {
    const groups = new Map<string, AdAccount[]>()
    for (const account of meta?.accounts || []) {
      const key = account.business_name || "Other accessible accounts"
      groups.set(key, [...(groups.get(key) || []), account])
    }
    return [...groups.entries()]
  }, [meta?.accounts])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setStore(params.get("store") || localStorage.getItem("ptos_store") || "irrakids")
    if (params.get("meta_error")) setError("Facebook connection was cancelled or could not be completed.")
    if (params.get("meta_connected")) setNotice("Facebook is connected. Its ad accounts are listed below.")
    systemHealthMe().then(result => setAuthorized(!result.error)).catch(() => setAuthorized(false))
  }, [])

  async function refreshMeta(selected = store) {
    if (!authorized) return
    const id = ++requestSeq.current
    setMetaLoading(true)
    try {
      const response = await fetch(`${base}/api/connections/meta/status?store=${encodeURIComponent(selected)}`, { headers: adminHeaders(), cache: "no-store" })
      const payload = await response.json()
      if (!response.ok || payload.error) throw new Error(payload.error || "Could not load Meta connection")
      if (id === requestSeq.current) setMeta(payload.data)
    } catch (err: any) {
      if (id === requestSeq.current) { setMeta(null); setError(String(err?.message || err)) }
    } finally {
      if (id === requestSeq.current) setMetaLoading(false)
    }
  }

  useEffect(() => { if (authorized) void refreshMeta(store) }, [authorized, store])

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

  async function connectFacebook() {
    setBusy(true); setError(""); setNotice("")
    try {
      const response = await fetch(`${base}/api/connections/meta/start`, {
        method: "POST", headers: adminHeaders(), body: JSON.stringify({ store, return_origin: window.location.origin }),
      })
      const payload = await response.json()
      if (!response.ok || payload.error || !payload.data?.url) throw new Error(payload.error || "Could not start Facebook connection")
      window.location.assign(payload.data.url)
    } catch (err: any) {
      setError(String(err?.message || err))
      setBusy(false)
    }
  }

  function changeStore(value: string) {
    requestSeq.current += 1
    setStore(value); setMeta(null); setMetaLoading(true); setError(""); setNotice("")
    localStorage.setItem("ptos_store", value)
  }

  return <main className="min-h-screen bg-slate-50 text-slate-900">
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:py-10">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-blue-700">Product Testing OS / Settings</p><h1 className="mt-2 text-3xl font-bold tracking-tight">Connections</h1><p className="mt-2 text-sm text-slate-600">Manage the stores and advertising accounts used by your product data and ads manager.</p></div>
        <nav className="flex flex-wrap gap-2 text-sm font-semibold"><Link href="/settings/users" className="rounded-lg border bg-white px-3 py-2 hover:bg-slate-100">Users</Link><Link href="/ads-management" className="rounded-lg border bg-white px-3 py-2 hover:bg-slate-100">Ads manager</Link><Link href="/" className="rounded-lg bg-slate-900 px-3 py-2 text-white">Home</Link></nav>
      </header>

      {!authorized ? <form onSubmit={signIn} className="max-w-md rounded-2xl border bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3"><ShieldCheck className="h-6 w-6 text-blue-700" /><div><h2 className="font-bold">Administrator sign in</h2><p className="text-sm text-slate-500">Use your System Health administrator account.</p></div></div>
        <label className="block text-sm font-medium">Email<input required type="email" value={email} onChange={event => setEmail(event.target.value)} className="mt-1 w-full rounded-lg border p-2.5" /></label>
        <label className="mt-3 block text-sm font-medium">Password<input required type="password" value={password} onChange={event => setPassword(event.target.value)} className="mt-1 w-full rounded-lg border p-2.5" /></label>
        <button disabled={busy} className="mt-5 rounded-lg bg-blue-700 px-4 py-2.5 font-semibold text-white disabled:opacity-50">{busy ? "Signing in…" : "Sign in"}</button>
      </form> : <>
        <section className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-4 shadow-sm">
          <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Workspace</p><p className="mt-1 text-sm text-slate-600">Choose the store whose advertising connection you want to manage.</p></div>
          <select value={store} onChange={event => changeStore(event.target.value)} className="min-w-48 rounded-lg border bg-white px-3 py-2 text-sm font-semibold" aria-label="Workspace store">{stores.map(item => <option key={item.label} value={item.label}>{item.label}</option>)}</select>
        </section>
        {(error || notice) && <div role={error ? "alert" : "status"} className={`mb-5 rounded-xl border px-4 py-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{error || notice}</div>}

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="border-b p-5 sm:p-6">
              <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Facebook className="h-6 w-6" /></span><div><h2 className="text-lg font-bold">Meta Ads</h2><p className="text-sm text-slate-500">Facebook Business and Ads Manager</p></div></div><Badge connected={Boolean(meta?.connected)} loading={metaLoading} /></div>
              <p className="mt-4 text-sm leading-6 text-slate-600">Connect your Facebook account, approve access to your business, and bring its available ad accounts into this workspace.</p>
              <div className="mt-5 flex flex-wrap items-center gap-3"><button onClick={connectFacebook} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"><Facebook className="h-4 w-4" />{busy ? "Opening Facebook…" : meta?.connected ? "Reconnect to Facebook" : "Connect to Facebook"}<ArrowRight className="h-4 w-4" /></button><button onClick={() => void refreshMeta()} disabled={metaLoading} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"><RefreshCw className="h-4 w-4" />Refresh</button></div>
              {!metaLoading && !meta?.configured && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">Facebook setup is incomplete. Add your Meta app ID and secret on the server, then use Connect to Facebook to start the login flow.</p>}
            </div>
            <div className="p-5 sm:p-6">
              <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Available ad accounts</h3><span className="text-xs font-semibold text-slate-500">{meta?.accounts?.length || 0} accounts</span></div>
              {meta?.connected ? <>
                <p className="mb-4 text-sm text-slate-600">Connected as <span className="font-semibold text-slate-900">{meta.user_name || "Facebook user"}</span>. These accounts can be selected in Ads manager.</p>
                {accountGroups.length ? <div className="max-h-72 space-y-4 overflow-auto pr-1">{accountGroups.map(([business, accounts]) => <div key={business}><p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500"><Users className="h-3.5 w-3.5" />{business}</p><div className="space-y-2">{accounts.map(account => <div key={account.id} className="flex items-center justify-between gap-3 rounded-lg border bg-slate-50 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-semibold">{account.name || account.id}</p><p className="text-xs text-slate-500">{account.id}</p></div><span className={`shrink-0 text-xs font-medium ${account.account_status === 1 ? "text-emerald-700" : "text-slate-500"}`}>{account.account_status === 1 ? "Active" : "Available"}</span></div>)}</div></div>)}</div> : <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">Facebook is connected, but no ad accounts were returned. Check Business Manager permissions and reconnect.</p>}
                {meta.expires_at && <p className="mt-4 text-xs text-slate-500">Access expires {new Date(meta.expires_at * 1000).toLocaleDateString()}.</p>}
              </> : <p className="rounded-lg border border-dashed bg-slate-50 p-4 text-sm text-slate-600">No Facebook business or ad accounts are connected to {store} yet.</p>}
              {meta?.callback_url && <p className="mt-4 break-all text-xs text-slate-500">Meta redirect URI: {meta.callback_url}</p>}
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
            <div className="border-b p-5 sm:p-6">
              <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Store className="h-6 w-6" /></span><div><h2 className="text-lg font-bold">Shopify</h2><p className="text-sm text-slate-500">Stores, products, and orders</p></div></div><Badge connected={Boolean(selectedShopify?.connected)} loading={storesLoading} /></div>
              <p className="mt-4 text-sm leading-6 text-slate-600">Connect each store to load its catalog and orders. The selected workspace is highlighted below.</p>
              <div className="mt-5 flex flex-wrap items-center gap-3"><Link href={`/shopify-connect?store=${encodeURIComponent(store)}`} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800">{selectedShopify?.connected ? "Manage Shopify connection" : "Connect Shopify store"}<ArrowRight className="h-4 w-4" /></Link><button onClick={() => void refreshStores()} className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-medium hover:bg-slate-50"><RefreshCw className="h-4 w-4" />Refresh</button></div>
              {selectedShopify?.credentials_configured === false && <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">This store needs Shopify app credentials: {(selectedShopify.missing_env || []).join(", ")}.</p>}
              {registry.persistent_token_storage === false && <p className="mt-3 text-xs text-amber-800">Persistent database storage is required for OAuth connections.</p>}
            </div>
            <div className="p-5 sm:p-6"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Your stores</h3><span className="text-xs font-semibold text-slate-500">{connectedShops} connected / {stores.length} total</span></div><div className="max-h-80 space-y-2 overflow-auto pr-1">{stores.map(item => <div key={item.label} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-3 ${item.label === store ? "border-emerald-300 bg-emerald-50/50" : "bg-slate-50"}`}><div className="min-w-0"><p className="flex items-center gap-1.5 truncate text-sm font-semibold">{item.label}{item.connected && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}</p><p className="truncate text-xs text-slate-500">{item.shop || "No shop connected"}</p></div><Link href={`/shopify-connect?store=${encodeURIComponent(item.label)}`} className="shrink-0 text-xs font-semibold text-emerald-800 hover:underline">{item.connected ? "Manage" : "Connect"}</Link></div>)}</div></div>
          </section>
        </div>
        <section className="mt-6 rounded-2xl border bg-white p-5 shadow-sm sm:p-6"><h2 className="font-bold">More advertising channels</h2><p className="mt-1 text-sm text-slate-500">These connections are planned for a later release.</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{["Google Ads", "TikTok Ads"].map(name => <div key={name} className="flex items-center justify-between rounded-lg border px-4 py-3"><span className="text-sm font-semibold">{name}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">Coming soon</span></div>)}</div></section>
      </>}
      {!authorized && error && <p role="alert" className="mt-4 max-w-md rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    </div>
  </main>
}
