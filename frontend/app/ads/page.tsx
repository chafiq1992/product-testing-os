import { Suspense } from 'react'
import AdsRedirect from './AdsRedirect'

export default function AdsPage(){
  return (
    <Suspense fallback={<div className="p-4 text-sm text-slate-500">Loading…</div>}>
      <AdsRedirect/>
    </Suspense>
  )
}

