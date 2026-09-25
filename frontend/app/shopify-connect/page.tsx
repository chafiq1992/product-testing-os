"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useShopifyStores } from "@/lib/shopifyStores"
import { systemHealthLogin, systemHealthMe } from "@/lib/api"

function selectedStore() {
  try {
    if (typeof window === "undefined") return "irrakids"
    const fromQuery = new URLSearchParams(window.location.search).get("store")
    return (fromQuery || localStorage.getItem("ptos_store") || "irrakids").trim().toLowerCase()
  } catch {
    return "irrakids"
  }
}

export default function ShopifyConnectPage() {
  const [store, setStore] = useState("irrakids")
  const [shop, setShop] = useState("")
  const [connected, setConnected] = useState(false)
  const [connectedShop, setConnectedShop] = useState<string | null>(null)
  const [callbackUrl, setCallbackUrl] = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [authorized, setAuthorized] = useState(false)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const base = useMemo(() => process.env.NEXT_PUBLIC_API_BASE_URL || "", [])
  const { stores, registry, loading: storesLoading, error: storesError } = useShopifyStores(store)
  const selectedConfig = stores.find(item => item.label === store)

  useEffect(() => {
    setStore(selectedStore())
    systemHealthMe().then(result => setAuthorized(!result.error)).catch(() => setAuthorized(false))
  }, [])

  useEffect(() => {
    setShop(selectedConfig?.shop || "")
  }, [store, selectedConfig?.shop])

  async function refresh() {
    if (!authorized) return
    try {
      setStatusError(null)
      const token = localStorage.getItem("ptos_system_admin_token") || ""
      const response = await fetch(`${base}/api/shopify/oauth/status?store=${encodeURIComponent(store)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      const payload = await response.json()
      if (!response.ok || payload?.error) throw new Error(payload?.error || `Request failed (${response.status})`)
      const data = payload?.data || {}
      setConnected(Boolean(data.connected))
      setConnectedShop(data.shop || null)
      setCallbackUrl(data.callback_url || registry.callback_url || null)
    } catch (err: any) {
      setConnected(false)
      setConnectedShop(null)
      setCallbackUrl(registry.callback_url || null)
      setStatusError(String(err?.message || err || "Unable to load connection status"))
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, authorized])

  function changeStore(value: string) {
    setStore(value)
    try { localStorage.setItem("ptos_store", value) } catch {}
  }

  async function onConnect() {
    const domain = shop.trim().toLowerCase()
    if (!domain) {
      alert("Please enter your shop domain (example: beitii.myshopify.com)")
      return
    }
    try { localStorage.setItem("ptos_store", store) } catch {}
    try {
      const token = localStorage.getItem("ptos_system_admin_token") || ""
      const response = await fetch(`${base}/api/shopify/oauth/start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ store, shop: domain, return_origin: window.location.origin }),
      })
      const payload = await response.json()
      if (!response.ok || payload.error || !payload.data?.url) throw new Error(payload.error || "Unable to start Shopify connection")
      window.location.assign(payload.data.url)
    } catch (err: any) {
      setStatusError(String(err?.message || err))
    }
  }

  async function signIn(event: React.FormEvent) {
    event.preventDefault()
    try {
      const result = await systemHealthLogin({ email, password, remember: true })
      if (result.error || !result.data?.token) throw new Error(result.error || "Sign in failed")
      localStorage.setItem("ptos_system_admin_token", result.data.token)
      setAuthorized(true)
      setPassword("")
    } catch (err: any) { setStatusError(String(err?.message || err)) }
  }

  const credentialsReady = selectedConfig?.credentials_configured !== false

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-900">
      <header className="h-16 px-4 md:px-6 flex items-center justify-between border-b bg-white/80 backdrop-blur sticky top-0 z-50">
        <div className="font-semibold text-lg">Shopify Connect</div>
        <div className="flex items-center gap-2">
          <Link href="/" className="rounded-xl font-semibold inline-flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-950 text-white">Home</Link>
          <Link href="/confirmation" className="rounded-xl font-semibold inline-flex items-center gap-2 px-4 py-2 border bg-white hover:bg-slate-50">Confirmation</Link>
        </div>
      </header>

      <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
        {!authorized && <form onSubmit={signIn} className="rounded-xl border bg-white p-4 space-y-3">
          <h2 className="font-semibold">Administrator sign in</h2>
          <input required type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="Email" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <input required type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Password" className="w-full rounded-lg border px-3 py-2 text-sm" />
          <button className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white">Sign in</button>
          {statusError && <p role="alert" className="text-sm text-red-700">{statusError}</p>}
        </form>}
        {authorized && <>
        <div className="bg-white border rounded-xl p-4">
          <div className="text-sm text-slate-700">
            Stores are loaded at runtime from <code>SHOPIFY_OAUTH_STORES</code>. Each label uses its own Shopify Dev Dashboard app credentials.
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Store label (internal)</label>
              <select
                value={store}
                onChange={event => changeStore(event.target.value)}
                disabled={storesLoading}
                className="w-full rounded-lg border px-3 py-2 text-sm disabled:opacity-60"
              >
                {stores.map(item => <option key={item.label} value={item.label}>{item.label}</option>)}
              </select>
              <div className="text-[11px] text-slate-500 mt-1">Add new labels in Cloud Run; no frontend rebuild is required.</div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Shop domain</label>
              <input
                value={shop}
                onChange={event => setShop(event.target.value)}
                placeholder="beitii.myshopify.com"
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>

            {!credentialsReady && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                Missing Cloud Run configuration: {(selectedConfig?.missing_env || []).join(", ")}
              </div>
            )}
            {(selectedConfig?.warnings || []).map(warning => (
              <div key={warning} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{warning}</div>
            ))}
            {registry.persistent_token_storage === false && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                OAuth tokens are using temporary Cloud Run storage. Configure <code>DATABASE_URL</code> before relying on this connection in production.
              </div>
            )}
            {(storesError || statusError) && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{storesError || statusError}</div>
            )}

            <div className="flex items-center gap-2">
              <button disabled={!credentialsReady || storesLoading} onClick={onConnect} className="rounded-lg px-3 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50">
                Connect (OAuth install)
              </button>
              <button onClick={refresh} className="rounded-lg px-3 py-2 text-sm font-semibold border bg-white hover:bg-slate-50">Refresh status</button>
            </div>

            <div className="rounded-lg border bg-slate-50 p-3 text-sm">
              <div><span className="font-semibold">Status:</span> {connected ? "Connected" : "Not connected"}</div>
              <div className="text-slate-600 text-[13px] mt-1">Shop: {connectedShop || selectedConfig?.shop || "—"}</div>
              <div className="text-slate-600 text-[13px] mt-1 break-all">Whitelisted callback URL: {callbackUrl || registry.callback_url || "—"}</div>
            </div>
          </div>
        </div>
        </>}
      </div>
    </div>
  )
}
