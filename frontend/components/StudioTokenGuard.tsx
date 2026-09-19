'use client'
import {useEffect, useRef, useState} from 'react'
import {setStudioApprovalHandler, TokenPreview} from '@/lib/studio-api'

const stages = [
  {id:'product_from_image',label:'Analyze photo',warning:6000,output:3000},
  {id:'angles',label:'Angles',warning:6000,output:4000},
  {id:'title_desc',label:'Title & description',warning:4000,output:2000},
  {id:'landing_copy',label:'Landing draft',warning:10000,output:6000},
  {id:'image_brief',label:'Image planning',warning:5000,output:3000},
]
const number = (n:number)=>n.toLocaleString()
type Pending = {preview:TokenPreview, resolve:(accepted:boolean)=>void}
export default function StudioTokenGuard(){
  const [pending,setPending] = useState<Pending|null>(null)
  const [rows,setRows] = useState<Record<string,{input:number,output:number,actual?:number}>>({})
  const queue = useRef<Pending[]>([])
  const active = useRef<Pending|null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  function advance(){
    const next = queue.current.shift() || null
    active.current = next
    setPending(next)
  }
  function settle(accepted:boolean){
    const item = active.current
    if(!item) return
    active.current = null
    item.resolve(accepted && !item.preview.blocked)
    advance()
  }
  useEffect(()=>{
    setStudioApprovalHandler(preview=>new Promise(resolve=>{
      setRows(current=>({...current,[preview.stage]:{input:preview.input_tokens,output:preview.max_output_tokens}}))
      queue.current.push({preview,resolve})
      if(!active.current) advance()
    }))
    const result = (event:Event)=>{
      const {stage,tokens} = (event as CustomEvent).detail
      const actual = tokens?.actual
      if(Array.isArray(actual) && actual.length) setRows(current=>({...current,[stage]:{input:tokens.input_tokens,output:tokens.max_output_tokens,actual:actual.reduce((sum:number,r:any)=>sum+(r.input_tokens||0)+(r.output_tokens||0),0)}}))
    }
    window.addEventListener('studio-token-result',result)
    return ()=>{
      setStudioApprovalHandler(null)
      active.current?.resolve(false)
      queue.current.forEach(item=>item.resolve(false))
      queue.current=[]; active.current=null
      window.removeEventListener('studio-token-result',result)
    }
  },[])
  useEffect(()=>{
    if(pending && dialog.current && !dialog.current.open) dialog.current.showModal()
    if(!pending && dialog.current?.open) dialog.current.close()
  },[pending])
  const preview = pending?.preview
  return <>
    <section className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm" aria-label="Token usage by step">
      <h3 className="font-semibold">Token protection</h3>
      <p className="mt-1 text-xs text-slate-600">Every AI request shows a token preview before it starts. High usage requires explicit approval.</p>
      <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs">
        <thead className="text-slate-500"><tr><th className="py-1 font-medium">Step</th><th className="font-medium text-right">Input</th><th className="font-medium text-right">Output cap</th></tr></thead>
        <tbody>{stages.map(stage=><tr key={stage.id} className="border-t border-slate-100"><th className="py-2 font-normal">{stage.label}</th><td className="text-right">{rows[stage.id]?number(rows[stage.id].input):'—'}</td><td className="text-right">{number(stage.output)}</td></tr>)}</tbody>
      </table></div>
      <p className="mt-2 text-[11px] text-slate-500">Input appears when you request that step. Output includes reasoning and is a maximum, not expected usage. Image rendering is billed separately.</p>
      <details className="mt-2 text-xs text-slate-600"><summary className="cursor-pointer">Warning thresholds & actual usage</summary>
        {stages.map(stage=><p key={stage.id} className="mt-1">{stage.label}: warn above {number(stage.warning)} input tokens{rows[stage.id]?.actual!==undefined?` · Last actual total: ${number(rows[stage.id].actual!)}`:''}</p>)}
        <p className="mt-2 font-medium">Hard stop: 20,000 input tokens or 48 KB of text. Approval cannot override these limits.</p>
        <p className="mt-1">Thresholds are safety settings, not historical averages. Multiple image renders also require high-usage approval.</p>
      </details>
    </section>
    <dialog ref={dialog} aria-labelledby="studio-token-title" onCancel={event=>{event.preventDefault();settle(false)}} className="w-[min(92vw,560px)] rounded-2xl p-0 shadow-2xl backdrop:bg-slate-950/50">
      {preview && <div className="p-6 text-slate-800">
        <p className={`text-xs font-semibold uppercase tracking-wide ${preview.blocked?'text-red-700':preview.requires_confirmation?'text-amber-700':'text-blue-700'}`}>{preview.blocked?'Request blocked':preview.requires_confirmation?'Higher usage · approval required':'Before generation'}</p>
        <h2 id="studio-token-title" className="mt-2 text-xl font-semibold">{preview.blocked?'This request exceeds the hard limit':preview.requires_confirmation?'Approve this higher-usage request?':'Review token usage'}</h2>
        <p className="mt-2 text-sm text-slate-600">{stages.find(s=>s.id===preview.stage)?.label} · {preview.model}</p>
        <dl className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-4 text-sm">
          <dt>Counted input tokens</dt><dd className="text-right font-semibold">{number(preview.input_tokens)}</dd>
          <dt>Maximum output tokens</dt><dd className="text-right font-semibold">{number(preview.max_output_tokens)}</dd>
          <dt>Input warning threshold</dt><dd className="text-right">{number(preview.warning_threshold)}</dd>
          <dt>Input hard limit</dt><dd className="text-right">{number(preview.hard_input_limit)}</dd>
        </dl>
        {preview.image_count>0 && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm">Also generates <strong>{preview.image_count} image{preview.image_count!==1?'s':''}</strong> using {preview.image_model}, {preview.image_quality} quality. Image-rendering tokens and cost are additional and cannot be known exactly in advance.</p>}
        <p className="mt-4 text-sm text-slate-600">{preview.blocked?'Shorten the inputs or select fewer reference images. This request cannot be approved.':preview.note}</p>
        <p className="mt-2 text-xs text-slate-500">No generation has started. Approval applies only to this exact request and expires after five minutes. Closing this dialog cancels it.</p>
        <div className="mt-6 flex justify-end gap-3">
          <button autoFocus onClick={()=>settle(false)} className="rounded-xl border px-4 py-2 font-semibold">{preview.blocked?'Close':'Cancel'}</button>
          {!preview.blocked && <button onClick={()=>settle(true)} className={`rounded-xl px-4 py-2 font-semibold text-white ${preview.requires_confirmation?'bg-amber-700 hover:bg-amber-800':'bg-blue-600 hover:bg-blue-700'}`}>{preview.requires_confirmation?'Approve high usage & generate':'Generate'}</button>}
        </div>
      </div>}
    </dialog>
  </>
}
