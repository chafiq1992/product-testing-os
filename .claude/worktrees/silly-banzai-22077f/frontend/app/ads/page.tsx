import { Suspense } from 'react'
import AdsClient from './AdsClient'

export default function AdsPage(){
  return (
    <Suspense fallback={<div className="p-4 text-sm text-slate-500">Loading…</div>}>
      <AdsClient/>
    </Suspense>
  )
}

