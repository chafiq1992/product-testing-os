"use client"
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Rocket, Gift, Image as ImageIcon, FileText } from 'lucide-react'
import { getFlow, updateDraft, llmGenerateAngles, llmTitleDescription, llmLandingCopy, geminiGeneratePromotionalSet } from '@/lib/api'

function Button({ children, onClick, disabled, variant = 'default', size = 'md' }:{children:React.ReactNode,onClick?:()=>void,disabled?:boolean,variant?:'default'|'outline',size?:'sm'|'md'}){
  const base='rounded-xl font-semibold transition inline-flex items-center justify-center'
  const sz = size==='sm' ? 'text-sm px-3 py-1.5' : 'px-4 py-2'
  const vr = variant==='outline' ? 'border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60' : 'bg-fuchsia-600 hover:bg-fuchsia-700 text-white disabled:opacity-60'
  return <button onClick={onClick} disabled={disabled} className={`${base} ${sz} ${vr}`}>{children}</button>
}
function Card({ children }:{children:React.ReactNode}){ return <div className="bg-white border rounded-2xl shadow-sm">{children}</div> }
function CardHeader({ children, className='' }:{children:React.ReactNode,className?:string}){ return <div className={`px-4 pt-4 ${className}`}>{children}</div> }
function CardTitle({ children, className='' }:{children:React.ReactNode,className?:string}){ return <h3 className={`font-semibold ${className}`}>{children}</h3> }
function CardContent({ children, className='' }:{children:React.ReactNode,className?:string}){ return <div className={`px-4 pb-4 ${className}`}>{children}</div> }
function Input(props: React.InputHTMLAttributes<HTMLInputElement>){ return <input {...props} className={`w-full rounded-xl border px-3 py-2 ${props.className||''}`} /> }
function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>){ return <textarea {...props} className={`w-full rounded-xl border px-3 py-2 ${props.className||''}`} /> }

