'use client'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Rocket, Play, FileText, Image as ImageIcon, Megaphone } from 'lucide-react'
import { llmGenerateAngles, geminiGenerateAdImages, metaDraftImageCampaign } from '@/lib/api'

function Button({ children, onClick, disabled, variant = 'default', size = 'md' }:{children:React.ReactNode,onClick?:()=>void,disabled?:boolean,variant?:'default'|'outline',size?:'sm'|'md'}){
  const base='rounded-xl font-semibold transition inline-flex items-center justify-center'
  const sz = size==='sm' ? 'text-sm px-3 py-1.5' : 'px-4 py-2'
  const vr = variant==='outline' ? 'border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60' : 'bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-60'
  return <button onClick={onClick} disabled={disabled} className={`${base} ${sz} ${vr}`}>{children}</button>
}
function Card({ children }:{children:React.ReactNode}){ return <div className="bg-white border rounded-2xl shadow-sm">{children}</div> }
function CardHeader({ children, className='' }:{children:React.ReactNode,className?:string}){ return <div className={`px-4 pt-4 ${className}`}>{children}</div> }
function CardTitle({ children, className='' }:{children:React.ReactNode,className?:string}){ return <h3 className={`font-semibold ${className}`}>{children}</h3> }
function CardContent({ children, className='' }:{children:React.ReactNode,className?:string}){ return <div className={`px-4 pb-4 ${className}`}>{children}</div> }
function Input(props: React.InputHTMLAttributes<HTMLInputElement>){ return <input {...props} className={`w-full rounded-xl border px-3 py-2 ${props.className||''}`} /> }
function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>){ return <textarea {...props} className={`w-full rounded-xl border px-3 py-2 ${props.className||''}`} /> }
function Separator({ className='' }:{className?:string}){ return <div className={`border-t ${className}`} /> }

