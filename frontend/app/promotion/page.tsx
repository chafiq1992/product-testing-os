import { Suspense } from 'react'
import { StudioPage } from '../studio/page'
import dynamic from 'next/dynamic'

const AgentPanel = dynamic(()=>import('./AgentPanel'), { ssr: false })

export default function PromotionPage(){
  return (
    <div className="p-4">
      <div className="mb-4">
        <Suspense fallback={<div className="p-4 text-sm text-slate-500">Loading…</div>}>
          <StudioPage forcedMode="promotion"/>
        </Suspense>
      </div>
      <div className="mt-4">
        <AgentPanel/>
      </div>
    </div>
  )
}
