import dynamic from 'next/dynamic'
import { Suspense } from 'react'

const ChatKitWidget = dynamic(()=>import('../ChatKitWidget'), { ssr: false })

export default function ChatKitTestPage(){
  return (
    <div className="min-h-screen w-full bg-white">
      <div className="mx-auto max-w-4xl p-6">
        <h1 className="text-xl font-semibold mb-4">ChatKit Test</h1>
        <div className="rounded-xl border p-4">
          <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading…</div>}>
            <ChatKitWidget/>
          </Suspense>
        </div>
      </div>
    </div>
  )
}


