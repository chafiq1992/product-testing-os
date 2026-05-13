"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { BarChart3, KeyRound, LogOut, Plus, RefreshCw, Shield, Trash2, Users } from "lucide-react"
import { toast } from "sonner"
import {
  confirmationAdminAnalytics,
  confirmationAdminLogin,
  confirmationAdminUserDelete,
  confirmationAdminUserResetPassword,
  confirmationAdminUserUpsert,
  confirmationAdminUsersList,
} from "@/lib/api"

type AgentRow = { email: string, name?: string|null }
type AgentStats = { confirm: number, phone: number, whatsapp: number, last_at?: string|null }
type Analytics = {
  totals: { confirm: number, phone: number, whatsapp: number }
  agents: Record<string, AgentStats>
  daily: Array<{ date: string, confirm: number, phone: number, whatsapp: number }>
}

function Card({ children }:{children:React.ReactNode}){ return <div className="bg-white border rounded-2xl shadow-sm">{children}</div> }
function CardHeader({ title, icon, right }:{title:string, icon?:React.ReactNode, right?:React.ReactNode}){
  return (
    <div className="px-5 pt-5 flex items-start justify-between">
      <div className="flex items-center gap-2">
        {icon}
        <div className="font-semibold">{title}</div>
      </div>
      {right}
    </div>
  )
}
function CardBody({ children }:{children:React.ReactNode}){ return <div className="px-5 pb-5 pt-3">{children}</div> }

