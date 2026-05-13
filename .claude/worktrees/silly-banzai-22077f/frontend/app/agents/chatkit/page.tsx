import dynamic from 'next/dynamic'
import { Suspense } from 'react'

const ChatKitWidget = dynamic(()=>import('../ChatKitWidget'), { ssr: false })

export default function ChatKitTestPage(){
  return (
    <div className="fixed inset-0 z-[9999] bg-white/95 pointer-events-auto text-slate-800">
      <div className="absolute left-1/2 -translate-x-1/2 top-6 w-full max-w-[520px] p-3">
        <h1 className="text-xl font-semibold mb-3 text-slate-800">ChatKit Test</h1>
        <div className="rounded-xl border shadow-sm p-3 bg-white">
          <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading…</div>}>
            <ChatKitWidget/>
          </Suspense>
        </div>
      </div>
    </div>
  )
}


