"use client"
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { Settings, Rocket } from 'lucide-react'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { agentGet, agentRunsList, agentRunGet } from '@/lib/api'

const AdsAgentClient = dynamic(()=>import('../../ads/agent/AdsAgentClient'), { ssr: false })

export default function AgentViewPage(){
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading…</div>}>
      <AgentViewInner/>
    </Suspense>
  )
}

function AgentViewInner(){
  const params = useSearchParams()
  const id = String(params.get('id')||'')
  const [meta, setMeta] = useState<{id:string,name:string,description?:string, instruction?:string, output_pref?:string}>({ id, name: id })
  const [runs, setRuns] = useState<Array<{id:string,title?:string,status?:string,created_at?:string}>>([])
  const [selectedRunId, setSelectedRunId] = useState<string | ''>('')
  const [selectedRun, setSelectedRun] = useState<any>(null)
  const instructionKey = useMemo(()=> `agent_${id}_instruction`, [id])

  useEffect(()=>{ (async()=>{ if(!id) return; try{ const a = await agentGet(id); setMeta(a as any) }catch{}; try{ const rs = await agentRunsList(id, 20); setRuns((rs as any)?.data||[]) }catch{} })() },[id])
  useEffect(()=>{ (async()=>{ if(!id || !selectedRunId) return; try{ const r = await agentRunGet(id, selectedRunId); setSelectedRun(r) }catch{} })() },[id, selectedRunId])

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-sky-50 via-white to-indigo-50 text-slate-800">
      <header className="h-16 px-5 md:px-8 flex items-center justify-between border-b bg-white/70 backdrop-blur sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <Rocket className="w-6 h-6 text-blue-600" />
          <h1 className="font-semibold text-xl tracking-tight">{meta?.name||'Agent'}</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <select className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white" value={selectedRunId} onChange={e=>setSelectedRunId(e.target.value)}>
              <option value="">History</option>
              {runs.map(r=> (<option key={r.id} value={r.id}>{r.title||r.id}</option>))}
            </select>
          </div>
          <Link href="/agents" className="rounded-xl font-semibold inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white">Agents</Link>
        </div>
      </header>
      <div className="p-6 md:p-8">
        <AdsAgentClient instructionKey={instructionKey} enableOutputField={true} agentId={id} />
        {selectedRun? (
          <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm p-5">
            <div className="text-lg font-semibold mb-2">Previous Run</div>
            <div className="text-xs text-slate-500 mb-3">{selectedRun?.title||selectedRun?.id} — {selectedRun?.status}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <div className="text-sm font-medium mb-1">Input</div>
                <pre className="text-xs bg-slate-50 p-3 border rounded-lg overflow-auto max-h-64">{JSON.stringify(selectedRun?.input||{}, null, 2)}</pre>
              </div>
              <div>
                <div className="text-sm font-medium mb-1">Output</div>
                <pre className="text-xs bg-slate-50 p-3 border rounded-lg overflow-auto max-h-64">{JSON.stringify(selectedRun?.output||{}, null, 2)}</pre>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}


