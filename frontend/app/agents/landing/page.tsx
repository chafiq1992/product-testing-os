import dynamic from 'next/dynamic'
import { Suspense } from 'react'

const LandingBuilderClient = dynamic(()=>import('./LandingBuilderClient'), { ssr: false })

export default function LandingBuilderPage(){
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading…</div>}>
      <LandingBuilderClient/>
    </Suspense>
  )
}


