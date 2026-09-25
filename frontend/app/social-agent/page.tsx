"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Activity, BarChart3, CalendarClock, CheckCircle2, ChevronDown, ChevronUp,
  Facebook, Image as ImageIcon, Instagram, Loader2, LogIn, PackageSearch,
  Play, Power, RefreshCcw, Save, Send, Settings2, ShieldCheck, Sparkles, XCircle,
} from 'lucide-react'
import ShopifyStoreSelect from '@/components/ShopifyStoreSelect'
import AgentSettings from './AgentSettings'
import ManualReview from './ManualReview'
import {
  prepareNextSocialPost, publishDueSocialPosts, publishSocialPost,
  queueSocialAgentBatch, refreshSocialAnalytics, saveSocialAgentConfig,
  socialAgentCatalog, socialAgentConnection, socialAgentDashboard, startSocialAgentNow,
  systemHealthLogin, systemHealthMe,
  type SocialAgentConfig, type SocialAgentDashboard, type SocialAgentPost,
} from '@/lib/api'

const number = new Intl.NumberFormat('en-US')

function Card({ children, className='' }:{ children: React.ReactNode, className?: string }){
  return <section className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</section>
}

function StatusPill({ status }:{ status: string }){
  const tone = status==='published' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : ['approved','preview_ready'].includes(status) ? 'bg-blue-50 text-blue-700 border-blue-200'
    : ['rejected','failed','publish_failed'].includes(status) ? 'bg-rose-50 text-rose-700 border-rose-200'
    : ['generating','publishing','preparing','running'].includes(status) ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-slate-50 text-slate-600 border-slate-200'
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${tone}`}>{status.replaceAll('_',' ')}</span>
}

function Metric({ label, value, note }:{ label:string, value:string|number, note:string }){
  return <Card className="p-5">
    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
    <div className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{value}</div>
    <div className="mt-1 text-xs text-slate-500">{note}</div>
  </Card>
}

function AdminLogin({ onReady }:{ onReady:()=>void }){
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  async function submit(e:React.FormEvent){
    e.preventDefault(); setBusy(true); setError('')
    try{
      const result=await systemHealthLogin({email,password,remember:true})
      if(result.error || !result.data?.token) throw new Error(result.error||'Login failed')
      localStorage.setItem('ptos_system_admin_token',result.data.token)
      onReady()
    }catch(err:any){ setError(String(err?.response?.data?.detail||err?.message||err)) }
    finally{ setBusy(false) }
  }
  return <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
    <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-white/10 bg-white p-7 shadow-2xl">
      <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-fuchsia-600 text-white"><ShieldCheck/></div>
      <h1 className="text-2xl font-bold text-slate-950">Social Agent Control Room</h1>
      <p className="mt-2 text-sm text-slate-500">Use the same administrator account as System Health.</p>
      <label className="mt-6 block text-xs font-semibold uppercase tracking-wide text-slate-500">Email</label>
      <input value={email} onChange={e=>setEmail(e.target.value)} type="email" required className="mt-2 w-full rounded-xl border px-3 py-2.5 outline-none focus:ring-2 focus:ring-fuchsia-500"/>
      <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-slate-500">Password</label>
      <input value={password} onChange={e=>setPassword(e.target.value)} type="password" required className="mt-2 w-full rounded-xl border px-3 py-2.5 outline-none focus:ring-2 focus:ring-fuchsia-500"/>
      {error && <div className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      <button disabled={busy} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
        {busy?<Loader2 className="h-4 w-4 animate-spin"/>:<LogIn className="h-4 w-4"/>} Sign in
      </button>
    </form>
  </div>
}

function PostCard({ post, onPublish, onReview, busy }:{ post:SocialAgentPost, onPublish:(post:SocialAgentPost)=>void, onReview:(post:SocialAgentPost)=>void, busy:boolean }){
  const [open,setOpen]=useState(false)
  const selected=(post.assets||[]).find(asset=>asset.selected)
  const image=selected?.shopify?.url || post.product?.images?.[0]?.url
  const metrics=post.metrics?.totals||{}
  const reviewScore=post.review?.score
  const breakdown=post.review?.score_breakdown||{}
  const breakdownLabels:Record<string,string>={product_fidelity:'Product fidelity',realism:'Realism',geometry:'Geometry',text_logo_integrity:'Text & logo integrity',copy_factuality:'Copy factuality'}
  const findings=[
    ['Product differences',post.review?.source_product_differences],
    ['Visual errors',post.review?.visual_errors],
    ['Factual risks',post.review?.factual_risks],
    ['Arabic errors',post.review?.arabic_errors],
    ['Image text errors',post.review?.image_text_errors],
  ] as [string,string[]|undefined][]
  return <Card className="overflow-hidden">
    <div className="grid gap-0 md:grid-cols-[220px_1fr]">
      <div className="relative min-h-56 bg-slate-100">
        {image?<img src={image} alt={post.strategy?.alt_text_ar||post.product?.title||'Social creative'} className="absolute inset-0 h-full w-full object-cover"/>:<div className="absolute inset-0 flex items-center justify-center text-slate-400"><ImageIcon/></div>}
        <div className="absolute left-3 top-3"><StatusPill status={post.status}/></div>{!selected?.shopify?.url&&image&&<div className="absolute inset-x-0 bottom-0 bg-slate-950/80 px-3 py-2 text-center text-xs text-white">Shopify reference · {post.assets?.some(asset=>asset.draft_available)?'open manual review to see the draft':'generated draft not stored'}</div>}
      </div>
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-fuchsia-600">{post.slot} · post {post.position+1}</div>
            <h3 className="mt-1 text-lg font-bold text-slate-900">{post.product?.title||'Untitled product'}</h3>
            <p className="mt-1 text-xs text-slate-500">{new Date(post.scheduled_for).toLocaleString()} · Inventory {number.format(post.product?.inventory||0)}</p>
          </div>
          <div className="flex items-center gap-2">
            {post.platforms?.facebook?.id&&<Facebook className="h-4 w-4 text-blue-600"/>}
            {post.platforms?.instagram?.id&&<Instagram className="h-4 w-4 text-fuchsia-600"/>}
            {reviewScore!=null&&<button type="button" onClick={()=>setOpen(!open)} aria-expanded={open} title="Show reviewer scoring reasoning" className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-offset-2 hover:ring-2 ${post.review?.decision==='approve'?'bg-emerald-50 text-emerald-700 ring-emerald-300':'bg-rose-50 text-rose-700 ring-rose-300'}`}>{post.review?.decision==='reject'?'Review blocked':`Review ${reviewScore}/100`}</button>}
          </div>
        </div>
        {post.status==='partial'&&<p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Creative approved; publishing is incomplete. {Object.entries(post.error?.platform_errors||{}).map(([platform,error])=>`${platform}: ${error}`).join(' ')}</p>}{post.strategy?.caption_ar&&<div dir="rtl" lang="ar" className="mt-4 whitespace-pre-line rounded-xl border border-slate-100 bg-slate-50 p-4 text-right text-sm leading-7 text-slate-800">{post.strategy.caption_ar}</div>}
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-slate-50 p-2"><div className="text-lg font-bold">{number.format(metrics.reach||0)}</div><div className="text-[10px] uppercase text-slate-400">Reach</div></div>
          <div className="rounded-xl bg-slate-50 p-2"><div className="text-lg font-bold">{number.format(metrics.interactions||0)}</div><div className="text-[10px] uppercase text-slate-400">Interactions</div></div>
          <div className="rounded-xl bg-slate-50 p-2"><div className="text-lg font-bold">{Number(metrics.engagement_rate||0).toFixed(1)}%</div><div className="text-[10px] uppercase text-slate-400">Engagement</div></div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {['approved','preview_ready','partial','publish_failed'].includes(post.status)&&<button disabled={busy} onClick={()=>onPublish(post)} className="inline-flex items-center gap-2 rounded-xl bg-fuchsia-600 px-3 py-2 text-xs font-semibold text-white hover:bg-fuchsia-700 disabled:opacity-50"><Send className="h-3.5 w-3.5"/> {['partial','publish_failed'].includes(post.status)?'Retry failed platforms':'Publish now'}</button>}
          {['rejected','needs_review','failed'].includes(post.status)&&<button disabled={busy} onClick={()=>onReview(post)} className="rounded-xl bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Review and publish manually</button>}
          <button onClick={()=>setOpen(!open)} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">{open?<ChevronUp className="h-3.5 w-3.5"/>:<ChevronDown className="h-3.5 w-3.5"/>} Review details</button>
        </div>
        {post.review?.manual_approval&&<p className="mt-3 text-xs text-blue-800">Manually approved by {post.review.manual_approval.by} · {new Date(post.review.manual_approval.at).toLocaleString()}. Original AI review retained.</p>}
        {post.error?.auto_retry_paused&&<p className="mt-3 text-sm text-amber-800">Automatic retries are paused until the publishing permission is fixed. Use Retry failed platforms after reconnecting.</p>}
        {post.status==='publish_failed'&&<p className="mt-3 text-sm text-rose-800">{Object.entries(post.error?.platform_errors||{}).map(([platform,error])=>`${platform}: ${error}`).join(' ')||post.error?.message}</p>}
      </div>
    </div>
    {open&&<div className="border-t bg-slate-50 p-5">
        {post.strategy?.image_copy&&<div className="mb-4 rounded-xl border bg-white p-4"><h4 className="text-sm font-bold">Approved image overlays</h4><div className="mt-3 flex flex-wrap gap-3" dir="rtl" lang="ar">{Object.entries(post.strategy.image_copy).filter(([,value])=>!!value).map(([key,value])=><span key={key} className="rounded-lg bg-fuchsia-50 px-3 py-2 text-sm text-fuchsia-950">{String(value)}</span>)}</div></div>}
        {post.strategy?.product_analysis&&<div className="mb-4 rounded-xl border bg-white p-4"><h4 className="text-sm font-bold">Product analysis</h4><dl className="mt-3 grid gap-3 md:grid-cols-2">{Object.entries(post.strategy.product_analysis).map(([key,value])=><div key={key}><dt className="text-xs font-semibold capitalize text-slate-400">{key.replaceAll('_',' ')}</dt><dd className="mt-1 text-sm text-slate-700">{String(value)}</dd></div>)}</dl></div>}
        {!!post.strategy?.visual_directions?.length&&<div className="mb-4 rounded-xl border bg-white p-4"><h4 className="text-sm font-bold">Image prompts</h4><p className="mt-2 text-sm text-slate-500">{post.strategy.visual_rationale_en}</p>{post.strategy.visual_directions.map((direction:string,index:number)=><p key={index} className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-700"><b>Candidate {index+1}:</b> {direction}</p>)}</div>}
        {!!post.strategy?.generation_stages?.length&&<div className="mb-4 overflow-x-auto rounded-xl border bg-white p-4"><h4 className="text-sm font-bold">Text model usage</h4><table className="mt-3 w-full text-left text-xs"><thead className="text-slate-400"><tr><th className="p-2">Stage</th><th className="p-2">Model</th><th className="p-2">Reasoning</th><th className="p-2">Input tokens</th><th className="p-2">Output tokens</th></tr></thead><tbody>{[...post.strategy.generation_stages, ...(post.review?._generation?[post.review._generation]:[])].map((stage:any,index:number)=><tr key={index} className="border-t"><td className="p-2">{stage.stage?.replaceAll('_',' ')}</td><td className="p-2">{stage.model||'—'}</td><td className="p-2">{stage.reasoning||'—'}</td><td className="p-2">{stage.usage?.input_tokens??'—'}</td><td className="p-2">{stage.usage?.output_tokens??'—'}</td></tr>)}</tbody></table><p className="mt-2 text-xs text-slate-400">Completed stages and selected review only. Image costs and other attempts are additional.</p></div>}
        <div className="grid gap-4 md:grid-cols-2">
          <div><div className="text-xs font-semibold uppercase text-slate-400">Strategy</div><p className="mt-2 text-sm text-slate-700"><b>Angle:</b> {post.strategy?.angle||'—'}</p><p className="mt-1 text-sm text-slate-700"><b>Test:</b> {post.strategy?.test_variable||'—'}</p><p className="mt-1 text-sm text-slate-700"><b>Reason:</b> {post.strategy?.rationale_en||'—'}</p></div>
          <div><div className="text-xs font-semibold uppercase text-slate-400">Reviewer decision</div><p className="mt-2 text-sm font-semibold text-slate-800">{post.review?.summary_en||post.error?.message||'No review detail yet.'}</p><p className="mt-2 text-sm leading-6 text-slate-600">{post.review?.score_reasoning_en||'Detailed score reasoning is available on newly reviewed posts.'}</p></div>
        </div>
        {!!Object.keys(breakdown).length&&<div className="mt-4"><div className="text-xs font-semibold uppercase text-slate-400">Score breakdown</div><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{Object.entries(breakdownLabels).map(([key,label])=><div key={key} className="rounded-xl border bg-white p-3"><div className="text-xs text-slate-500">{label}</div><div className={`mt-1 text-lg font-bold ${Number(breakdown[key]||0)>=90?'text-emerald-700':'text-rose-700'}`}>{Number(breakdown[key]||0)}/100</div></div>)}</div></div>}
        {findings.some(([,items])=>!!items?.length)&&<div className="mt-4 grid gap-3 md:grid-cols-2">{findings.filter(([,items])=>!!items?.length).map(([label,items])=><div key={label} className="rounded-xl border border-rose-200 bg-rose-50 p-3"><div className="text-xs font-semibold uppercase text-rose-700">{label}</div><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-rose-800">{items!.map((item,index)=><li key={`${label}-${index}`}>{item}</li>)}</ul></div>)}</div>}
        {!!post.review?.strengths?.length&&<div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3"><div className="text-xs font-semibold uppercase text-emerald-700">Strengths</div><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-emerald-800">{post.review.strengths.map((item:string,index:number)=><li key={index}>{item}</li>)}</ul></div>}
        {post.review?.repair_instruction&&<div className="mt-4 rounded-xl border bg-white p-3 text-sm text-slate-700"><b>Required repair:</b> {post.review.repair_instruction}</div>}
        {post.review?.decision==='reject'&&<p className="mt-3 text-xs text-slate-500">The AI blocks automatic publication. An administrator can review the actual draft and approve it manually. The legacy score is capped at 59; assess the category scores and findings above.</p>}
        {!!post.review?.attempt_history?.length&&<div className="mt-4"><div className="text-xs font-semibold uppercase text-slate-400">Generation and correction history</div><div className="mt-2 space-y-2">{post.review.attempt_history.map((attempt:any)=><div key={attempt.attempt} className="rounded-xl border bg-white p-3 text-sm"><b>Attempt {attempt.attempt} · {attempt.kind==='targeted_image_repair'?'Targeted image correction':'Generation'}</b><p className="mt-1 text-slate-600">{attempt.error?.message||attempt.candidates?.map((candidate:any)=>`${candidate.decision}: ${candidate.summary_en||''}`).join(' ')}</p></div>)}</div></div>}
        {!!post.review?.candidates?.length&&<div className="mt-4"><div className="text-xs font-semibold uppercase text-slate-400">Candidate reasoning</div><div className="mt-2 space-y-2">{post.review.candidates.map((candidate:any)=><div key={candidate.candidate} className={`rounded-xl border p-3 text-sm ${candidate.candidate===post.review?.selected_candidate?'border-emerald-300 bg-emerald-50':'bg-white'}`}><div className="font-semibold">Candidate {candidate.candidate} · {candidate.score||0}/100 · {candidate.decision}</div><div className="mt-1 text-slate-600">{candidate.score_reasoning_en||candidate.summary_en||'No candidate reasoning recorded.'}</div></div>)}</div></div>}
        {!!post.assets?.length&&<div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{post.assets.map((asset:any)=><div key={asset.candidate} className={`overflow-hidden rounded-xl border-2 bg-white ${asset.selected?'border-emerald-500':'border-transparent'}`}>{asset.shopify?.url?<img src={asset.shopify.url} alt={`Candidate ${asset.candidate}`} className="aspect-[4/5] w-full object-cover"/>:<div className="flex aspect-[4/5] items-center justify-center bg-rose-50 p-4 text-center text-xs text-rose-600">{asset.draft_available?'Open manual review to inspect this draft':'Rejected visual was not stored'}</div>}<div className="p-2 text-xs"><b>Candidate {asset.candidate}</b> · {asset.review?.score||0}/100 {asset.selected&&'· selected'} {asset.copy_repaired&&'· copy repaired'} {asset.image_repaired&&'· image corrected'}</div></div>)}</div>}
    </div>}
  </Card>
}

export default function SocialAgentPage(){
  const [authed,setAuthed]=useState<boolean|null>(null)
  const [store,setStore]=useState('irrakids')
  const [dashboard,setDashboard]=useState<SocialAgentDashboard|null>(null)
  const [config,setConfig]=useState<SocialAgentConfig|null>(null)
  const [catalog,setCatalog]=useState<any>(null)
  const [connection,setConnection]=useState<any>(null)
  const [busy,setBusy]=useState('')
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')
  const [settingsOpen,setSettingsOpen]=useState(true)
  const [tab,setTab]=useState<'dashboard'|'settings'>('dashboard')
  const [manualPost,setManualPost]=useState<string|null>(null)
  const loadSequence=useRef(0)
  const dirty=!!config && !!dashboard && JSON.stringify(config)!==JSON.stringify(dashboard.config)

  useEffect(()=>{
    try{ setStore(localStorage.getItem('ptos_store')||'irrakids') }catch{}
    systemHealthMe().then(result=>setAuthed(!result.error)).catch(()=>setAuthed(false))
  },[])

  const load=useCallback(async (selected=store, includeCatalog=false)=>{
    const sequence=++loadSequence.current
    setError('')
    try{
      const [dash,meta]=await Promise.all([socialAgentDashboard(selected),socialAgentConnection(selected)])
      if(sequence!==loadSequence.current) return
      if(dash.error||!dash.data) throw new Error(dash.error||'Dashboard unavailable')
      setDashboard(dash.data); setConfig(dash.data.config); setConnection(meta)
      if(includeCatalog){ const products=await socialAgentCatalog(selected); if(sequence===loadSequence.current) setCatalog(products) }
    }catch(err:any){
      if(sequence!==loadSequence.current) return
      if(err?.response?.status===401){ setAuthed(false); return }
      setError(String(err?.response?.data?.detail||err?.message||err))
    }
  },[store])

  useEffect(()=>{ if(authed) load(store,true) },[authed,store,load])

  async function action(name:string, fn:()=>Promise<any>, success:string){
    setBusy(name); setError(''); setMessage('')
    try{ const result=await fn(); if(result?.error) throw new Error(result.error); setMessage(success); await load(store,name==='catalog') }
    catch(err:any){ setError(String(err?.response?.data?.detail||err?.message||err)) }
    finally{ setBusy('') }
  }

  async function save(){
    if(!config) return
    const enabling=!!config.live_publish && !dashboard?.config.live_publish
    if(enabling && !window.confirm('Enable LIVE publishing? Approved posts will be posted automatically to Facebook and Instagram at their scheduled times.')) return
    await action('save',()=>saveSocialAgentConfig(store,config,enabling),'Settings saved.')
  }

  async function toggleAgency(){
    if(!config) return
    const next=!config.enabled
    if(next && !window.confirm('Turn the social agency ON? It will resume generation and automatic publishing on the configured schedule.')) return
    await action(
      'agency-toggle',
      ()=>saveSocialAgentConfig(store,{enabled:next}),
      `Social agency turned ${next?'ON':'OFF'}.`,
    )
  }

  const todayPosts=useMemo(()=>dashboard?.posts?.filter(post=>new Date(post.scheduled_for).toLocaleDateString()===new Date().toLocaleDateString())||[],[dashboard])
  if(authed===null) return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white"><Loader2 className="animate-spin"/></div>
  if(!authed) return <AdminLogin onReady={()=>setAuthed(true)}/>

  return <div className="min-h-screen bg-slate-50 text-slate-800">
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-7">
        <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-fuchsia-600 text-white"><Sparkles className="h-5 w-5"/></div><div><h1 className="font-bold text-slate-950">Organic Social Agent</h1><p className="text-xs text-slate-500">Shopify → reviewer → Facebook + Instagram</p></div></div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" role="switch" aria-checked={!!config?.enabled} onClick={toggleAgency} disabled={!config||!!busy} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition disabled:opacity-50 ${config?.enabled?'border-emerald-300 bg-emerald-50 text-emerald-800':'border-slate-300 bg-slate-100 text-slate-600'}`}><Power className="h-4 w-4"/><span>Agency {config?.enabled?'ON':'OFF'}</span><span className={`relative h-5 w-9 rounded-full transition ${config?.enabled?'bg-emerald-500':'bg-slate-300'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${config?.enabled?'left-[18px]':'left-0.5'}`}/></span></button>
          <ShopifyStoreSelect disabled={!!busy} value={store} onChange={value=>{if(dirty&&!window.confirm('Discard unsaved settings before changing stores?')) return;setConfig(null);setDashboard(null);setStore(value);try{localStorage.setItem('ptos_store',value)}catch{}}} className="rounded-xl border bg-white px-3 py-2 text-sm font-medium"/>
          <button onClick={()=>{if(!dirty||window.confirm('Discard unsaved settings and refresh?')) load(store,true)}} disabled={!!busy} className="rounded-xl border bg-white p-2.5 hover:bg-slate-50"><RefreshCcw className={`h-4 w-4 ${busy?'animate-spin':''}`}/></button>
          <Link href="/" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Home</Link>
        </div>
      </div>
    </header>

    <main className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 md:px-7">
      {message&&<div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}
      {error&&<div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}
      <nav aria-label="Social agent views" className="flex gap-2 border-b border-slate-200 pb-3">
        {(['dashboard','settings'] as const).map(value=><button key={value} type="button" aria-current={tab===value?'page':undefined} onClick={()=>setTab(value)} className={`rounded-xl px-5 py-2.5 text-sm font-semibold ${tab===value?'bg-slate-950 text-white':'bg-white text-slate-600 hover:bg-slate-100'}`}>{value==='dashboard'?'Dashboard':'Settings'}</button>)}
      </nav>

      {tab==='dashboard'&&<>
      <section className="overflow-hidden rounded-3xl bg-slate-950 p-6 text-white md:p-8">
        <div className="grid gap-7 lg:grid-cols-[1.25fr_.75fr] lg:items-end">
          <div><div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${config?.enabled?'border-emerald-400/30 bg-emerald-400/10 text-emerald-200':'border-white/15 bg-white/5 text-slate-300'}`}><Power className="h-3.5 w-3.5"/>{config?.enabled?'Agency is ON':'Agency is OFF — automation paused'}</div><h2 className="mt-5 max-w-3xl text-3xl font-bold tracking-tight md:text-5xl">A governed creative team that learns from every post.</h2><p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">Continuous Shopify-backed posting from {config?.posting_window_start||'12:00'} to midnight: one reviewed product every {config?.post_interval_minutes||30} minutes, refreshed in five-product rolling batches. {dashboard?.image_generator?.label||'The selected AI generator'} builds a complete product-led post with Arabic headlines and overlays, checked against the original reference.</p></div>
          <div className="grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3"><div className="rounded-2xl border border-white/10 bg-white/5 p-4"><div className="text-slate-400">Store channels</div><div className="mt-2 font-semibold">{connection?.data?.meta_ready&&connection?.data?.shopify?.ready?<span className="text-emerald-300">Shopify + Meta connected</span>:<span className="text-amber-300">Needs attention</span>}</div>{connection?.error&&<div className="mt-2 text-xs text-amber-200">{connection.error}</div>}{connection?.data?.shopify&&!connection.data.shopify.ready&&<div className="mt-2 text-xs text-amber-200">{connection.data.shopify.reason}</div>}</div><div className="rounded-2xl border border-white/10 bg-white/5 p-4"><div className="text-slate-400">Image generator</div><div className={`mt-2 font-semibold ${dashboard?.image_generator?.ready?'text-emerald-300':'text-amber-300'}`}>{dashboard?.image_generator?.label||'Checking…'}</div><div className="mt-2 truncate text-xs text-slate-400">{dashboard?.image_generator?.model}</div></div><div className="rounded-2xl border border-white/10 bg-white/5 p-4"><div className="text-slate-400">Rolling scheduler</div><div className="mt-2 font-semibold">{dashboard?.scheduler?.secret_configured?<span className="text-emerald-300">{dashboard?.scheduler?.daily_post_count||0} slots · protected</span>:<span className="text-amber-300">Secret missing</span>}</div><div className="mt-2 text-xs text-slate-400">{dashboard?.scheduler?.daily_batch_count||0} refresh batches/day</div></div></div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Generated" value={dashboard?.stats.generated||0} note="Last 45 days"/>
        <Metric label="Approved" value={dashboard?.stats.review_approved||0} note="Passed independent review"/>
        <Metric label="Published" value={dashboard?.stats.published||0} note="Both platforms completed"/>
        <Metric label="Organic reach" value={number.format(dashboard?.stats.total_reach||0)} note="Measured Meta reach"/>
        <Metric label="Engagement" value={`${Number(dashboard?.stats.engagement_rate||0).toFixed(1)}%`} note={`${number.format(dashboard?.stats.total_interactions||0)} interactions`}/>
      </div>
      </>}

      {tab==='settings'&&<>
      <div className="sticky top-[72px] z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm backdrop-blur">
        <div className="text-sm text-slate-600">{store} · {dirty?'Unsaved changes':'Saved settings'}<span className="ml-2 text-xs text-slate-400">Applies to new generation attempts</span></div>
        <div className="flex gap-2"><button type="button" disabled={!dirty||!!busy} onClick={()=>setConfig(dashboard?.config||null)} className="rounded-xl border px-4 py-2 text-sm disabled:opacity-40">Discard changes</button><button type="button" onClick={save} disabled={!config||!!busy} className="inline-flex items-center gap-2 rounded-xl bg-fuchsia-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy==='save'?<Loader2 className="h-4 w-4 animate-spin"/>:<Save className="h-4 w-4"/>}Save all settings</button></div>
      </div>
      {config&&<AgentSettings config={config} onChange={setConfig} disabled={!!busy}/>}
      <Card>
        <button onClick={()=>setSettingsOpen(!settingsOpen)} className="flex w-full items-center justify-between p-5 text-left"><span className="flex items-center gap-3 font-bold text-slate-950"><Settings2 className="h-5 w-5 text-fuchsia-600"/> Automation and offer guardrails</span>{settingsOpen?<ChevronUp/>:<ChevronDown/>}</button>
        {settingsOpen&&config&&<div className="border-t p-5">
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            <label className={`flex items-center justify-between rounded-xl border p-3 text-sm font-medium ${config.live_publish?'border-rose-300 bg-rose-50':''}`}>Live Meta publishing<input type="checkbox" checked={config.live_publish} onChange={e=>setConfig({...config,live_publish:e.target.checked})} className="h-4 w-4 accent-rose-600"/></label>
            <label className="text-xs font-semibold uppercase text-slate-500">Posting window start<input type="time" value={config.posting_window_start} onChange={e=>setConfig({...config,schedule_mode:'rolling',posting_window_start:e.target.value})} className="mt-2 block w-full rounded-xl border px-3 py-2 text-sm font-normal text-slate-900"/></label>
            <label className="text-xs font-semibold uppercase text-slate-500">Posting window end<input type="time" value={config.posting_window_end} onChange={e=>setConfig({...config,schedule_mode:'rolling',posting_window_end:e.target.value})} className="mt-2 block w-full rounded-xl border px-3 py-2 text-sm font-normal text-slate-900"/></label>
            <label className="text-xs font-semibold uppercase text-slate-500">Products per rolling batch<input type="number" min={1} max={5} value={config.batch_size} onChange={e=>setConfig({...config,batch_size:Number(e.target.value)})} className="mt-2 block w-full rounded-xl border px-3 py-2 text-sm font-normal text-slate-900"/></label>
            <label className="text-xs font-semibold uppercase text-slate-500">Minutes between posts<input type="number" min={2} max={60} value={config.post_interval_minutes} onChange={e=>setConfig({...config,post_interval_minutes:Number(e.target.value)})} className="mt-2 block w-full rounded-xl border px-3 py-2 text-sm font-normal text-slate-900"/></label>
            <label className="text-xs font-semibold uppercase text-slate-500">Minimum inventory<input type="number" min={1} value={config.minimum_inventory} onChange={e=>setConfig({...config,minimum_inventory:Number(e.target.value)})} className="mt-2 block w-full rounded-xl border px-3 py-2 text-sm font-normal text-slate-900"/></label>
            <label className="text-xs font-semibold uppercase text-slate-500">Reviewer threshold<input type="number" min={60} max={100} value={config.minimum_review_score} onChange={e=>setConfig({...config,minimum_review_score:Number(e.target.value)})} className="mt-2 block w-full rounded-xl border px-3 py-2 text-sm font-normal text-slate-900"/></label>
            <label className="text-xs font-semibold uppercase text-slate-500">Attempts after rejection<input type="number" min={1} max={5} value={config.max_review_attempts} onChange={e=>setConfig({...config,max_review_attempts:Number(e.target.value)})} className="mt-2 block w-full rounded-xl border px-3 py-2 text-sm font-normal text-slate-900"/></label>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border p-4"><label className="flex items-center justify-between text-sm font-semibold">Approved quantity offer<input type="checkbox" checked={config.quantity_offer_enabled} onChange={e=>setConfig({...config,quantity_offer_enabled:e.target.checked})} className="h-4 w-4 accent-fuchsia-600"/></label><p className="mt-1 text-xs text-slate-500">The agent may use only this exact Arabic offer. Leave disabled unless checkout honors it.</p><textarea dir="rtl" lang="ar" disabled={!config.quantity_offer_enabled} value={config.approved_quantity_offer_ar} onChange={e=>setConfig({...config,approved_quantity_offer_ar:e.target.value})} placeholder="مثال: اشتر قطعتين واحصل على الثالثة مجاناً" className="mt-3 min-h-24 w-full rounded-xl border p-3 text-right text-sm disabled:bg-slate-100"/></div>
            <div className="rounded-2xl border p-4"><label className="text-sm font-semibold">Brand and compliance notes</label><p className="mt-1 text-xs text-slate-500">Facts and tone the creative team should respect. Internal notes stay in English.</p><textarea value={config.brand_notes} onChange={e=>setConfig({...config,brand_notes:e.target.value})} placeholder="Approved delivery facts, returns policy, brand tone…" className="mt-3 min-h-24 w-full rounded-xl border p-3 text-sm"/></div>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500">The complete active Shopify catalog is refreshed before every five-product rolling batch. The selected generator uses the product reference to create a complete design. Product accuracy, approved Arabic overlays and composition are independently reviewed.</p><button onClick={save} disabled={!!busy} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">{busy==='save'?<Loader2 className="h-4 w-4 animate-spin"/>:<Save className="h-4 w-4"/>} Save settings</button></div>
        </div>}
      </Card>
      </>}

      {tab==='dashboard'&&<>
      <div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 font-bold text-slate-950"><CalendarClock className="h-5 w-5 text-fuchsia-600"/> Today&apos;s production</h2><p className="mt-1 text-xs text-slate-500">{config?.enabled?'Rolling batches refresh Shopify and keep the 30-minute queue supplied.':'Agency is OFF. Queueing, generation, and automatic publishing are paused.'}</p></div><div className="flex flex-wrap gap-2"><button onClick={()=>action('start-now',()=>startSocialAgentNow(store),'Today’s batch is started. Approved posts are due from now at the saved interval; future days keep the saved schedule.')} disabled={!!busy||!config?.enabled||dirty} title={dirty?'Save your schedule changes first':'Start today’s batch now, keeping the recurring schedule'} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">{busy==='start-now'?<Loader2 className="h-3.5 w-3.5 animate-spin"/>:<Play className="h-3.5 w-3.5"/>} Start now</button><button onClick={()=>action('rolling',()=>queueSocialAgentBatch(store,'rolling',true),'Current rolling batch queued; Shopify was refreshed and the first post processed.')} disabled={!!busy||!config?.enabled} className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50">Queue current batch</button><button onClick={()=>action('next',()=>prepareNextSocialPost(store),'Next queued post processed.')} disabled={!!busy||!config?.enabled} className="inline-flex items-center gap-2 rounded-xl bg-fuchsia-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy==='next'?<Loader2 className="h-3.5 w-3.5 animate-spin"/>:<Play className="h-3.5 w-3.5"/>} Create next</button></div></div>
          <div className="mt-5 space-y-2">{todayPosts.length?todayPosts.slice().reverse().map(post=><div key={post.id} className="flex items-center justify-between gap-3 rounded-xl border p-3"><div className="min-w-0"><div className="truncate text-sm font-semibold">{post.product?.title}</div><div className="text-xs text-slate-500">{new Date(post.scheduled_for).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} · {post.review?.decision==='reject'?'review blocked':`reviewer ${post.review?.score||'—'}`}</div></div><StatusPill status={post.status}/></div>):<div className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-400">No posts queued for today.</div>}</div>
          <div className="mt-4 flex gap-2"><button onClick={()=>action('due',()=>publishDueSocialPosts(store),'Due approved posts processed.')} disabled={!!busy||!config?.enabled} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50"><Send className="h-3.5 w-3.5"/> Publish due</button><button onClick={()=>action('analytics',()=>refreshSocialAnalytics(store),'Analytics and learning memory refreshed.')} disabled={!!busy} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-slate-50"><BarChart3 className="h-3.5 w-3.5"/> Refresh analytics</button></div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between"><div><h2 className="flex items-center gap-2 font-bold text-slate-950"><PackageSearch className="h-5 w-5 text-fuchsia-600"/> Product ranking</h2><p className="mt-1 text-xs text-slate-500">All {number.format(catalog?.data?.active_count||0)} active products scanned; current-season products are ordered by highest inventory first, with recent products rotated back.</p></div><button onClick={()=>action('catalog',()=>socialAgentCatalog(store).then(result=>{setCatalog(result);return result}),'Catalog ranking refreshed.')} className="rounded-xl border p-2"><RefreshCcw className="h-4 w-4"/></button></div>
          {catalog?.error&&<div className="mt-4 text-sm text-rose-600">{catalog.error}</div>}
          <div className="mt-4 space-y-3">{(catalog?.data?.products||[]).slice(0,6).map((product:any,index:number)=><div key={product.id} className="grid grid-cols-[34px_44px_1fr_auto] items-center gap-3"><div className="text-center text-xs font-bold text-slate-400">#{index+1}</div><img src={product.images?.[0]?.url} alt={product.title} className="h-11 w-11 rounded-lg bg-slate-100 object-cover"/><div className="min-w-0"><div className="truncate text-sm font-semibold">{product.title}</div><div className="text-xs text-slate-500">Inventory {number.format(product.inventory)} · {catalog?.data?.season}</div></div><div className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">{product.ranking?.score||0}</div></div>)}</div>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="flex items-center gap-2 font-bold text-slate-950"><Activity className="h-5 w-5 text-fuchsia-600"/> Closed-loop learning memory</h2>
        <p className="mt-2 text-sm text-slate-600">{dashboard?.learning?.summary}</p>
        <div className="mt-5 grid gap-4 md:grid-cols-3"><div><div className="text-xs font-semibold uppercase text-emerald-600">Winning patterns</div><ul className="mt-2 space-y-2 text-sm text-slate-600">{(dashboard?.learning?.winning_patterns||[]).map((x:string)=><li key={x} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500"/>{x}</li>)}</ul></div><div><div className="text-xs font-semibold uppercase text-rose-600">Weak patterns</div><ul className="mt-2 space-y-2 text-sm text-slate-600">{(dashboard?.learning?.losing_patterns||[]).map((x:string)=><li key={x} className="flex gap-2"><XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500"/>{x}</li>)}</ul></div><div><div className="text-xs font-semibold uppercase text-blue-600">Next experiments</div><ul className="mt-2 space-y-2 text-sm text-slate-600">{(dashboard?.learning?.experiments||[]).map((x:string)=><li key={x} className="flex gap-2"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-blue-500"/>{x}</li>)}</ul></div></div>
      </Card>

      {(!!connection?.data?.publishing_permissions?.missing?.facebook?.length||!!connection?.data?.publishing_blocks?.facebook||dashboard?.posts?.some(post=>String(post.error?.platform_errors?.facebook||'').includes('pages_manage_posts')))&&<Card className="border-amber-300 bg-amber-50 p-5"><h2 className="font-bold text-amber-950">Facebook publishing permission needs attention</h2><p className="mt-2 text-sm text-amber-900">Image approval cannot resolve a Meta permission error. Grant pages_manage_posts and pages_read_engagement, verify that the connected account can create Page content, and update the Page access token. Meta may require App Review / Advanced Access. Once fixed, use Retry failed platforms; existing Instagram posts will be preserved.</p><div className="mt-3 flex gap-4 text-sm font-semibold"><a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer" className="underline">Open Meta app settings</a><a href="https://developers.facebook.com/tools/debug/accesstoken/" target="_blank" rel="noreferrer" className="underline">Check token permissions</a></div></Card>}
      <section className="space-y-4"><div className="flex items-center justify-between"><div><h2 className="text-xl font-bold text-slate-950">Creative queue</h2><p className="text-sm text-slate-500">Review rejected drafts manually or retry incomplete publishing.</p></div><span className="text-xs text-slate-400">{dashboard?.posts?.length||0} recent posts</span></div>{dashboard?.posts?.length?dashboard.posts.map(post=><PostCard key={post.id} post={post} busy={!!busy} onReview={post=>setManualPost(post.id)} onPublish={post=>{const force=!config?.live_publish||!config?.enabled;if(window.confirm('Publish this approved post now to its remaining platforms? Platforms with a saved publication ID will be skipped.')) action(`publish-${post.id}`,()=>publishSocialPost(store,post.id,force),'Publishing attempt finished. Check the post’s platform status below.')}}/>):<Card className="p-12 text-center text-slate-400"><ImageIcon className="mx-auto mb-3"/>No creative history yet.</Card>}</section>
      </>}
    </main>
    {manualPost&&<ManualReview key={`${store}-${manualPost}`} store={store} postId={manualPost} onClose={()=>setManualPost(null)} onChanged={()=>load(store)}/>}
  </div>
}
