"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { CheckCircle2, LogOut, Phone, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { confirmationAgentAnalytics, confirmationLogin, confirmationListOrders, confirmationOrderAction, confirmationStats } from "@/lib/api"

type OrderRow = {
  id: string
  name?: string
  created_at?: string
  processed_at?: string
  total_price?: string|number
  currency?: string
  financial_status?: string|null
  fulfillment_status?: string|null
  email?: string|null
  phone?: string|null
  customer?: { first_name?: string|null, last_name?: string|null, email?: string|null, phone?: string|null }
  shipping_address?: any
  billing_address?: any
  line_items?: Array<{ title?: string|null, variant_title?: string|null, quantity?: number|null, sku?: string|null }>
  tags: string[]
}

function WhatsAppIcon({ className="" }:{ className?: string }){
  // Simple WhatsApp-ish bubble icon (no brand assets)
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="currentColor" d="M12 2a9.8 9.8 0 0 0-8.3 15l-1 4 4.1-1a9.8 9.8 0 1 0 5.2-18Zm0 1.9a7.9 7.9 0 0 1 6.8 12.1l-.3.5.7 2.8-2.8-.7-.5.3A7.9 7.9 0 1 1 12 3.9Zm-3 4.2c-.4 0-.9.2-1.1.6-.3.4-.7 1-.7 2 0 1 .7 2.1.8 2.2.1.2 1.4 2.2 3.5 3.1 2.1.9 2.1.6 2.5.6.4 0 1.3-.5 1.5-1 .2-.5.2-.9.1-1-.1-.1-.4-.2-.8-.4-.4-.2-1.3-.6-1.5-.6-.2-.1-.4-.1-.6.2-.2.4-.7 1-.9 1.1-.2.1-.3.1-.6 0-.3-.2-1.2-.4-2.2-1.4-.8-.7-1.3-1.7-1.5-2-.2-.3 0-.4.1-.6.1-.1.3-.3.4-.5.1-.2.2-.3.3-.5.1-.2.1-.4 0-.6 0-.2-.6-1.4-.8-1.9-.2-.5-.4-.4-.6-.4Z"/>
    </svg>
  )
}

function TagBadge({ tag }:{ tag: string }){
  return <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] text-slate-700 bg-white">{tag}</span>
}

function StatPill({ label, value }:{ label: string, value: number|string }){
  return (
    <div className="shrink-0 inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1 text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="font-semibold text-slate-900">{value}</span>
    </div>
  )
}