export default function AdsPage(){
  const params = useSearchParams()
  const prefillLanding = params.get('landing_url')||''
  const prefillTitle = params.get('title')||''
  const prefillImages = useMemo(()=>{
    const raw = params.get('images')||''
    if(!raw) return [] as string[]
    try{ return raw.split(',').map(s=> decodeURIComponent(s)).filter(Boolean) }catch{ return [] }
  },[params])

  const [landingUrl,setLandingUrl]=useState<string>(prefillLanding)
  const [audience,setAudience]=useState<string>('Shoppers likely to buy this product')
  const [title,setTitle]=useState<string>(prefillTitle)
  const [benefits,setBenefits]=useState<string>('')
  const [pains,setPains]=useState<string>('')
  const [offers,setOffers]=useState<string>('')
  const [emotions,setEmotions]=useState<string>('')
  const [sourceImage,setSourceImage]=useState<string>(prefillImages[0]||'')
  const [candidateImages,setCandidateImages]=useState<string[]>(prefillImages)

  const [numAngles,setNumAngles]=useState<number>(3)
  const [angles,setAngles]=useState<any[]>([])
  const [selectedAngleIdx,setSelectedAngleIdx]=useState<number>(0)
  const [adImages,setAdImages]=useState<string[]>([])
  const [selectedHeadline,setSelectedHeadline]=useState<string>('')
  const [selectedPrimary,setSelectedPrimary]=useState<string>('')
  const [selectedImage,setSelectedImage]=useState<string>('')
  const [cta,setCta]=useState<string>('SHOP_NOW')
  const [budget,setBudget]=useState<number>(9)
  const [advantagePlus,setAdvantagePlus]=useState<boolean>(true)
  const [countries,setCountries]=useState<string>('')
  const [savedAudienceId,setSavedAudienceId]=useState<string>('')
  const [running,setRunning]=useState<boolean>(false)

  useEffect(()=>{
    if(!selectedImage && adImages.length>0){ setSelectedImage(adImages[0]) }
  },[adImages,selectedImage])

  async function analyzeLanding(){
    try{
      if(!landingUrl){ alert('Enter landing page URL first.'); return }
      const res = await fetch(landingUrl)
      const html = await res.text()
      const tmp = document.implementation.createHTMLDocument('x')
      tmp.documentElement.innerHTML = html
      const ogTitle = tmp.querySelector('meta[property="og:title"]')?.getAttribute('content')||''
      const metaDesc = tmp.querySelector('meta[name="description"]')?.getAttribute('content')||''
      const h1 = tmp.querySelector('h1')?.textContent||''
      const bullets = Array.from(tmp.querySelectorAll('li')).slice(0,6).map(li=> (li.textContent||'').trim()).filter(Boolean)
      if(!title && (ogTitle||h1)) setTitle((ogTitle||h1).trim())
      if(bullets.length>0) setBenefits(bullets.join('\n'))
      if(metaDesc && !selectedPrimary) setSelectedPrimary(metaDesc)
      const imgs = Array.from(tmp.images||[]).map(im=> im.getAttribute('src')||'').filter(Boolean)
      const absolute = imgs.map(u=> u.startsWith('http')? u : new URL(u, landingUrl).toString())
      const unique = Array.from(new Set(absolute))
      if(unique.length>0){ setCandidateImages(unique.slice(0,10)); if(!sourceImage) setSourceImage(unique[0]) }
      alert('Analyzed landing page to prefill inputs.')
    }catch(e:any){ alert('Analyze failed: '+ String(e?.message||e)) }
  }

  async function runAngles(){
    try{
      setRunning(true)
      const product = {
        audience,
        benefits: benefits.split('\n').map(s=>s.trim()).filter(Boolean),
        pain_points: pains.split('\n').map(s=>s.trim()).filter(Boolean),
        title: title||undefined,
      }
      const prompt = undefined
      const out = await llmGenerateAngles({ product: product as any, num_angles: numAngles, prompt })
      const arr = Array.isArray((out as any)?.angles)? (out as any).angles : []
      setAngles(arr)
      setSelectedAngleIdx(0)
    }catch(e:any){ alert('Angles failed: '+ String(e?.message||e)) }
    finally{ setRunning(false) }
  }

  async function runAdImages(){
    try{
      if(!sourceImage){ alert('Missing source image URL'); return }
      setRunning(true)
      const prompt = 'Create a high‑quality ad image from this product photo. No text, premium look.'
      const resp = await geminiGenerateAdImages({ image_url: sourceImage, prompt, num_images: 4, neutral_background: true })
      const imgs = Array.isArray((resp as any)?.images)? (resp as any).images : []
      setAdImages(imgs)
    }catch(e:any){ alert('Image gen failed: '+ String(e?.message||e)) }
    finally{ setRunning(false) }
  }

  async function approveAndDraft(){
    try{
      if(!landingUrl || !selectedHeadline || !selectedPrimary || !selectedImage){ alert('Select headline, primary text, image, and landing URL.'); return }
      setRunning(true)
      const payload:any = {
        headline: selectedHeadline,
        primary_text: selectedPrimary,
        description: '',
        image_url: selectedImage,
        landing_url: landingUrl,
        call_to_action: cta,
        adset_budget: budget,
        title: selectedHeadline,
      }
      if(!advantagePlus){
        if(savedAudienceId){ payload.saved_audience_id = savedAudienceId }
        else if(countries){ payload.targeting = { geo_locations: { countries: countries.split(',').map(c=>c.trim().toUpperCase()).filter(Boolean) } } }
      }
      const res = await metaDraftImageCampaign(payload)
      if((res as any)?.error){ throw new Error((res as any).error) }
      alert('Meta draft created successfully.')
    }catch(e:any){ alert('Meta draft failed: '+ String(e?.message||e)) }
    finally{ setRunning(false) }
  }

  const angle = angles[selectedAngleIdx]||null
  const headlines: string[] = useMemo(()=> Array.isArray(angle?.headlines)? angle.headlines : [], [angle])
  const primaries: string[] = useMemo(()=> Array.isArray(angle?.primaries)? angle.primaries : Array.isArray(angle?.primaries?.short)? [angle.primaries.short, angle.primaries.medium, angle.primaries.long].filter(Boolean) : [], [angle])

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-sky-50 via-white to-indigo-50 text-slate-800">
      <header className="h-16 px-4 md:px-6 flex items-center justify-between border-b bg-white/70 backdrop-blur sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <Rocket className="w-6 h-6 text-blue-600" />
          <h1 className="font-semibold text-lg">Product Testing OS</h1>
          <nav className="ml-4 flex items-center gap-1 text-sm">
            <Link href="/studio/" className="px-3 py-1.5 rounded hover:bg-slate-100">Create Product</Link>
            <span className="px-3 py-1.5 rounded bg-blue-600 text-white">Create Ads</span>
          </nav>
        </div>
      </header>

      <div className="grid grid-cols-12 gap-3 p-3">
        <aside className="col-span-12 md:col-span-3 space-y-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4"/>Ad inputs</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="text-xs text-slate-500 mb-1">Landing page URL</div>
                <Input value={landingUrl} onChange={e=>setLandingUrl(e.target.value)} placeholder="https://yourstore.com/pages/offer" />
                <div className="mt-2"><Button size="sm" variant="outline" onClick={analyzeLanding}>Analyze</Button></div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Audience</div>
                <Input value={audience} onChange={e=>setAudience(e.target.value)} placeholder="Shoppers likely to buy this product" />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Product title</div>
                <Input value={title} onChange={e=>setTitle(e.target.value)} placeholder="Product title" />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Key benefits (one per line)</div>
                <Textarea rows={3} value={benefits} onChange={e=>setBenefits(e.target.value)} />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Pain points (one per line)</div>
                <Textarea rows={3} value={pains} onChange={e=>setPains(e.target.value)} />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Offers / Promotions</div>
                <Textarea rows={2} value={offers} onChange={e=>setOffers(e.target.value)} placeholder="E.g., -20%, Free shipping, Bundle" />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Emotional triggers</div>
                <Textarea rows={2} value={emotions} onChange={e=>setEmotions(e.target.value)} placeholder="Trust, novelty, safety, time-saving" />
              </div>
              <Separator/>
              <div>
                <div className="text-xs text-slate-500 mb-1">Source image for ad</div>
                <Input value={sourceImage} onChange={e=>setSourceImage(e.target.value)} placeholder="https://cdn.shopify.com/...jpg" />
                {candidateImages.length>0 && (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {candidateImages.slice(0,6).map((u,i)=> (
                      <button key={i} className={`border rounded overflow-hidden ${u===sourceImage? 'ring-2 ring-blue-500':'ring-1 ring-slate-200'}`} onClick={()=> setSourceImage(u)}>
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

        <section className="col-span-12 md:col-span-6 space-y-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4"/>Angles</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <div className="text-xs text-slate-500">How many:</div>
                <input type="number" min={1} max={5} className="w-20 rounded-xl border px-2 py-1 text-sm" value={numAngles} onChange={e=> setNumAngles(Math.max(1, Math.min(5, Number(e.target.value)||3)))} />
                <Button size="sm" variant="outline" onClick={runAngles} disabled={running}>Generate</Button>
              </div>
              {angles.length>0 && (
                <div className="mt-3">
                  <div className="flex gap-2 overflow-x-auto">
                    {angles.map((a,i)=> (
                      <button key={i} className={`text-xs px-2 py-1 rounded border ${i===selectedAngleIdx? 'bg-blue-600 text-white border-blue-600':'hover:bg-slate-50'}`} onClick={()=> setSelectedAngleIdx(i)}>
                        {a?.name||`Angle ${i+1}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><FileText className="w-4 h-4"/>Ad copy & headlines</CardTitle></CardHeader>
            <CardContent>
              {angle? (
                <div className="space-y-3">
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Pick a headline</div>
                    <div className="grid grid-cols-1 gap-1">
                      {headlines.slice(0,8).map((h,i)=> (
                        <label key={i} className="text-sm flex items-center gap-2">
                          <input type="radio" name="headline" checked={selectedHeadline===h} onChange={()=> setSelectedHeadline(h)} />
                          <span>{h}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Pick a primary text</div>
                    <div className="grid grid-cols-1 gap-1">
                      {primaries.slice(0,3).map((p,i)=> (
                        <label key={i} className="text-sm flex items-center gap-2">
                          <input type="radio" name="primary" checked={selectedPrimary===p} onChange={()=> setSelectedPrimary(p)} />
                          <span>{p}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-slate-500">Generate angles to see headline and primary options.</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><ImageIcon className="w-4 h-4"/>Gemini ad images</CardTitle></CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={runAdImages} disabled={running}>Generate</Button>
              </div>
              {adImages.length>0 && (
                <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
                  {adImages.map((u,i)=> (
                    <button key={i} className={`border rounded overflow-hidden ${u===selectedImage? 'ring-2 ring-blue-500':'ring-1 ring-slate-200'}`} onClick={()=> setSelectedImage(u)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u} alt={`ad-${i}`} className="w-full h-28 object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Megaphone className="w-4 h-4"/>Finalize & create Meta ad</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div>
                <div className="text-xs text-slate-500 mb-1">CTA</div>
                <select value={cta} onChange={e=>setCta(e.target.value)} className="w-full rounded-xl border px-3 py-2">
                  {['SHOP_NOW','LEARN_MORE','SIGN_UP','SUBSCRIBE','GET_OFFER','BUY_NOW','CONTACT_US'].map(x=> (<option key={x} value={x}>{x.replaceAll('_',' ')}</option>))}
                </select>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Daily budget (USD)</div>
                <Input type="number" min={1} value={String(budget)} onChange={e=> setBudget(e.target.value===''? 9 : Number(e.target.value))} />
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={advantagePlus} onChange={e=> setAdvantagePlus(e.target.checked)} />
                  <span>Advantage+ audience</span>
                </label>
              </div>
              {!advantagePlus && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Saved audience ID</div>
                    <Input value={savedAudienceId} onChange={e=> setSavedAudienceId(e.target.value)} placeholder="opt." />
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Countries (comma-separated)</div>
                    <Input value={countries} onChange={e=> setCountries(e.target.value)} placeholder="US, MA" />
                  </div>
                </div>
              )}
              <div className="flex justify-end"><Button onClick={approveAndDraft} disabled={running}>Approve & Create Draft</Button></div>
            </CardContent>
          </Card>
        </section>

        <aside className="col-span-12 md:col-span-3 space-y-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Checklist</CardTitle></CardHeader>
            <CardContent className="text-sm text-slate-600 space-y-1">
              <div>1) Generate angles</div>
              <div>2) Pick headline & primary text</div>
              <div>3) Generate & select image</div>
              <div>4) Approve & create Meta draft</div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  )
}


