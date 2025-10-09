"use client"
import { useCallback, useEffect, useMemo, useState } from 'react'
import { agentExecute, translateTexts, agentRunCreate, agentRunUpdate, agentUpdate } from '@/lib/api'

type Message = { role: 'system'|'user'|'assistant'|'tool', content: any }

type Promotion = {
  name?: string
  type?: string
  mechanic?: string
  assets?: {
    headlines?: { en?: string[] }
    primaries?: { en?: { short?: string, medium?: string, long?: string } }
    image_prompts?: string[]
  }
}

export default function PromotionAgentClient({ instructionKey = 'promotion_agent_instruction', initialInstruction, agentId }: { instructionKey?: string, initialInstruction?: string, agentId?: string }){
  const [url, setUrl] = useState<string>("")
  const [model, setModel] = useState<string>("gpt-5")
  const [running, setRunning] = useState<boolean>(false)
  const [error, setError] = useState<string>("")
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [frMap, setFrMap] = useState<Record<string, string>>({})
  const [arMap, setArMap] = useState<Record<string, string>>({})
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
    setRunning(true); setError(""); setPromotions([]); setFrMap({}); setArMap({})
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
      setPromotions(finalPromos)

      // Collect all strings for translation
      const enStrings: string[] = []
      finalPromos.forEach(p=>{
        const hs = p.assets?.headlines?.en || []
        enStrings.push(...hs)
        const pr = p.assets?.primaries?.en || {}
        ;['short','medium','long'].forEach(k=>{ const v = (pr as any)[k]; if(typeof v==='string' && v.trim()) enStrings.push(v) })
      })
      const uniq = Array.from(new Set(enStrings.filter(s=>s && s.trim())))
      if(uniq.length){
        const [fr, ar] = await Promise.all([
          translateTexts({ texts: uniq, target: 'fr', locale: 'MA', domain: 'ads' }),
          translateTexts({ texts: uniq, target: 'ar', locale: 'MA', domain: 'ads' }),
        ])
        const frs = (fr as any)?.translations || []
        const ars = (ar as any)?.translations || []
        const fMap: Record<string,string> = {}
        const aMap: Record<string,string> = {}
        uniq.forEach((s, i)=>{ fMap[s] = frs[i] || ''; aMap[s] = ars[i] || '' })
        setFrMap(fMap); setArMap(aMap)
      }

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
          const pr = p.assets?.primaries?.en || {}
          const copies = [pr.short||'', pr.medium||'', pr.long||''].filter(Boolean)
          return (
            <div key={idx} className="rounded-xl border border-slate-200 bg-white shadow-sm p-5">
              <div className="text-lg font-semibold mb-1">{p.name || 'Promotion'}</div>
              <div className="text-xs text-slate-500 mb-3">{p.type || ''}{p.mechanic? ` — ${p.mechanic}`:''}</div>
              {hs.length? (
                <div className="mb-4">
                  <div className="text-base font-medium mb-2">Headlines (EN / FR / AR)</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                    <div className="space-y-2">{hs.map((t,i)=>(<div key={i} className="border border-slate-200 rounded-lg px-3 py-2">{t}</div>))}</div>
                    <div className="space-y-2">{hs.map((t,i)=>(<div key={i} className="border border-slate-200 rounded-lg px-3 py-2">{frMap[t]||'…'}</div>))}</div>
                    <div className="space-y-2">{hs.map((t,i)=>(<div key={i} className="border border-slate-200 rounded-lg px-3 py-2">{arMap[t]||'…'}</div>))}</div>
                  </div>
                </div>
              ) : null}
              {copies.length? (
                <div className="mb-2">
                  <div className="text-base font-medium mb-2">Ad Copies (EN / FR / AR)</div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                    <div className="space-y-2">{copies.map((t,i)=>(<div key={i} className="border border-slate-200 rounded-lg px-3 py-2 whitespace-pre-wrap">{t}</div>))}</div>
                    <div className="space-y-2">{copies.map((t,i)=>(<div key={i} className="border border-slate-200 rounded-lg px-3 py-2 whitespace-pre-wrap">{frMap[t]||'…'}</div>))}</div>
                    <div className="space-y-2">{copies.map((t,i)=>(<div key={i} className="border border-slate-200 rounded-lg px-3 py-2 whitespace-pre-wrap">{arMap[t]||'…'}</div>))}</div>
                  </div>
                </div>
              ) : null}
              <div className="mt-3 text-sm">
                <div className="text-slate-600 mb-1">Image Prompt</div>
                <div className="border border-slate-200 rounded-lg px-3 py-2">{p.assets?.image_prompts?.[0]||''}</div>
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


