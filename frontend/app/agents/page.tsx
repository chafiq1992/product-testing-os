"use client"
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, AppWindow, Settings } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { agentsList, agentCreate } from '@/lib/api'

type AgentItem = { id: string, name: string, description?: string }
function slugify(s: string){
  return (s||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || `agent-${Date.now()}`
}

export default function AgentsHomePage(){
  const router = useRouter()
  const [agents, setAgents] = useState<AgentItem[]>([])
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(()=>{ (async()=>{ try{ const res = await agentsList(); setAgents((res as any)?.data||[]) }catch{} })() },[])

  async function onCreate(){
    if(!newName.trim()) return
    setCreating(true)
    try{
      const id = slugify(newName)
      const res = await agentCreate({ id, name: newName.trim(), description: newDesc.trim()||undefined })
      const effId = (res as any)?.id || id
      setShowNew(false)
      setNewName(''); setNewDesc('')
      try{ const list = await agentsList(); setAgents((list as any)?.data||[]) }catch{}
      router.push(`/agents/${encodeURIComponent(effId)}`)
    } finally{ setCreating(false) }
  }

  const adsTile = useMemo(()=> (
    <Link href="/ads/agent" className="group border border-slate-200 rounded-xl bg-white hover:shadow-md transition p-4 flex flex-col items-center justify-center text-center">
      <div className="w-16 h-16 rounded-lg bg-sky-50 border border-sky-100 grid grid-cols-2 grid-rows-2 gap-1 p-1 mb-3">
        <div className="bg-white border border-slate-200 rounded"/>
        <div className="bg-white border border-slate-200 rounded"/>
        <div className="bg-white border border-slate-200 rounded"/>
        <div className="bg-white border border-slate-200 rounded"/>
      </div>
      <div className="text-sm font-semibold text-slate-800">Ads Agent</div>
      <div className="text-xs text-slate-500">Windows-style tile</div>
    </Link>
  ),[])

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-sky-50 via-white to-indigo-50 text-slate-800">
      <header className="h-16 px-5 md:px-8 flex items-center justify-between border-b bg-white/70 backdrop-blur sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <AppWindow className="w-6 h-6 text-blue-600" />
          <h1 className="font-semibold text-xl tracking-tight">Irrakids Agents</h1>
        </div>
        <div className="flex items-center gap-2">
          <button className="rounded-xl font-semibold inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white" onClick={()=>setShowNew(true)}>
            <Plus className="w-4 h-4"/> New Agent
          </button>
        </div>
      </header>
      <div className="p-6 md:p-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {adsTile}
          {agents.map(a=> (
            <Link key={a.id} href={`/agents/${encodeURIComponent(a.id)}`} className="group border border-slate-200 rounded-xl bg-white hover:shadow-md transition p-4 flex flex-col text-slate-800">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-100 grid grid-cols-2 grid-rows-2 gap-0.5 p-1">
                    <div className="bg-white border border-slate-200 rounded"/>
                    <div className="bg-white border border-slate-200 rounded"/>
                    <div className="bg-white border border-slate-200 rounded"/>
                    <div className="bg-white border border-slate-200 rounded"/>
                  </div>
                  <div className="font-semibold">{a.name}</div>
                </div>
                <Settings className="w-4 h-4 text-slate-400"/>
              </div>
              {a.description? <div className="text-xs text-slate-600 line-clamp-2">{a.description}</div> : <div className="text-xs text-slate-500">No description</div>}
            </Link>
          ))}
        </div>
      </div>

      {showNew? (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-[60]" onClick={()=>setShowNew(false)}>
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl p-5" onClick={(e)=>e.stopPropagation()}>
            <div className="text-lg font-semibold mb-2">Create New Agent</div>
            <div className="text-sm text-slate-600 mb-3">Name is required; description is optional.</div>
            <div className="space-y-3">
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2" placeholder="Agent name" value={newName} onChange={e=>setNewName(e.target.value)} />
              <textarea className="w-full min-h-[96px] border border-slate-200 rounded-lg px-3 py-2" placeholder="Description (optional)" value={newDesc} onChange={e=>setNewDesc(e.target.value)} />
            </div>
            <div className="flex items-center justify-end gap-2 mt-4">
              <button className="px-3 py-2 text-sm border border-slate-200 rounded-lg" onClick={()=>setShowNew(false)}>Cancel</button>
              <button disabled={creating || !newName.trim()} className="px-3 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg" onClick={onCreate}>Create</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}