function fmtIso(iso?: string|null){
  try{
    if(!iso) return "—"
    const d = new Date(iso)
    if(Number.isNaN(d.getTime())) return String(iso)
    return d.toLocaleString(undefined, { year:"2-digit", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit" })
  }catch{ return "—" }
}

function miniBars(values: number[]){
  const max = Math.max(1, ...values)
  return values.map(v=> Math.round((v/max)*100))
}

export default function ConfirmationAdminPage(){
  const [store, setStore] = useState("irrakids")
  const [adminEmail, setAdminEmail] = useState("")
  const [adminPassword, setAdminPassword] = useState("")
  const [remember, setRemember] = useState(true)
  const [authed, setAuthed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [days, setDays] = useState(30)

  const [agents, setAgents] = useState<AgentRow[]>([])
  const [analytics, setAnalytics] = useState<Analytics | null>(null)

  const [newEmail, setNewEmail] = useState("")
  const [newName, setNewName] = useState("")
  const [newPassword, setNewPassword] = useState("")

  const [resetModal, setResetModal] = useState<{ email: string, generated?: string|null }|null>(null)

  useEffect(()=>{
    try{
      const s = localStorage.getItem("ptos_store") || "irrakids"
      setStore(s)
      const tok = localStorage.getItem("ptos_confirmation_admin_token") || ""
      if(tok) setAuthed(true)
    }catch{}
  },[])

  async function loadAll(){
    try{
      setLoading(true)
      const [u, a] = await Promise.all([
        confirmationAdminUsersList({ store }),
        confirmationAdminAnalytics({ store, days }),
      ])
      if((u as any)?.error){
        if((u as any)?.error === "unauthorized"){
          toast.error("Admin session expired. Please sign in again.")
          doLogout()
          return
        }
        toast.error(String((u as any)?.error))
      }else{
        setAgents(((u as any)?.data || []) as AgentRow[])
      }
      if((a as any)?.error){
        toast.error(String((a as any)?.error))
      }else{
        setAnalytics(((a as any)?.data || null) as Analytics)
      }
    }finally{
      setLoading(false)
    }
  }

  useEffect(()=>{
    if(!authed) return
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[authed, store, days])

  function doLogout(){
    try{ localStorage.removeItem("ptos_confirmation_admin_token") }catch{}
    setAuthed(false)
    setAgents([])
    setAnalytics(null)
  }

  async function onLogin(e: React.FormEvent){
    e.preventDefault()
    try{
      setLoading(true)
      const res = await confirmationAdminLogin({ email: adminEmail, password: adminPassword, remember })
      if((res as any)?.error){
        toast.error(String((res as any)?.error))
        return
      }
      const tok = (res as any)?.data?.token
      if(!tok){ toast.error("Login failed"); return }
      try{ localStorage.setItem("ptos_confirmation_admin_token", tok) }catch{}
      setAuthed(true)
      toast.success("Admin signed in")
    }catch(e:any){
      toast.error(e?.message || "Login failed")
    }finally{
      setLoading(false)
    }
  }

  const agentTable = useMemo(()=>{
    const byEmail = new Map<string, AgentRow>()
    for(const a of (agents||[])){
      if(a?.email) byEmail.set(String(a.email).toLowerCase(), a)
    }
    // Include agents that exist in analytics but not in users list (in case of deleted user with events)
    const statsAgents = Object.keys(analytics?.agents || {})
    for(const e of statsAgents){
      if(!byEmail.has(e)) byEmail.set(e, { email: e, name: null })
    }
    const rows = Array.from(byEmail.values())
    rows.sort((a,b)=> (a.email||"").localeCompare(b.email||""))
    return rows
  }, [agents, analytics])

  const totals = analytics?.totals || { confirm: 0, phone: 0, whatsapp: 0 }
  const dailyLast14 = useMemo(()=> {
    const arr = (analytics?.daily || []).slice(-14)
    return arr
  }, [analytics])
  const bars = useMemo(()=> miniBars(dailyLast14.map(d=> d.confirm||0)), [dailyLast14])

  async function onAddOrUpdate(){
    try{
      setLoading(true)
      const res = await confirmationAdminUserUpsert({ store, email: newEmail, name: newName || undefined, password: newPassword || undefined })
      if((res as any)?.error){ toast.error(String((res as any)?.error)); return }
      const gp = (res as any)?.data?.generated_password
      toast.success("Agent saved")
      setNewPassword("")
      await loadAll()
      if(gp){
        setResetModal({ email: (res as any)?.data?.email, generated: gp })
      }
    }finally{
      setLoading(false)
    }
  }

  async function onResetPassword(email: string){
    try{
      const ok = window.confirm(`Reset password for ${email}?`)
      if(!ok) return
      setLoading(true)
      const res = await confirmationAdminUserResetPassword({ store, email })
      if((res as any)?.error){ toast.error(String((res as any)?.error)); return }
      toast.success("Password reset")
      const gp = (res as any)?.data?.generated_password
      setResetModal({ email, generated: gp || null })
      await loadAll()
    }finally{
      setLoading(false)
    }
  }

  async function onDelete(email: string){
    try{
      const ok = window.confirm(`Remove agent ${email}?`)
      if(!ok) return
      setLoading(true)
      const res = await confirmationAdminUserDelete({ store, email })
      if((res as any)?.error){ toast.error(String((res as any)?.error)); return }
      toast.success("Agent removed")
      await loadAll()
    }finally{
      setLoading(false)
    }
  }

  if(!authed){
    return (
      <div className="min-h-screen w-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-slate-50 via-white to-indigo-50 text-slate-800 flex items-center justify-center px-4">
        <div className="w-full max-w-md border rounded-2xl shadow-sm bg-white p-6">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-600" />
            <div className="text-xl font-semibold">Confirmation Admin</div>
          </div>
          <div className="text-sm text-slate-500 mt-1">Manage agents and view analytics.</div>
          <form onSubmit={onLogin} className="mt-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
              <input value={adminEmail} onChange={(e)=>setAdminEmail(e.target.value)} placeholder="admin@example.com" className="w-full rounded-lg border px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Password</label>
              <input type="password" value={adminPassword} onChange={(e)=>setAdminPassword(e.target.value)} placeholder="••••••••" className="w-full rounded-lg border px-3 py-2 text-sm" />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600 select-none">
              <input type="checkbox" checked={remember} onChange={(e)=>setRemember(e.target.checked)} />
              Remember me (stay signed in on this device)
            </label>
            <button disabled={loading} className="w-full rounded-lg px-3 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60">
              {loading? "Signing in…" : "Sign in"}
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
          <Shield className="w-5 h-5 text-indigo-600" />
          <div className="font-semibold text-lg">Confirmation Admin</div>
          <div className="hidden md:block text-xs text-slate-500">Agent management & analytics</div>
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
          <select value={days} onChange={(e)=> setDays(parseInt(e.target.value, 10))} className="rounded-xl border px-2 py-1 text-sm">
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <Link href="/" className="rounded-xl font-semibold inline-flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-950 text-white">Home</Link>
          <Link href="/confirmation" className="rounded-xl font-semibold inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white">Confirmation</Link>
          <button onClick={loadAll} className="rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-2 border bg-white hover:bg-slate-50">
            <RefreshCw className={`w-4 h-4 ${loading? "animate-spin": ""}`}/> Refresh
          </button>
          <button onClick={doLogout} className="rounded-xl font-semibold inline-flex items-center gap-2 px-3 py-2 border bg-white hover:bg-slate-50">
            <LogOut className="w-4 h-4"/> Logout
          </button>
        </div>
      </header>

      <div className="p-4 md:p-6 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Card>
            <CardHeader title="Confirmed" icon={<BarChart3 className="w-4 h-4 text-emerald-600" />} />
            <CardBody>
              <div className="text-3xl font-semibold">{totals.confirm}</div>
              <div className="text-xs text-slate-500 mt-1">Total confirmed in selected window</div>
              <div className="mt-3 flex items-end gap-1 h-12">
                {bars.map((h, i)=> (
                  <div key={i} className="w-full rounded-sm bg-emerald-200" style={{ height: `${Math.max(6, h)}%` }} />
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                <span>{dailyLast14[0]?.date || ""}</span>
                <span>{dailyLast14[dailyLast14.length-1]?.date || ""}</span>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Touchpoints" icon={<Users className="w-4 h-4 text-blue-600" />} />
            <CardBody>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">Phone clicks</div>
                  <div className="text-2xl font-semibold">{totals.phone}</div>
                </div>
                <div className="rounded-xl border bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">WhatsApp clicks</div>
                  <div className="text-2xl font-semibold">{totals.whatsapp}</div>
                </div>
              </div>
              <div className="text-xs text-slate-500 mt-3">Counts are based on button clicks logged by the app.</div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Add / Update agent" icon={<Plus className="w-4 h-4 text-indigo-600" />} />
            <CardBody>
              <div className="grid grid-cols-1 gap-2">
                <input value={newEmail} onChange={(e)=>setNewEmail(e.target.value)} placeholder="agent@email.com" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={newName} onChange={(e)=>setNewName(e.target.value)} placeholder="Name (optional)" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={newPassword} onChange={(e)=>setNewPassword(e.target.value)} placeholder="Password (optional, auto-generate if empty)" className="rounded-lg border px-3 py-2 text-sm" />
                <button disabled={loading} onClick={onAddOrUpdate} className="rounded-lg px-3 py-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60">
                  Save agent
                </button>
                <div className="text-[11px] text-slate-500">If you leave password empty, the server generates one and shows it once.</div>
              </div>
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader title="Agents" icon={<Users className="w-4 h-4 text-slate-700" />} right={<span className="text-xs text-slate-500">{agentTable.length} agents</span>} />
          <CardBody>
            <div className="overflow-auto">
              <table className="min-w-[920px] w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-600">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">Agent</th>
                    <th className="text-left font-medium px-3 py-2">Name</th>
                    <th className="text-left font-medium px-3 py-2">Confirmed</th>
                    <th className="text-left font-medium px-3 py-2">Phone</th>
                    <th className="text-left font-medium px-3 py-2">WhatsApp</th>
                    <th className="text-left font-medium px-3 py-2">Last activity</th>
                    <th className="text-right font-medium px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {agentTable.map(a=> {
                    const s = (analytics?.agents || {})[String(a.email||"").toLowerCase()] || { confirm: 0, phone: 0, whatsapp: 0, last_at: null }
                    return (
                      <tr key={a.email} className="border-t">
                        <td className="px-3 py-2 font-medium">{a.email}</td>
                        <td className="px-3 py-2 text-slate-600">{a.name || "—"}</td>
                        <td className="px-3 py-2"><span className="inline-flex items-center rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs font-semibold text-emerald-800">{s.confirm}</span></td>
                        <td className="px-3 py-2"><span className="inline-flex items-center rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-xs font-semibold text-blue-800">{s.phone}</span></td>
                        <td className="px-3 py-2"><span className="inline-flex items-center rounded-full bg-fuchsia-50 border border-fuchsia-200 px-2 py-0.5 text-xs font-semibold text-fuchsia-800">{s.whatsapp}</span></td>
                        <td className="px-3 py-2 text-slate-600">{fmtIso(s.last_at)}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-2">
                            <button disabled={loading} onClick={()=>onResetPassword(a.email)} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 text-sm font-semibold disabled:opacity-60">
                              <KeyRound className="w-4 h-4"/> Reset password
                            </button>
                            <button disabled={loading} onClick={()=>onDelete(a.email)} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-white hover:bg-red-50 text-sm font-semibold text-red-700 border-red-200 disabled:opacity-60">
                              <Trash2 className="w-4 h-4"/> Remove
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      </div>

      {resetModal && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/30 px-4">
          <div className="w-full max-w-md bg-white border rounded-2xl shadow-xl p-5">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-indigo-600" />
              <div className="font-semibold">Password reset</div>
            </div>
            <div className="text-sm text-slate-600 mt-2">
              Agent: <span className="font-medium">{resetModal.email}</span>
            </div>
            <div className="mt-3 rounded-xl border bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Generated password (shown once)</div>
              <div className="mt-1 font-mono text-sm break-all">{resetModal.generated || "—"}</div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={()=> setResetModal(null)} className="px-3 py-1.5 rounded-lg border bg-white hover:bg-slate-50 text-sm font-semibold">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