export default function PromotionPage(){
  const params = useSearchParams()
  const flowId = params.get('id') || params.get('flow') || ''

  const [title,setTitle]=useState('')
  const [audience,setAudience]=useState('Shoppers likely to buy this product')
  const [benefits,setBenefits]=useState('')
  const [pains,setPains]=useState('')
  const [offers,setOffers]=useState('10% OFF, Free shipping, Bundle & Save')
  const [images,setImages]=useState<string[]>([])
  const [sourceImage,setSourceImage]=useState('')

  const [angles,setAngles]=useState<any[]>([])
  const [selectedAngleIdx,setSelectedAngleIdx]=useState(0)
  const [titleDesc,setTitleDesc]=useState<{title?:string, description?:string}>({})
  const [landingCopy,setLandingCopy]=useState<any>(null)
  const [promoImages,setPromoImages]=useState<{prompt:string,image:string}[]>([])

  const [anglesPrompt,setAnglesPrompt]=useState('')
  const [titlePrompt,setTitlePrompt]=useState('')
  const [landingPrompt,setLandingPrompt]=useState('Emphasize the promotion and offer details clearly.')
  const [running,setRunning]=useState(false)

  useEffect(()=>{ (async()=>{
    if(!flowId) return
    try{
      const f = await getFlow(flowId)
      const prod = (f as any)?.product||{}
      if(typeof prod.title==='string') setTitle(prod.title)
      if(typeof prod.audience==='string') setAudience(prod.audience)
      if(Array.isArray(prod.benefits)) setBenefits((prod.benefits||[]).join('\n'))
      if(Array.isArray(prod.pain_points)) setPains((prod.pain_points||[]).join('\n'))
      try{
        const imgs = Array.isArray((f as any)?.settings?.assets_used?.feature_gallery)? (f as any).settings.assets_used.feature_gallery : []
        if(imgs.length>0){ setImages(imgs); if(!sourceImage) setSourceImage(imgs[0]) }
      }catch{}
    }catch{}
  })() },[flowId])

  async function genAngles(){
    try{
      setRunning(true)
      const product = { audience, benefits: benefits.split('\n').filter(Boolean), pain_points: pains.split('\n').filter(Boolean), title: title||undefined }
      const out = await llmGenerateAngles({ product: product as any, num_angles: 4, prompt: anglesPrompt||undefined })
      const arr = Array.isArray((out as any)?.angles)? (out as any).angles : []
      setAngles(arr)
      setSelectedAngleIdx(0)
    }finally{ setRunning(false) }
  }

  async function genTitleDesc(){
    try{
      setRunning(true)
      const product = { audience, benefits: benefits.split('\n').filter(Boolean), pain_points: pains.split('\n').filter(Boolean), title: title||undefined }
      const angle = angles[selectedAngleIdx]||null
      const out = await llmTitleDescription({ product: product as any, angle, prompt: titlePrompt||undefined })
      setTitleDesc(out as any)
    }finally{ setRunning(false) }
  }

  async function genLanding(){
    try{
      setRunning(true)
      const product = { audience, benefits: benefits.split('\n').filter(Boolean), pain_points: pains.split('\n').filter(Boolean), title: (titleDesc.title||title)||undefined }
      const angle = angles[selectedAngleIdx]||null
      const out = await llmLandingCopy({ product: product as any, angle, title: titleDesc.title, description: titleDesc.description, prompt: landingPrompt||undefined })
      setLandingCopy(out as any)
    }finally{ setRunning(false) }
  }

  async function genPromoImages(){
    try{
      if(!sourceImage){ alert('Provide a source image URL'); return }
      setRunning(true)
      const product:any = { audience, benefits: benefits.split('\n').filter(Boolean), pain_points: pains.split('\n').filter(Boolean), title: (titleDesc.title||title)||undefined }
      const out = await geminiGeneratePromotionalSet({ product, angles: angles||[], image_url: sourceImage, count: 4 })
      const items = Array.isArray((out as any)?.items)? (out as any).items : []
      setPromoImages(items)
    }finally{ setRunning(false) }
  }

  // Autosave minimal promotion state
  useEffect(()=>{
    if(!flowId) return
    const t = setInterval(async()=>{
      try{
        const product = { audience, benefits: benefits.split('\n').filter(Boolean), pain_points: pains.split('\n').filter(Boolean), title: title||undefined }
        await updateDraft(flowId, { product: product as any, settings: { flow_type: 'promotion' } })
      }catch{}
    }, 7000)
    return ()=> clearInterval(t)
  },[flowId, audience, benefits, pains, title])

  const angle = angles[selectedAngleIdx]||null
  const headlines = useMemo(()=> Array.isArray(angle?.headlines)? angle.headlines : [], [angle])

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-sky-50 via-white to-indigo-50 text-slate-800">
      <header className="h-16 px-4 md:px-6 flex items-center justify-between border-b bg-white/70 backdrop-blur sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <Rocket className="w-6 h-6 text-fuchsia-600" />
          <h1 className="font-semibold text-lg">Product Testing OS — Promotion Flow</h1>
          <nav className="ml-4 flex items-center gap-1 text-sm">
            <Link href="/studio/" className="px-3 py-1.5 rounded hover:bg-slate-100">Create Product</Link>
            <Link href="/ads/" className="px-3 py-1.5 rounded hover:bg-slate-100">Create Ads</Link>
            <span className="px-3 py-1.5 rounded bg-fuchsia-600 text-white">Create Promotion</span>
          </nav>
        </div>
      </header>

      <div className="grid grid-cols-12 gap-3 p-3">
        <aside className="col-span-12 md:col-span-3 space-y-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Gift className="w-4 h-4"/>Promotion inputs</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-xs text-slate-500 mb-1">Product title</div>
                <Input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Product title"/>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Audience</div>
                <Input value={audience} onChange={e=>setAudience(e.target.value)} placeholder="Shoppers likely to buy this product"/>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Benefits (one per line)</div>
                <Textarea rows={3} value={benefits} onChange={e=>setBenefits(e.target.value)}/>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Pain points (one per line)</div>
                <Textarea rows={3} value={pains} onChange={e=>setPains(e.target.value)}/>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Offers / Promotions</div>
                <Textarea rows={2} value={offers} onChange={e=>setOffers(e.target.value)} placeholder="E.g., -20%, Free shipping, Bundle"/>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Source image (Shopify CDN)</div>
                <Input value={sourceImage} onChange={e=>setSourceImage(e.target.value)} placeholder="https://cdn.shopify.com/...jpg"/>
                {images.length>0 && (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {images.slice(0,6).map((u,i)=> (
                      <button key={i} className={`border rounded overflow-hidden ${u===sourceImage? 'ring-2 ring-fuchsia-500':'ring-1 ring-slate-200'}`} onClick={()=> setSourceImage(u)}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={u} alt={`img-${i}`} className="w-full h-20 object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </aside>

        <main className="col-span-12 md:col-span-9 space-y-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">1) Generate angles <span className="text-xs text-slate-500 ml-2">Prompt</span></CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Textarea rows={3} value={anglesPrompt} onChange={e=>setAnglesPrompt(e.target.value)} placeholder="Optional: customize angles prompt for promotions"/>
              <Button onClick={genAngles} disabled={running}>Generate angles</Button>
              {angles.length>0 && (
                <div className="mt-2">
                  <div className="text-xs text-slate-500 mb-1">Angles</div>
                  <div className="grid grid-cols-2 gap-2">
                    {angles.map((a:any,idx:number)=> (
                      <button key={idx} className={`border rounded p-2 text-left ${idx===selectedAngleIdx? 'ring-2 ring-fuchsia-500':'hover:bg-slate-50'}`} onClick={()=>setSelectedAngleIdx(idx)}>
                        <div className="text-sm font-medium">{a?.name||`Angle ${idx+1}`}</div>
                        <div className="text-xs text-slate-500">{Array.isArray(a?.headlines)? a.headlines[0] : ''}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">2) Title & Description <span className="text-xs text-slate-500 ml-2">Prompt</span></CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Textarea rows={3} value={titlePrompt} onChange={e=>setTitlePrompt(e.target.value)} placeholder="Optional: instruct tone and emphasize offers"/>
              <Button onClick={genTitleDesc} disabled={running || !angles.length}>Generate title & description</Button>
              {(titleDesc?.title||titleDesc?.description) && (
                <div className="mt-2 text-sm">
                  <div className="font-medium">{titleDesc.title}</div>
                  <div className="text-slate-600 whitespace-pre-wrap">{titleDesc.description}</div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">3) Landing copy <span className="text-xs text-slate-500 ml-2">Prompt</span></CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Textarea rows={3} value={landingPrompt} onChange={e=>setLandingPrompt(e.target.value)} />
              <Button onClick={genLanding} disabled={running || !angles.length}>Generate landing copy</Button>
              {landingCopy && (
                <div className="text-sm text-slate-700 mt-2">
                  <div className="font-medium">{landingCopy.headline}</div>
                  <div className="text-slate-600">{landingCopy.subheadline}</div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><ImageIcon className="w-4 h-4"/>4) Promotional images</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Button onClick={genPromoImages} disabled={running || !angles.length}>Generate images with Gemini</Button>
              {promoImages.length>0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
                  {promoImages.map((it,idx)=> (
                    <div key={idx} className="border rounded overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={it.image} alt={`promo-${idx}`} className="w-full h-40 object-cover"/>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </div>
  )
}


