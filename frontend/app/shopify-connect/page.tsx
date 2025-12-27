"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

function selectedStore(){
  try{ return typeof window!=='undefined'? (localStorage.getItem('ptos_store')||'irrakids') : 'irrakids' }catch{ return 'irrakids' }
}

export default function ShopifyConnectPage(){
  const [store, setStore] = useState("irrakids")
  const [shop, setShop] = useState("")
  const [connected, setConnected] = useState(false)
  const [connectedShop, setConnectedShop] = useState<string | null>(null)
  const base = useMemo(()=> process.env.NEXT_PUBLIC_API_BASE_URL || "", [])

  useEffect(()=>{
    try{
      const s = selectedStore()
      setStore(s)
    }catch{}
  },[])

  async function refresh(){
    try{
      const qp = `?store=${encodeURIComponent(store)}`
      const res = await fetch(`${base}/api/shopify/oauth/status${qp}`)
      const j = await res.json()
      const d = j?.data || {}
      setConnected(!!d?.connected)
      setConnectedShop(d?.shop || null)
    }catch{
      setConnected(false)
      setConnectedShop(null)
    }
  }

  useEffect(()=>{
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[store])

  function onConnect(){
    const s = (shop || "").trim()
    if(!s){
      alert("Please enter your shop domain (example: irranova.myshopify.com)")
      return
    }
    try{
      localStorage.setItem("ptos_store", store)
    }catch{}
    // Backend endpoint does the redirect to Shopify (OAuth).
    const url = `${base}/api/shopify/oauth/start?store=${encodeURIComponent(store)}&shop=${encodeURIComponent(s)}`
    window.location.href = url
  }

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
        <div className="bg-white border rounded-xl p-4">
          <div className="text-sm text-slate-700">
            Use this page to install your Dev Dashboard app on a store and mint a per-store Admin API access token.
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Store label (internal)</label>
              <select value={store} onChange={(e)=> {
                const v = e.target.value
                setStore(v)
                try{ localStorage.setItem("ptos_store", v) }catch{}
              }} className="w-full rounded-lg border px-3 py-2 text-sm">
                <option value="irrakids">irrakids</option>
                <option value="irranova">irranova</option>
              </select>
              <div className="text-[11px] text-slate-500 mt-1">This must match what your app uses (e.g. in the Confirmation store dropdown).</div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Shop domain</label>
              <input
                value={shop}
                onChange={(e)=>setShop(e.target.value)}
                placeholder="irranova.myshopify.com"
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>

            <div className="flex items-center gap-2">
              <button onClick={onConnect} className="rounded-lg px-3 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white">
                Connect (OAuth install)
              </button>
              <button onClick={refresh} className="rounded-lg px-3 py-2 text-sm font-semibold border bg-white hover:bg-slate-50">
                Refresh status
              </button>
            </div>

            <div className="rounded-lg border bg-slate-50 p-3 text-sm">
              <div><span className="font-semibold">Status:</span> {connected ? "Connected" : "Not connected"}</div>
              <div className="text-slate-600 text-[13px] mt-1">Shop: {connectedShop || "—"}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


