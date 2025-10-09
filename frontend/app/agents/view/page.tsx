import dynamic from 'next/dynamic'
import { Suspense } from 'react'

const AgentViewClient = dynamic(()=>import('./AgentViewClient'), { ssr: false })

export default function AgentViewPage(){
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading…</div>}>
      <AgentViewClient/>
    </Suspense>
  )
}


