"use client"
import { useEffect, useState } from 'react'
import { Rocket, Plus, ExternalLink } from 'lucide-react'
import { listFlows, saveDraft, deleteFlow } from '@/lib/api'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

function Card({ children }:{children:React.ReactNode}){ return <div className="bg-white border rounded-none shadow-sm">{children}</div> }
function CardHeader({ children, className='' }:{children:React.ReactNode,className?:string}){ return <div className={`px-4 pt-4 ${className}`}>{children}</div> }
function CardTitle({ children, className='' }:{children:React.ReactNode,className?:string}){ return <h3 className={`font-semibold ${className}`}>{children}</h3> }
function CardContent({ children, className='' }:{children:React.ReactNode,className?:string}){ return <div className={`px-4 pb-4 ${className}`}>{children}</div> }

export default function HomePage(){
  const [items,setItems]=useState<Array<any>>([])
  const [loading,setLoading]=useState(true)
  const [showNew,setShowNew]=useState(false)
  const [creating,setCreating]=useState(false)
  const router = useRouter()
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || ''
  function toDisplayUrl(u: string){
    try{
      if(!u) return u
      if(u.startsWith('/')) return u
      if(!/^https?:\/\//i.test(u)) return u
      const host = new URL(u).host
      let ownHost = ''
      try{ ownHost = apiBase? new URL(apiBase).host : (typeof window!=='undefined'? window.location.host : '') }catch{}
      const allowed = ['cdn.shopify.com','images.openai.com','oaidalleapiprodscus.blob.core.windows.net']
      const ok = allowed.some(d=> host===d || host.endsWith('.'+d)) || (!!ownHost && host===ownHost)
      return ok? u : `${apiBase}/proxy/image?url=${encodeURIComponent(u)}`
    }catch{ return u }
  }
  useEffect(()=>{ (async()=>{ try{ const res=await listFlows(); setItems((res as any)?.data||[]) } finally{ setLoading(false) } })() },[])
  const studioBase = process.env.NEXT_PUBLIC_STUDIO_URL || ''
  async function startFlow(kind:'product'|'ads'|'promotion'){
    try{
      setCreating(true)
      const res = await saveDraft({
        product: { audience:'', benefits:[], pain_points:[] },
        settings: { flow_type: kind },
      })
      const id = (res as any)?.id
      if(!id){ setCreating(false); setShowNew(false); return }
      if(kind==='ads') router.push(`/ads/?id=${id}`)
      else if(kind==='promotion') router.push(`/promotion/?id=${id}`)
      else router.push(`/studio/?id=${id}`)
    }catch{
    }finally{ setCreating(false); setShowNew(false) }
  }
  return (
    <div className="min-h-screen w-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-sky-50 via-white to-indigo-50 text-slate-800">
      <header className="h-16 px-4 md:px-6 flex items-center justify-between border-b bg-white/70 backdrop-blur sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <Rocket className="w-6 h-6 text-blue-600" />
          <h1 className="font-semibold text-lg">Product Testing OS — Flows</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/" className="rounded-xl font-semibold inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white">Home</Link>
          <button onClick={()=>setShowNew(true)} className="rounded-xl font-semibold inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white">
            <Plus className="w-4 h-4"/> New flow
          </button>
        </div>
      </header>
      <div className="p-4 md:p-6">
        {loading && (<div className="text-sm text-slate-500">Loading…</div>)}
        {!loading && items.length===0 && (
          <div className="text-sm text-slate-500">No flows yet. Click <span className="font-medium">New flow</span> to start.</div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map(it=> {
            const badge = (it as any).flow_type||'product'
            const href = badge==='ads'? `/ads/?id=${it.id}` : badge==='promotion'? `/promotion/?id=${it.id}` : (studioBase? `${studioBase}?id=${it.id}` : `/studio/?id=${it.id}`)
            const badgeColor = badge==='ads'? 'bg-emerald-100 text-emerald-700' : badge==='promotion'? 'bg-fuchsia-100 text-fuchsia-700' : 'bg-blue-100 text-blue-700'
            const badgeText = badge==='ads'? 'Create Ads' : badge==='promotion'? 'Create Promotion' : 'Create Product'
            async function onDelete(e: React.MouseEvent){
              e.preventDefault(); e.stopPropagation();
              try{
                const ok = window.confirm('Delete this flow permanently? This will remove its local uploads.');
                if(!ok) return;
                const res = await deleteFlow(it.id)
                if((res as any)?.error){ alert(String((res as any).error)); return }
                setItems(arr=> arr.filter(x=> x.id!==it.id))
              }catch(err:any){ alert('Delete failed: '+ String(err?.message||err)) }
            }
            return (
            <Link href={href} key={it.id} className="block">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between">
                    <span className="inline-flex items-center gap-2">
                      <span>{(it as any)?.title || 'Untitled flow'}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded ${badgeColor}`}>{badgeText}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <button title="Delete" onClick={onDelete} className="p-1 rounded hover:bg-slate-50 text-slate-500">×</button>
                      <span className="text-xs text-slate-500">{new Date(it.created_at||Date.now()).toLocaleDateString()}</span>
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="w-full bg-slate-100 rounded-none overflow-hidden border h-28 md:h-32">
                    {(it as any).card_image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={toDisplayUrl((it as any).card_image)} alt="cover" className="w-full h-full object-cover" loading="lazy"/>
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
          )})}
        </div>
      </div>
      {showNew && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl border shadow-xl w-[92vw] max-w-md p-4">
            <div className="text-base font-semibold mb-2">Choose a flow</div>
            <div className="grid grid-cols-1 gap-2">
              <button disabled={creating} onClick={()=>startFlow('product')} className="border rounded-lg p-3 text-left hover:bg-slate-50">
                <div className="font-medium">Create Product</div>
                <div className="text-xs text-slate-500">From product inputs to landing page</div>
              </button>
              <button disabled={creating} onClick={()=>startFlow('ads')} className="border rounded-lg p-3 text-left hover:bg-slate-50">
                <div className="font-medium">Create Ads</div>
                <div className="text-xs text-slate-500">Analyze landing URL, angles, copy, images</div>
              </button>
              <button disabled={creating} onClick={()=>startFlow('promotion')} className="border rounded-lg p-3 text-left hover:bg-slate-50">
                <div className="font-medium">Create Promotion</div>
                <div className="text-xs text-slate-500">Specialized for offers and promotional images</div>
              </button>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={()=>setShowNew(false)} className="text-sm px-3 py-1.5 rounded border">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


