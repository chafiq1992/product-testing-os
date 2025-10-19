import dynamic from 'next/dynamic'
import Link from 'next/link'
import { Rocket } from 'lucide-react'

const AdsAgentClient = dynamic(()=>import('./AdsAgentClient'), { ssr: false })

export default function AdsAgentPage(){
  return (
    <div className="min-h-screen w-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-sky-50 via-white to-indigo-50 text-slate-800">
      <header className="h-16 px-5 md:px-8 flex items-center justify-between border-b bg-white/70 backdrop-blur sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <Rocket className="w-6 h-6 text-blue-600" />
          <h1 className="font-semibold text-xl tracking-tight">Ads Agent</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/agents" className="rounded-xl font-semibold inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white">Agents</Link>
          <Link href="/agents/angles" className="rounded-xl font-semibold inline-flex items-center gap-2 px-4 py-2 border border-slate-200 bg-white text-slate-900 hover:bg-slate-50">Angles</Link>
        </div>
      </header>
      <div className="p-6 md:p-8">
        <AdsAgentClient/>
      </div>
    </div>
  )
}