function fmtDate(s?: string){
  try{
    if(!s) return ""
    const d = new Date(s)
    if(Number.isNaN(d.getTime())) return String(s)
    return d.toLocaleString(undefined, { year:"2-digit", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" })
  }catch{ return String(s||"") }
}

function normalizeWaPhone(raw?: string|null){
  const p = String(raw||"")
  let digits = p.replace(/\D/g,"")
  // Heuristic: if local 0XXXXXXXXX (10 digits) assume MA and convert to 212XXXXXXXX
  if(digits.startsWith("0") && digits.length === 10){
    digits = "212" + digits.slice(1)
  }
  return digits
}

function fmtAddress(ship: any){
  try{
    if(!ship) return ""
    const parts: string[] = []
    const a1 = String(ship.address1||"").trim()
    const a2 = String(ship.address2||"").trim()
    const city = String(ship.city||"").trim()
    const prov = String(ship.province||ship.province_code||"").trim()
    const zip = String(ship.zip||"").trim()
    if(a1) parts.push(a1)
    if(a2) parts.push(a2)
    const loc = [city, prov, zip].filter(Boolean).join(" ")
    if(loc) parts.push(loc)
    return parts.join(" · ")
  }catch{ return "" }
}

export default function ConfirmationPage(){
  const [store, setStore] = useState("irrakids")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [remember, setRemember] = useState(true)
  const [loggingIn, setLoggingIn] = useState(false)

  const [agentEmail, setAgentEmail] = useState<string>("")
  const [authed, setAuthed] = useState(false)

  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(false)
  const [pageInfo, setPageInfo] = useState<string|null>(null)
  const [nextPageInfo, setNextPageInfo] = useState<string|null>(null)
  const [prevPageInfo, setPrevPageInfo] = useState<string|null>(null)
  const [pageIdx, setPageIdx] = useState(1)

  const [stats, setStats] = useState<Record<string, number>>({})
  const myConfirmed = useMemo(()=> (agentEmail ? (stats[agentEmail]||0) : 0), [stats, agentEmail])

  const [agentAnalytics, setAgentAnalytics] = useState<any>({})

  const [confirming, setConfirming] = useState<{ orderId: string, date: string }|null>(null)

  useEffect(()=>{
    try{
      const s = localStorage.getItem("ptos_store") || "irrakids"
      setStore(s)
      const tok = localStorage.getItem("ptos_confirmation_token") || ""
      const ae = localStorage.getItem("ptos_confirmation_email") || ""
      if(tok){
        setAuthed(true)
        setAgentEmail(ae)
      }
    }catch{}
  },[])

  async function refreshStats(){
    try{
      const res = await confirmationStats({ store })
      if((res as any)?.error){ return }
      setStats((res as any)?.data || {})
    }catch{}
  }

  async function refreshAgentAnalytics(){
    try{
      const res = await confirmationAgentAnalytics({ store })
      if((res as any)?.error){ return }
      setAgentAnalytics((res as any)?.data || {})
    }catch{}
  }

  async function loadOrders(opts?: { page_info?: string|null, direction?: "next"|"prev"|"reset" }){
    const dir = opts?.direction
    try{
      setLoading(true)
      const res = await confirmationListOrders({ store, limit: 50, page_info: opts?.page_info ?? null })
      if((res as any)?.error){
        if((res as any)?.error === "unauthorized"){
          toast.error("Session expired. Please sign in again.")
          doLogout()
          return
        }
        toast.error(String((res as any)?.error))
        return
      }
      const data = (res as any)?.data || {}
      setOrders((data.orders || []) as OrderRow[])
      setNextPageInfo(data.next_page_info || null)
      setPrevPageInfo(data.prev_page_info || null)
      if(dir === "reset"){ setPageIdx(1) }
      else if(dir === "next"){ setPageIdx(p=> p+1) }
      else if(dir === "prev"){ setPageIdx(p=> Math.max(1, p-1)) }
    }catch(e:any){
      toast.error(e?.message || "Failed to load orders")
    }finally{
      setLoading(false)
    }
  }

  useEffect(()=>{
    if(!authed) return
    setPageInfo(null)
    loadOrders({ page_info: null, direction: "reset" })
    refreshStats()
    refreshAgentAnalytics()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[authed, store])

  function doLogout(){
    try{
      localStorage.removeItem("ptos_confirmation_token")
      localStorage.removeItem("ptos_confirmation_email")
    }catch{}
    setAuthed(false)
    setAgentEmail("")
    setOrders([])
    setStats({})
    setPageInfo(null)
    setNextPageInfo(null)
    setPrevPageInfo(null)
    setPageIdx(1)
  }

  async function onLogin(e: React.FormEvent){
    e.preventDefault()
    try{
      setLoggingIn(true)
      const res = await confirmationLogin({ email, password, remember, store })
      if((res as any)?.error){
        toast.error(String((res as any)?.error))
        return
      }
      const token = (res as any)?.data?.token
      const ae = (res as any)?.data?.agent?.email || email.trim().toLowerCase()
      if(!token){
        toast.error("Login failed")
        return
      }
      try{
        localStorage.setItem("ptos_confirmation_token", token)
        localStorage.setItem("ptos_confirmation_email", ae)
      }catch{}
      setAgentEmail(ae)
      setAuthed(true)
      toast.success("Signed in")
    }catch(e:any){
      toast.error(e?.message || "Login failed")
    }finally{
      setLoggingIn(false)
    }
  }

  async function mutateTags(orderId: string, action: "phone"|"whatsapp"|"confirm", date?: string){
    const res = await confirmationOrderAction({ store, order_id: orderId, action, date })
    if((res as any)?.error){
      toast.error(String((res as any)?.error))
      return null
    }
    return (res as any)?.data as { tags: string[], cod?: string }
  }

  async function onPhoneClick(o: OrderRow){
    if(!o.phone){ toast.error("No phone number on this order"); return }
    const data = await mutateTags(o.id, "phone")
    if(!data) return
    setOrders(arr=> arr.map(x=> x.id===o.id? { ...x, tags: (data.tags||[]) } : x))
    try{ window.open(`tel:${o.phone}`, "_self") }catch{}
  }

  async function onWhatsAppClick(o: OrderRow){
    const digits = normalizeWaPhone(o.phone || "")
    if(!digits){ toast.error("No phone number on this order"); return }
    const data = await mutateTags(o.id, "whatsapp")
    if(!data) return
    setOrders(arr=> arr.map(x=> x.id===o.id? { ...x, tags: (data.tags||[]) } : x))
    try{ window.open(`https://wa.me/${digits}`, "_blank", "noopener,noreferrer") }catch{}
  }

  async function onConfirmSubmit(){
    if(!confirming) return
    const { orderId, date } = confirming
    if(!date){ toast.error("Pick a date"); return }
    const data = await mutateTags(orderId, "confirm", date)
    if(!data) return
    toast.success(`Confirmed (${data.cod || date})`)
    // Remove from list (it now has cod tag and is excluded)
    setOrders(arr=> arr.filter(x=> x.id !== orderId))
    setConfirming(null)
    refreshStats()
    refreshAgentAnalytics()
  }

  if(!authed){
    return (
      <div className="min-h-screen w-full bg-white text-slate-800 flex items-center justify-center px-4">
        <div className="w-full max-w-md border rounded-2xl shadow-sm bg-white p-6">
          <div className="text-xl font-semibold">Order Collector Login</div>
          <div className="text-sm text-slate-500 mt-1">Sign in to track actions and view analytics.</div>
          <form onSubmit={onLogin} className="mt-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Store</label>
              <select value={store} onChange={(e)=> {
                const v = e.target.value
                setStore(v)
                try{ localStorage.setItem("ptos_store", v) }catch{}
              }} className="w-full rounded-lg border px-3 py-2 text-sm">
                <option value="irrakids">irrakids</option>
                <option value="irranova">irranova</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
              <input value={email} onChange={(e)=>setEmail(e.target.value)} placeholder="you@example.com" className="w-full rounded-lg border px-3 py-2 text-sm bg-slate-800 text-white placeholder:text-slate-300" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Password</label>
              <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} placeholder="••••••••" className="w-full rounded-lg border px-3 py-2 text-sm bg-slate-800 text-white placeholder:text-slate-300" />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600 select-none">
              <input type="checkbox" checked={remember} onChange={(e)=>setRemember(e.target.checked)} />
              Remember me (stay signed in on this device)
            </label>
            <button disabled={loggingIn} className="w-full rounded-lg px-3 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60">
              {loggingIn? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 text-slate-800">
      <header className="h-16 px-4 md:px-6 flex items-center justify-between border-b bg-white/80 backdrop-blur sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="font-semibold text-lg">Confirmation</div>
          <div className="text-xs text-slate-500">Signed in as <span className="font-medium">{agentEmail || "agent"}</span></div>
        </div>
        <div className="flex items-center gap-2">
          <select value={store} onChange={(e)=> {
            const v = e.target.value
            setStore(v)
            try{ localStorage.setItem("ptos_store", v) }catch{}
          }} className="rounded-xl border px-2 py-1 text-sm">
            <option value="irrakids">irrakids</option>
            <option value="irranova">irranova</option>
          </select>
          <Link href="/" className="rounded-xl font-semibold inline-flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-950 text-white">Home</Link>
          <button onClick={()=>{ refreshStats(); refreshAgentAnalytics(); loadOrders({ page_info: pageInfo, direction: undefined }) }} className="rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-2 border bg-white hover:bg-slate-50">
            <RefreshCw className={`w-4 h-4 ${loading? "animate-spin": ""}`}/> Refresh
          </button>
          <button onClick={doLogout} className="rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-2 border bg-white hover:bg-slate-50">
            <LogOut className="w-4 h-4"/> Logout
          </button>
        </div>
      </header>

      <div className="sticky top-16 z-40 border-b bg-white/80 backdrop-blur">
        <div className="px-4 md:px-6 py-2 flex items-center gap-2 overflow-auto">
          <StatPill label="Assigned" value={Number(agentAnalytics?.assigned_total||0)} />
          <StatPill label="N1" value={Number(agentAnalytics?.n1||0)} />
          <StatPill label="N2" value={Number(agentAnalytics?.n2||0)} />
          <StatPill label="N3" value={Number(agentAnalytics?.n3||0)} />
          <StatPill label="Total N" value={Number(agentAnalytics?.any_n||0)} />
          <StatPill label="No N" value={Number(agentAnalytics?.no_n||0)} />
          <StatPill label="All N (n1+n2+n3)" value={Number(agentAnalytics?.all_n||0)} />
          <StatPill label="Confirmed" value={Number(agentAnalytics?.confirmed_total ?? myConfirmed ?? 0)} />
          {agentAnalytics?.truncated && (
            <span className="shrink-0 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1">
              Truncated (too many pages)
            </span>
          )}
        </div>
      </div>

      <div className="p-4 md:p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="bg-white border rounded-xl p-4">
            <div className="text-xs text-slate-500">My confirmed orders</div>
            <div className="text-2xl font-semibold mt-1">{myConfirmed}</div>
          </div>
          <div className="bg-white border rounded-xl p-4 md:col-span-2">
            <div className="text-xs text-slate-500">Team confirmed (all agents)</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.keys(stats||{}).length===0 && <div className="text-sm text-slate-500">No data yet.</div>}
              {Object.entries(stats||{}).sort((a,b)=> (b[1]||0)-(a[1]||0)).map(([k,v])=> (
                <span key={k} className="inline-flex items-center gap-2 rounded-full border px-3 py-1 bg-white text-sm">
                  <span className="text-slate-600">{k}</span>
                  <span className="font-semibold">{v}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between">
            <div className="font-semibold">Open · Unfulfilled · Not confirmed</div>
            <div className="text-xs text-slate-500">Page {pageIdx}</div>
          </div>

          <div className="overflow-auto">
            <table className="min-w-[980px] w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Order</th>
                  <th className="text-left font-medium px-4 py-2">Customer</th>
                  <th className="text-left font-medium px-4 py-2">Phone</th>
                  <th className="text-left font-medium px-4 py-2">Shipping</th>
                  <th className="text-left font-medium px-4 py-2">Total</th>
                  <th className="text-left font-medium px-4 py-2">Created</th>
                  <th className="text-left font-medium px-4 py-2">Tags</th>
                  <th className="text-right font-medium px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan={8} className="px-4 py-6 text-slate-500">Loading…</td></tr>
                )}
                {!loading && orders.length===0 && (
                  <tr><td colSpan={8} className="px-4 py-6 text-slate-500">No orders found.</td></tr>
                )}
                {!loading && orders.map(o=> {
                  const ship = (o as any)?.shipping_address || {}
                  const shipName = String(ship?.name || [ship?.first_name, ship?.last_name].filter(Boolean).join(" ")).trim()
                  const custName = ([o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ").trim()) || shipName
                  const phone = o.phone || o.customer?.phone || ""
                  const shipAddr = fmtAddress(ship)
                  return (
                    <tr key={o.id} className="border-t">
                      <td className="px-4 py-3 align-top">
                        <div className="font-semibold">{o.name || `#${o.id}`}</div>
                        <div className="text-xs text-slate-500">{(o.line_items||[]).slice(0,2).map((li,i)=> (
                          <span key={i}>{li.title}{li.quantity? ` ×${li.quantity}`:""}{i===0 && (o.line_items||[]).length>1? " · ":""}</span>
                        ))}{(o.line_items||[]).length>2? " · …": ""}</div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div>{custName || o.email || "—"}</div>
                        <div className="text-xs text-slate-500">{o.email || o.customer?.email || ""}</div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="font-mono text-[13px]">{phone || "—"}</div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="text-[13px]">{shipAddr || "—"}</div>
                        <div className="text-xs text-slate-500">{String(ship?.city||"").trim() || ""}</div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="font-semibold">{o.total_price} {o.currency || ""}</div>
                        <div className="text-xs text-slate-500">{o.financial_status || ""}</div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div>{fmtDate(o.created_at || o.processed_at)}</div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-wrap gap-1.5">
                          {(o.tags||[]).slice(0, 8).map(t=> <TagBadge key={t} tag={t} />)}
                          {(o.tags||[]).length>8 && <span className="text-xs text-slate-500">+{(o.tags||[]).length-8}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex items-center justify-end gap-2">
                          <button disabled={!phone} onClick={()=>onPhoneClick(o)} title="Call (cycles n1/n2/n3)" className="inline-flex items-center justify-center w-9 h-9 rounded-lg border bg-white hover:bg-slate-50 disabled:opacity-50">
                            <Phone className="w-4 h-4 text-slate-700"/>
                          </button>
                          <button disabled={!phone} onClick={()=>onWhatsAppClick(o)} title="WhatsApp (cycles wtp1/wtp2/wtp3)" className="inline-flex items-center justify-center w-9 h-9 rounded-lg border bg-white hover:bg-slate-50 disabled:opacity-50">
                            <WhatsAppIcon className="w-4 h-4 text-slate-700"/>
                          </button>
                          <button onClick={()=> setConfirming({ orderId: o.id, date: new Date().toISOString().slice(0,10) })} title="Confirmed (adds cod dd/mm/yy tag)" className="inline-flex items-center gap-2 px-3 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold">
                            <CheckCircle2 className="w-4 h-4"/> Confirmed
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-3 border-t flex items-center justify-between">
            <div className="text-xs text-slate-500">Shopify-style cursor pagination</div>
            <div className="flex items-center gap-2">
              <button disabled={!prevPageInfo || loading} onClick={()=>{
                setPageInfo(prevPageInfo)
                loadOrders({ page_info: prevPageInfo, direction: "prev" })
              }} className="px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 disabled:opacity-50 text-sm font-semibold">Prev</button>
              <button disabled={!nextPageInfo || loading} onClick={()=>{
                setPageInfo(nextPageInfo)
                loadOrders({ page_info: nextPageInfo, direction: "next" })
              }} className="px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 disabled:opacity-50 text-sm font-semibold">Next</button>
            </div>
          </div>
        </div>
      </div>

      {confirming && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-sm bg-white border rounded-xl shadow-xl p-4">
            <div className="font-semibold">Select COD date</div>
            <div className="text-xs text-slate-500 mt-1">This will add a tag like <span className="font-mono">cod 23/12/25</span> and the order will disappear from the list.</div>
            <div className="mt-3">
              <input type="date" value={confirming.date} onChange={(e)=> setConfirming(v=> v? ({...v, date: e.target.value}): v)} className="w-full rounded-lg border px-3 py-2 text-sm" />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={()=>setConfirming(null)} className="px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 text-sm font-semibold">Cancel</button>
              <button onClick={onConfirmSubmit} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


