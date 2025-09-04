"use client"
import { useEffect, useState } from 'react'
import { Rocket, Plus, ExternalLink } from 'lucide-react'
import { listTests } from '@/lib/api'
import Link from 'next/link'

function Card({ children }:{children:React.ReactNode}){ return <div className="bg-white border rounded-2xl shadow-sm">{children}</div> }
function CardHeader({ children, className='' }:{children:React.ReactNode,className?:string}){ return <div className={`px-4 pt-4 ${className}`}>{children}</div> }
function CardTitle({ children, className='' }:{children:React.ReactNode,className?:string}){ return <h3 className={`font-semibold ${className}`}>{children}</h3> }
function CardContent({ children, className='' }:{children:React.ReactNode,className?:string}){ return <div className={`px-4 pb-4 ${className}`}>{children}</div> }

export default function HomePage(){
  const [items,setItems]=useState<Array<any>>([])
  const [loading,setLoading]=useState(true)
  useEffect(()=>{ (async()=>{ try{ const res=await listTests(); setItems((res as any)?.data||[]) } finally{ setLoading(false) } })() },[])
  const studioBase = process.env.NEXT_PUBLIC_STUDIO_URL || ''
  return (
    <div className="min-h-screen w-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-sky-50 via-white to-indigo-50 text-slate-800">
      <header className="h-16 px-4 md:px-6 flex items-center justify-between border-b bg-white/70 backdrop-blur sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <Rocket className="w-6 h-6 text-blue-600" />
          <h1 className="font-semibold text-lg">Product Testing OS — Flows</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href={studioBase? studioBase : "/studio/"} className="rounded-xl font-semibold inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white">
            <Plus className="w-4 h-4"/> New flow
          </Link>
        </div>
      </header>
      <div className="p-4 md:p-6">
        {loading && (<div className="text-sm text-slate-500">Loading…</div>)}
        {!loading && items.length===0 && (
          <div className="text-sm text-slate-500">No flows yet. Click <span className="font-medium">New flow</span> to start.</div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map(it=> (
            <Link href={studioBase? `${studioBase}?id=${it.id}` : `/studio/?id=${it.id}`} key={it.id} className="block">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>{it?.payload?.title || 'Untitled flow'}</span>
                    <span className="text-xs text-slate-500">{new Date(it.created_at||Date.now()).toLocaleDateString()}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="aspect-[3/2] md:aspect-[4/3] w-full bg-slate-100 rounded-lg overflow-hidden border h-36 md:h-44">
                    {it.card_image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.card_image} alt="cover" className="w-full h-full object-cover"/>
                    ): (
                      <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">No image</div>
                    )}
                  </div>
                  {it.page_url && (
                    <a href={it.page_url} target="_blank" className="text-sm inline-flex items-center gap-1 text-blue-600 hover:underline">
                      <ExternalLink className="w-3.5 h-3.5"/> {it.page_url}
                    </a>
                  )}
                  {!it.page_url && (
                    <div className="text-sm text-slate-500">No Shopify page yet</div>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}


