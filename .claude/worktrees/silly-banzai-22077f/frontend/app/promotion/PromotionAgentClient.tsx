"use client"
import { useCallback, useEffect, useMemo, useState } from 'react'
import { agentExecute, translateTexts, agentRunCreate, agentRunUpdate, agentUpdate, llmAnalyzeLandingPage, geminiGenerateAdImages } from '@/lib/api'

type Message = { role: 'system'|'user'|'assistant'|'tool', content: any }

type Promotion = {
  name?: string
  type?: string
  mechanic?: string
  assets?: {
    headlines?: { en?: string[], fr?: string[], ar?: string[] }
    primaries?: {
      en?: { short?: string, medium?: string, long?: string },
      fr?: { short?: string, medium?: string, long?: string },
      ar?: { short?: string, medium?: string, long?: string }
    }
    image_prompts?: string[]
  }
  generated_image?: string
}

export default function PromotionAgentClient({ instructionKey = 'promotion_agent_instruction', initialInstruction, agentId }: { instructionKey?: string, initialInstruction?: string, agentId?: string }){
  const [url, setUrl] = useState<string>("")
  const [model, setModel] = useState<string>("gpt-5")
  const [running, setRunning] = useState<boolean>(false)
  const [error, setError] = useState<string>("")
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [landingImage, setLandingImage] = useState<string>("")
  const [activeRunId, setActiveRunId] = useState<string | null>(null)

  const defaultSystem = useMemo(()=>{
    return (
      "You are Promotion Agent: a senior CRO & pricing strategist specialized in multi-offer promotions. " +
      "Your mission: design high-converting promotions (bundles, tiered discounts, BOGO, gifts-with-purchase, threshold offers), " +
      "write headlines and ad copies, and return all outputs as ONE strict JSON object.\n\n" +

      "OPERATING PRINCIPLES\n" +
      "- Always prefer tools for facts (catalog, pricing, inventory, margins, policies). Never invent data.\n" +
      "- Output EXACTLY ONE valid JSON object. No prose, no markdown.\n" +
      "- Promotions must obey constraints: min margin %, exclusions, max discount, stackability rules.\n" +
      "- Use ethical FOMO: real deadlines, limited stock windows, seasonal peaks, genuine scarcity.\n" +
      "- If region == 'MA': include Cash on Delivery, 24–48h city delivery, easy returns, WhatsApp support.\n" +
      "- Match requested language(s): en, ar (Fus'ha), fr, optionally darija (Latin letters).\n" +
      "- Add emotional triggers (relief, pride, smart-saver, gift-giver joy), but keep claims concrete and compliant.\n\n" +

      "DEFAULT TOOL FLOW\n" +
      "1) Fetch catalog/pricing/inventory → product_feed_tool, price_stock_tool.\n" +
      "2) Read guardrails/policies → business_rules_tool (min_margin, max_discount, exclusions, stackability, gwp rules).\n" +
      "3) Generate promotion mechanics candidates (bundles/tiers/BOGO/GWP/thresholds/free shipping).\n" +
      "4) Score each candidate on profit impact, conversion lift, simplicity, inventory burn-down, and urgency potential.\n" +
      "5) Produce creatives: headlines (5–8/offer), primary texts (short/medium/long), and image prompts per offer.\n" +
      "6) Output a test plan with priorities, countdowns, and tracking hooks.\n\n" +

      "PROMOTION MECHANICS (use as appropriate)\n" +
      "- Tiered cart discounts: e.g., 299 MAD → -10%, 499 MAD → -15%, 799 MAD → -20%.\n" +
      "- BOGO/BOGOX: Buy 1 get 1 -50%, Buy 2 get 1 free (cheapest).\n" +
      "- Bundles: curated sets (same category or mixed), auto-applied price; enforce min margin.\n" +
      "- GWP: gift-with-purchase above threshold or with specific SKUs; gift’s cost within margin guardrail.\n" +
      "- Threshold shipping: free shipping at X MAD; combine with minor bonus (gift bag) at higher tier.\n" +
      "- Limited quantity/limited time windows with countdowns and back-in-stock nudges.\n\n" +

      "OUTPUT CONTRACT (SIMPLIFIED FOR EN ONLY)\n" +
      "{\n" +
      "  \"promotions\": [\n" +
      "    { \"name\": str, \"type\": \"tier|bundle|bogo|gwp|threshold|free_shipping\", \"mechanic\": str,\n" +
      "      \"assets\": { \"headlines\": { \"en\": [str...] }, \"primaries\": { \"en\": { \"short\": str, \"medium\": str, \"long\": str } }, \"image_prompts\": [str...] }\n" +
      "    }\n" +
      "  ]\n" +
      "}\n\n" +

      "COPY RULES\n" +
      "- Headlines: 6 per promotion; short, specific, value-forward; no clickbait.\n" +
      "- Primary texts: include the deal math and legit urgency; end with CTA.\n" +
      "- Region == 'MA': weave COD, 24–48h city delivery, easy returns, WhatsApp support.\n"
    )
  },[])

  const [systemInstruction, setSystemInstruction] = useState<string>(initialInstruction ?? defaultSystem)

  useEffect(()=>{
    try{
      const saved = localStorage.getItem(instructionKey)
      if(saved && saved.trim()) setSystemInstruction(saved)
    }catch{}
  },[instructionKey])

  const onRun = useCallback(async ()=>{
    setRunning(true); setError(""); setPromotions([])
    try{
      const inputSnapshot = { url, model, systemInstruction }
      if(agentId && !activeRunId){
        try{ const created = await agentRunCreate(agentId, { title: `Run ${new Date().toLocaleString()}`, status: 'running', input: inputSnapshot }); if((created as any)?.id) setActiveRunId((created as any).id) }catch{}
      } else if(agentId && activeRunId){
        try{ await agentRunUpdate(agentId, activeRunId, { status: 'running', input: inputSnapshot }) }catch{}
      }

      const sys: Message = { role:'system', content: systemInstruction }
      const reqUser: Message = { role:'user', content: [
        url? `LANDING_URL: ${url.trim()}` : '',
        'REGION: MA',
        'LANGUAGE: en only',
        'CURRENCY: MAD',
        'TASK: Generate EXACTLY 3 promotions. For each promotion include exactly 6 English headlines and 3 English primary texts (short/medium/long). Include at least 1 image_prompts entry that fits the offer. Output ONE valid JSON object per the simplified contract.'
      ].filter(Boolean).join('\n') }
      // Analyze landing page first to extract a source image (if URL provided)
      let firstImage: string | '' = ''
      try{
        if(url && url.trim()){
          const analysis = await llmAnalyzeLandingPage({ url: url.trim(), model: model || undefined })
          const imgs = Array.isArray((analysis as any)?.images)? (analysis as any).images : []
          firstImage = (imgs && imgs.length)? imgs[0] : ''
        }
      }catch{}
      setLandingImage(firstImage)

      const res = await agentExecute({ messages: [sys, reqUser], model: model || undefined })
      const text = (res as any)?.text || ''
      let obj: any = {}
      try{ obj = JSON.parse(text) }catch{ obj = {} }
      const promos: Promotion[] = Array.isArray(obj?.promotions)? obj.promotions : []
      // Normalize counts
      for(const p of promos){
        try{
          const hs = (p.assets?.headlines?.en || []).filter((s:string)=>typeof s==='string' && s.trim())
          while(hs.length < 6) hs.push(hs[hs.length-1] || '')
          p.assets = p.assets || {}; p.assets.headlines = p.assets.headlines || {}; p.assets.headlines.en = hs.slice(0,6)
          const enPrim = (p.assets?.primaries?.en) || {}
          p.assets.primaries = p.assets.primaries || { en: {} as any }
          p.assets.primaries.en = {
            short: String(enPrim.short||'').trim() || (hs[0]||''),
            medium: String(enPrim.medium||'').trim() || (hs[1]||''),
            long: String(enPrim.long||'').trim() || (hs[2]||'')
          }
          p.assets.image_prompts = Array.isArray(p.assets.image_prompts)? p.assets.image_prompts : []
          if(p.assets.image_prompts.length===0){
            const nm = p.name || 'Offer'
            p.assets.image_prompts.push(`High-converting ecommerce offer image for ${nm}. Clean studio background, premium lighting, product-first, bold readable banner with offer math.`)
          }
        }catch{}
      }
      const finalPromos = promos.slice(0,3)

      // Collect all English strings and translate
      const enStrings: string[] = []
      finalPromos.forEach(p=>{
        const hs = p.assets?.headlines?.en || []
        enStrings.push(...hs)
        const pr = p.assets?.primaries?.en || {}
        ;['short','medium','long'].forEach(k=>{ const v = (pr as any)[k]; if(typeof v==='string' && v.trim()) enStrings.push(v) })
      })
      const uniq = Array.from(new Set(enStrings.filter(s=>s && s.trim())))
      let fMap: Record<string,string> = {}
      let aMap: Record<string,string> = {}
      if(uniq.length){
        try{
          const [fr, ar] = await Promise.all([
            translateTexts({ texts: uniq, target: 'fr', locale: 'MA', domain: 'ads' }),
            translateTexts({ texts: uniq, target: 'ar', locale: 'MA', domain: 'ads' }),
          ])
          const frs = (fr as any)?.translations || []
          const ars = (ar as any)?.translations || []
          uniq.forEach((s, i)=>{ fMap[s] = frs[i] || ''; aMap[s] = ars[i] || '' })
        }catch{}
      }

      // Assign per-promotion FR/AR arrays and auto-generate one image per promo
      for(const p of finalPromos){
        try{
          const hs = p.assets?.headlines?.en || []
          const hsFr = hs.map(h=> fMap[h] || '')
          const hsAr = hs.map(h=> aMap[h] || '')
          p.assets = p.assets || {}
          p.assets.headlines = p.assets.headlines || {}
          p.assets.headlines.fr = hsFr
          p.assets.headlines.ar = hsAr
          const pr = p.assets.primaries?.en || {}
          const enShort = String((pr as any).short||'')
          const enMedium = String((pr as any).medium||'')
          const enLong = String((pr as any).long||'')
          p.assets.primaries = p.assets.primaries || {}
          p.assets.primaries.fr = { short: fMap[enShort] || '', medium: fMap[enMedium] || '', long: fMap[enLong] || '' }
          p.assets.primaries.ar = { short: aMap[enShort] || '', medium: aMap[enMedium] || '', long: aMap[enLong] || '' }
        }catch{}
        try{
          const prompt = (p.assets?.image_prompts||[])[0] || ''
          if(prompt && (firstImage||landingImage)){
            const base = firstImage || landingImage
            const gen = await geminiGenerateAdImages({ image_url: base, prompt, num_images: 1, neutral_background: false })
            const imgs = (gen as any)?.images || []
            p.generated_image = Array.isArray(imgs) && imgs[0]? imgs[0] : ''
          }
        }catch{}
      }

      setPromotions(finalPromos)

      if(agentId && (activeRunId || true)){
        try{
          const rid = activeRunId || ''
          if(rid){ await agentRunUpdate(agentId, rid, { status: 'completed', output: { promotions: finalPromos } }) }
        }catch{}
      }
    }catch(e:any){ setError(String(e?.message||e)) }
    finally{ setRunning(false) }
  },[url, model, systemInstruction, agentId, activeRunId])

  return (
    <div className="flex gap-6">
      <div className="w-[360px] shrink-0 space-y-4">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
          <div className="text-base font-semibold mb-3">Promotion Agent</div>
          <div className="flex flex-col gap-3 text-base">
            <input className="border rounded-lg px-3 py-2 bg-white border-slate-200" placeholder="Product or Landing URL" value={url} onChange={e=>setUrl(e.target.value)} />
            <input className="border rounded-lg px-3 py-2 bg-white border-slate-200" placeholder="Model (optional)" value={model} onChange={e=>setModel(e.target.value)} />
            <div className="flex gap-2">
              <button className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg disabled:opacity-50" disabled={running} onClick={onRun}>{running? 'Running…':'Generate Promotions'}</button>
              <button className="px-3 py-2 text-sm border border-slate-200 rounded-lg" onClick={()=>{ try{ localStorage.setItem(instructionKey, systemInstruction||'') }catch{}; if(agentId){ try{ agentUpdate(agentId, { instruction: systemInstruction||'' }) }catch{} } }}>Save Instruction</button>
            </div>
            {error? <div className="text-sm text-red-600 whitespace-pre-wrap">{error}</div> : null}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
          <div className="text-sm font-medium mb-1">System Instruction</div>
          <textarea className="w-full min-h-[220px] border border-slate-200 rounded-lg px-3 py-2" value={systemInstruction} onChange={e=>setSystemInstruction(e.target.value)} />
        </div>
      </div>

      <div className="flex-1 space-y-6">
        {promotions.length? promotions.map((p, idx)=>{
          const hs = p.assets?.headlines?.en || []
          const hsFr = p.assets?.headlines?.fr || new Array(hs.length).fill('')
          const hsAr = p.assets?.headlines?.ar || new Array(hs.length).fill('')
          const pr = p.assets?.primaries?.en || {}
          const copies = [pr.short||'', pr.medium||'', pr.long||''].filter(Boolean)
          const prFr = p.assets?.primaries?.fr || {}
          const copiesFr = [prFr.short||'', prFr.medium||'', prFr.long||''].filter(Boolean)
          const prAr = p.assets?.primaries?.ar || {}
          const copiesAr = [prAr.short||'', prAr.medium||'', prAr.long||''].filter(Boolean)
          return (
            <div key={idx} className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
              <div className="text-lg font-semibold mb-1">{p.name || 'Promotion'}</div>
              <div className="text-xs text-slate-500 mb-3">{p.type || ''}{p.mechanic? ` — ${p.mechanic}`:''}</div>
              {hs.length? (
                <div className="mb-4">
                  <div className="text-base font-medium mb-2">Headlines (EN / FR / AR)</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                    <div className="space-y-2">{hs.map((t,i)=>(
                      <div key={i} className="border border-slate-200 rounded-lg p-2 bg-white">
                        <div className="flex items-center gap-2 mb-2">
                          <button className="text-xs px-2 py-1 border rounded" onClick={()=>{ try{ navigator.clipboard.writeText(hs[i]||'') }catch{} }}>Copy</button>
                        </div>
                        <input className="w-full text-sm outline-none" value={hs[i]} onChange={(e)=>{
                          const v = e.target.value
                          setPromotions(prev=>{
                            const nxt = [...prev]
                            const pp = { ...(nxt[idx]||{}) }
                            pp.assets = pp.assets||{}
                            pp.assets.headlines = pp.assets.headlines||{}
                            const arr = [...(pp.assets.headlines.en||[])]
                            arr[i] = v
                            pp.assets.headlines.en = arr
                            nxt[idx] = pp as any
                            return nxt as Promotion[]
                          })
                        }} />
                      </div>
                    ))}</div>
                    <div className="space-y-2">{hsFr.map((t,i)=>(
                      <div key={i} className="border border-slate-200 rounded-lg p-2 bg-white">
                        <div className="flex items-center gap-2 mb-2">
                          <button className="text-xs px-2 py-1 border rounded" onClick={()=>{ try{ navigator.clipboard.writeText(hsFr[i]||'') }catch{} }}>Copy</button>
                        </div>
                        <input className="w-full text-sm outline-none" value={hsFr[i]} onChange={(e)=>{
                          const v = e.target.value
                          setPromotions(prev=>{
                            const nxt = [...prev]
                            const pp = { ...(nxt[idx]||{}) }
                            pp.assets = pp.assets||{}
                            pp.assets.headlines = pp.assets.headlines||{}
                            const arr = [...(pp.assets.headlines.fr||new Array(hs.length).fill(''))]
                            arr[i] = v
                            pp.assets.headlines.fr = arr
                            nxt[idx] = pp as any
                            return nxt as Promotion[]
                          })
                        }} />
                      </div>
                    ))}</div>
                    <div className="space-y-2">{hsAr.map((t,i)=>(
                      <div key={i} className="border border-slate-200 rounded-lg p-2 bg-white" dir="rtl">
                        <div className="flex items-center gap-2 mb-2 justify-end">
                          <button className="text-xs px-2 py-1 border rounded" onClick={()=>{ try{ navigator.clipboard.writeText(hsAr[i]||'') }catch{} }}>Copy</button>
                        </div>
                        <input className="w-full text-sm outline-none text-right" dir="rtl" value={hsAr[i]} onChange={(e)=>{
                          const v = e.target.value
                          setPromotions(prev=>{
                            const nxt = [...prev]
                            const pp = { ...(nxt[idx]||{}) }
                            pp.assets = pp.assets||{}
                            pp.assets.headlines = pp.assets.headlines||{}
                            const arr = [...(pp.assets.headlines.ar||new Array(hs.length).fill(''))]
                            arr[i] = v
                            pp.assets.headlines.ar = arr
                            nxt[idx] = pp as any
                            return nxt as Promotion[]
                          })
                        }} />
                      </div>
                    ))}</div>
                  </div>
                </div>
              ) : null}
              {copies.length? (
                <div className="mb-2">
                  <div className="text-base font-medium mb-2">Ad Copies (EN / FR / AR)</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                    <div className="space-y-2">{copies.map((t,i)=>(
                      <div key={i} className="border border-slate-200 rounded-lg p-2 bg-white">
                        <div className="flex items-center gap-2 mb-2">
                          <button className="text-xs px-2 py-1 border rounded" onClick={()=>{ try{ navigator.clipboard.writeText(copies[i]||'') }catch{} }}>Copy</button>
                        </div>
                        <textarea className="w-full text-sm outline-none min-h-[60px]" value={copies[i]} onChange={(e)=>{
                          const v = e.target.value
                          setPromotions(prev=>{
                            const nxt = [...prev]
                            const pp = { ...(nxt[idx]||{}) }
                            const en = pp.assets?.primaries?.en || {}
                            const arr = [String((en as any).short||''), String((en as any).medium||''), String((en as any).long||'')]
                            arr[i] = v
                            pp.assets = pp.assets||{}
                            pp.assets.primaries = pp.assets.primaries||{}
                            pp.assets.primaries.en = { short: arr[0]||'', medium: arr[1]||'', long: arr[2]||'' }
                            nxt[idx] = pp as any
                            return nxt as Promotion[]
                          })
                        }} />
                      </div>
                    ))}</div>
                    <div className="space-y-2">{copiesFr.map((t,i)=>(
                      <div key={i} className="border border-slate-200 rounded-lg p-2 bg-white">
                        <div className="flex items-center gap-2 mb-2">
                          <button className="text-xs px-2 py-1 border rounded" onClick={()=>{ try{ navigator.clipboard.writeText(copiesFr[i]||'') }catch{} }}>Copy</button>
                        </div>
                        <textarea className="w-full text-sm outline-none min-h-[60px]" value={copiesFr[i]} onChange={(e)=>{
                          const v = e.target.value
                          setPromotions(prev=>{
                            const nxt = [...prev]
                            const pp = { ...(nxt[idx]||{}) }
                            pp.assets = pp.assets||{}
                            pp.assets.primaries = pp.assets.primaries||{}
                            const fr = pp.assets.primaries.fr || { short:'', medium:'', long:'' }
                            const arr = [String(fr.short||''), String(fr.medium||''), String(fr.long||'')]
                            arr[i] = v
                            pp.assets.primaries.fr = { short: arr[0]||'', medium: arr[1]||'', long: arr[2]||'' }
                            nxt[idx] = pp as any
                            return nxt as Promotion[]
                          })
                        }} />
                      </div>
                    ))}</div>
                    <div className="space-y-2">{copiesAr.map((t,i)=>(
                      <div key={i} className="border border-slate-200 rounded-lg p-2 bg-white" dir="rtl">
                        <div className="flex items-center gap-2 mb-2 justify-end">
                          <button className="text-xs px-2 py-1 border rounded" onClick={()=>{ try{ navigator.clipboard.writeText(copiesAr[i]||'') }catch{} }}>Copy</button>
                        </div>
                        <textarea className="w-full text-sm outline-none min-h-[60px] text-right" dir="rtl" value={copiesAr[i]} onChange={(e)=>{
                          const v = e.target.value
                          setPromotions(prev=>{
                            const nxt = [...prev]
                            const pp = { ...(nxt[idx]||{}) }
                            pp.assets = pp.assets||{}
                            pp.assets.primaries = pp.assets.primaries||{}
                            const ar = pp.assets.primaries.ar || { short:'', medium:'', long:'' }
                            const arr = [String(ar.short||''), String(ar.medium||''), String(ar.long||'')]
                            arr[i] = v
                            pp.assets.primaries.ar = { short: arr[0]||'', medium: arr[1]||'', long: arr[2]||'' }
                            nxt[idx] = pp as any
                            return nxt as Promotion[]
                          })
                        }} />
                      </div>
                    ))}</div>
                  </div>
                </div>
              ) : null}
              <div className="mt-3 text-sm">
                <div className="text-slate-600 mb-1">Image Prompt</div>
                <div className="border border-slate-200 rounded-lg p-2 bg-white">
                  <div className="flex items-center gap-2 mb-2">
                    <button className="text-xs px-2 py-1 border rounded" onClick={()=>{ try{ navigator.clipboard.writeText((p.assets?.image_prompts?.[0]||'')) }catch{} }}>Copy</button>
                  </div>
                  <textarea className="w-full text-sm outline-none min-h-[60px]" value={p.assets?.image_prompts?.[0]||''} onChange={(e)=>{
                    const v = e.target.value
                    setPromotions(prev=>{
                      const nxt = [...prev]
                      const pp = { ...(nxt[idx]||{}) }
                      pp.assets = pp.assets||{}
                      const arr = [...(pp.assets.image_prompts||[''])]
                      arr[0] = v
                      pp.assets.image_prompts = arr
                      nxt[idx] = pp as any
                      return nxt as Promotion[]
                    })
                  }} />
                </div>
                {p.generated_image? (
                  <div className="mt-3">
                    <img src={p.generated_image} alt="promo" className="w-full max-w-md rounded border" />
                  </div>
                ) : null}
              </div>
            </div>
          )
        }) : (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 text-sm text-slate-600">No promotions yet. Enter a URL and click Generate.</div>
        )}
      </div>
    </div>
  )
}


