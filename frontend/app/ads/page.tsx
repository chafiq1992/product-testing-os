import { Suspense } from 'react'
import { StudioPage } from '../studio/page'

export default function AdsPage(){
  return (
    <Suspense fallback={<div className="p-4 text-sm text-slate-500">Loading…</div>}>
      <StudioPage forcedMode="promotion" />
    </Suspense>
  )
}

