import { Suspense } from 'react'
import PromotionClient from './PromotionClient'

export default function PromotionPage(){
  return (
    <Suspense fallback={<div className="p-4 text-sm text-slate-500">Loading…</div>}>
      <PromotionClient/>
    </Suspense>
  )
}
