"use client"
import { useEffect, useState } from "react";
import Link from "next/link";
import { Rocket, ExternalLink } from "lucide-react";
import { agentsList } from "@/lib/api";

function Card({ children }:{children:React.ReactNode}){ return <div className="bg-white border rounded-xl shadow-sm">{children}</div> }
function CardHeader({ children, className='' }:{children:React.ReactNode,className?:string}){ return <div className={`px-4 pt-4 ${className}`}>{children}</div> }
function CardTitle({ children, className='' }:{children:React.ReactNode,className?:string}){ return <h3 className={`font-semibold ${className}`}>{children}</h3> }
function CardContent({ children, className='' }:{children:React.ReactNode,className?:string}){ return <div className={`px-4 pb-4 ${className}`}>{children}</div> }

export default function AgentsDirectory(){
  const [items,setItems]=useState<Array<{id:string,name:string,description?:string}>>([])
  const [loading,setLoading]=useState(true)

  useEffect(()=>{ (async()=>{ try{ const res = await agentsList(50); setItems((res as any)?.data||[]) } finally{ setLoading(false) } })() },[])

  const quickTools = [
    { href: "/agents/angles", title: "Ad Angles Studio", desc: "Generate angles, headlines and ad copy" },
    { href: "/agents/landing", title: "Landing Builder", desc: "Create product landing description HTML" },
    { href: "/agents/offers-voice", title: "Offers + Voiceover", desc: "Offer cards and voiceover preview" },
    { href: "/agents/chatkit", title: "ChatKit Test", desc: "Debug Agent Builder flows" },
  ]

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-sky-50 via-white to-indigo-50 text-slate-800">
      <header className="h-16 px-5 md:px-8 flex items-center justify-between border-b bg-white/70 backdrop-blur sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <Rocket className="w-6 h-6 text-blue-600" />
          <h1 className="font-semibold text-xl tracking-tight">Agents</h1>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link href="/" className="rounded-xl font-semibold inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white">Home</Link>
        </div>
      </header>

      <div className="p-6 md:p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {quickTools.map(q=> (
            <Link key={q.href} href={q.href} className="block">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-base">{q.title}</CardTitle></CardHeader>
                <CardContent className="text-sm text-slate-600">{q.desc}</CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <div className="mt-8 text-sm text-slate-500">All Agents</div>
        {loading && (<div className="text-sm text-slate-500 mt-2">Loading…</div>)}
        {!loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-2">
            {items.map(it=> (
              <Link key={it.id} href={`/agents/view?id=${encodeURIComponent(it.id)}`} className="block">
                <Card>
                  <CardHeader className="pb-1"><CardTitle className="text-base flex items-center justify-between">
                    <span>{it.name||it.id}</span>
                    <span className="text-xs text-blue-600 inline-flex items-center gap-1"><ExternalLink className="w-3.5 h-3.5"/>Open</span>
                  </CardTitle></CardHeader>
                  <CardContent>
                    <div className="text-sm text-slate-600 line-clamp-3">{it.description||'No description'}</div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
