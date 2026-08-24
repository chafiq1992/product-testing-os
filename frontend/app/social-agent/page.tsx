"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Activity, BarChart3, CalendarClock, CheckCircle2, ChevronDown, ChevronUp,
  Facebook, Image as ImageIcon, Instagram, Loader2, LogIn, PackageSearch,
  Play, RefreshCcw, Save, Send, Settings2, ShieldCheck, Sparkles, XCircle,
} from 'lucide-react'
import ShopifyStoreSelect from '@/components/ShopifyStoreSelect'
import {
  prepareNextSocialPost, publishDueSocialPosts, publishSocialPost,
  queueSocialAgentBatch, refreshSocialAnalytics, saveSocialAgentConfig,
  socialAgentCatalog, socialAgentConnection, socialAgentDashboard,
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

function PostCard({ post, onPublish, busy }:{ post:SocialAgentPost, onPublish:(post:SocialAgentPost)=>void, busy:boolean }){
  const [open,setOpen]=useState(false)
  const selected=(post.assets||[]).find(asset=>asset.selected)
  const image=selected?.shopify?.url || post.product?.images?.[0]?.url
  const metrics=post.metrics?.totals||{}
  const reviewScore=post.review?.score
  return <Card className="overflow-hidden">
    <div className="grid gap-0 md:grid-cols-[220px_1fr]">
      <div className="relative min-h-56 bg-slate-100">
        {image?<img src={image} alt={post.strategy?.alt_text_ar||post.product?.title||'Social creative'} className="absolute inset-0 h-full w-full object-cover"/>:<div className="absolute inset-0 flex items-center justify-center text-slate-400"><ImageIcon/></div>}
        <div className="absolute left-3 top-3"><StatusPill status={post.status}/></div>
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
            {reviewScore!=null&&<span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Review {reviewScore}/100</span>}
          </div>
        </div>
        {post.strategy?.caption_ar&&<div dir="rtl" lang="ar" className="mt-4 whitespace-pre-line rounded-xl border border-slate-100 bg-slate-50 p-4 text-right text-sm leading-7 text-slate-800">{post.strategy.caption_ar}</div>}
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-slate-50 p-2"><div className="text-lg font-bold">{number.format(metrics.reach||0)}</div><div className="text-[10px] uppercase text-slate-400">Reach</div></div>
          <div className="rounded-xl bg-slate-50 p-2"><div className="text-lg font-bold">{number.format(metrics.interactions||0)}</div><div className="text-[10px] uppercase text-slate-400">Interactions</div></div>
          <div className="rounded-xl bg-slate-50 p-2"><div className="text-lg font-bold">{Number(metrics.engagement_rate||0).toFixed(1)}%</div><div className="text-[10px] uppercase text-slate-400">Engagement</div></div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {['approved','preview_ready','partial','publish_failed'].includes(post.status)&&<button disabled={busy} onClick={()=>onPublish(post)} className="inline-flex items-center gap-2 rounded-xl bg-fuchsia-600 px-3 py-2 text-xs font-semibold text-white hover:bg-fuchsia-700 disabled:opacity-50"><Send className="h-3.5 w-3.5"/> Publish now</button>}
          <button onClick={()=>setOpen(!open)} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">{open?<ChevronUp className="h-3.5 w-3.5"/>:<ChevronDown className="h-3.5 w-3.5"/>} Review details</button>
        </div>
      </div>
    </div>
    {open&&<div className="border-t bg-slate-50 p-5">
      <div className="grid gap-4 md:grid-cols-2">
        <div><div className="text-xs font-semibold uppercase text-slate-400">Strategy</div><p className="mt-2 text-sm text-slate-700"><b>Angle:</b> {post.strategy?.angle||'—'}</p><p className="mt-1 text-sm text-slate-700"><b>Test:</b> {post.strategy?.test_variable||'—'}</p><p className="mt-1 text-sm text-slate-700"><b>Reason:</b> {post.strategy?.rationale_en||'—'}</p></div>
        <div><div className="text-xs font-semibold uppercase text-slate-400">Reviewer</div><p className="mt-2 text-sm text-slate-700">{post.review?.summary_en||post.error?.message||'No review detail yet.'}</p></div>
      </div>
      {!!post.assets?.length&&<div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{post.assets.map((asset:any)=><div key={asset.candidate} className={`overflow-hidden rounded-xl border-2 bg-white ${asset.selected?'border-emerald-500':'border-transparent'}`}>{asset.shopify?.url?<img src={asset.shopify.url} alt={`Candidate ${asset.candidate}`} className="aspect-[4/5] w-full object-cover"/>:<div className="flex aspect-[4/5] items-center justify-center bg-rose-50 p-4 text-center text-xs text-rose-600">Rejected visual was not stored</div>}<div className="p-2 text-xs"><b>Candidate {asset.candidate}</b> · {asset.review?.score||0}/100 {asset.selected&&'· selected'} {asset.copy_repaired&&'· copy repaired'}</div></div>)}</div>}
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

  useEffect(()=>{
    try{ setStore(localStorage.getItem('ptos_store')||'irrakids') }catch{}
    systemHealthMe().then(result=>setAuthed(!result.error)).catch(()=>setAuthed(false))
  },[])

  const load=useCallback(async (selected=store, includeCatalog=false)=>{
    setError('')
    try{
      const [dash,meta]=await Promise.all([socialAgentDashboard(selected),socialAgentConnection(selected)])
      if(dash.error||!dash.data) throw new Error(dash.error||'Dashboard unavailable')
      setDashboard(dash.data); setConfig(dash.data.config); setConnection(meta)
      if(includeCatalog){ const products=await socialAgentCatalog(selected); setCatalog(products) }
    }catch(err:any){
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

  const todayPosts=useMemo(()=>dashboard?.posts?.filter(post=>new Date(post.scheduled_for).toLocaleDateString()===new Date().toLocaleDateString())||[],[dashboard])
  if(authed===null) return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-white"><Loader2 className="animate-spin"/></div>
  if(!authed) return <AdminLogin onReady={()=>setAuthed(true)}/>

  return <div className="min-h-screen bg-slate-50 text-slate-800">
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-7">
        <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-fuchsia-600 text-white"><Sparkles className="h-5 w-5"/></div><div><h1 className="font-bold text-slate-950">Organic Social Agent</h1><p className="text-xs text-slate-500">Shopify → reviewer → Facebook + Instagram</p></div></div>
        <div className="flex flex-wrap items-center gap-2">
          <ShopifyStoreSelect value={store} onChange={value=>{setStore(value);try{localStorage.setItem('ptos_store',value)}catch{}}} className="rounded-xl border bg-white px-3 py-2 text-sm font-medium"/>
          <button onClick={()=>load(store,true)} disabled={!!busy} className="rounded-xl border bg-white p-2.5 hover:bg-slate-50"><RefreshCcw className={`h-4 w-4 ${busy?'animate-spin':''}`}/></button>
          <Link href="/" className="rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">Home</Link>
        </div>
      </div>
    </header>

    <main className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 md:px-7">
      {message&&<div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}
      {error&&<div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}

      <section className="overflow-hidden rounded-3xl bg-slate-950 p-6 text-white md:p-8">
        <div className="grid gap-7 lg:grid-cols-[1.25fr_.75fr] lg:items-end">
          <div><div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-fuchsia-200"><Activity className="h-3.5 w-3.5"/>{config?.enabled?'Automation enabled':'Preview setup'}</div><h2 className="mt-5 max-w-3xl text-3xl font-bold tracking-tight md:text-5xl">A governed creative team that learns from every post.</h2><p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">Five posts from 14:00 and five from 18:00. Every post gets two image candidates, factual offer checks, Fusha review, and platform receipts before metrics feed the next creative cycle.</p></div>
          <div className="grid grid-cols-2 gap-3 text-sm"><div className="rounded-2xl border border-white/10 bg-white/5 p-4"><div className="text-slate-400">Store connection</div><div className="mt-2 font-semibold">{connection?.data?.ready?<span className="text-emerald-300">Shopify + Page + Instagram ready</span>:<span className="text-amber-300">Needs attention</span>}</div>{connection?.error&&<div className="mt-2 text-xs text-amber-200">{connection.error}</div>}{connection?.data?.shopify&&!connection.data.shopify.ready&&<div className="mt-2 text-xs text-amber-200">{connection.data.shopify.reason}</div>}</div><div className="rounded-2xl border border-white/10 bg-white/5 p-4"><div className="text-slate-400">Scheduler</div><div className="mt-2 font-semibold">{dashboard?.scheduler?.secret_configured?<span className="text-emerald-300">Protected background job</span>:<span className="text-amber-300">Secret missing</span>}</div></div></div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Generated" value={dashboard?.stats.generated||0} note="Last 45 days"/>
        <Metric label="Approved" value={dashboard?.stats.review_approved||0} note="Passed independent review"/>
        <Metric label="Published" value={dashboard?.stats.published||0} note="Both platforms completed"/>
        <Metric label="Organic reach" value={number.format(dashboard?.stats.total_reach||0)} note="Measured Meta reach"/>
        <Metric label="Engagement" value={`${Number(dashboard?.stats.engagement_rate||0).toFixed(1)}%`} note={`${number.format(dashboard?.stats.total_interactions||0)} interactions`}/>
      </div>

      <Card>
        <button onClick={()=>setSettingsOpen(!settingsOpen)} className="flex w-full items-center justify-between p-5 text-left"><span className="flex items-center gap-3 font-bold text-slate-950"><Settings2 className="h-5 w-5 text-fuchsia-600"/> Automation and offer guardrails</span>{settingsOpen?<ChevronUp/>:<ChevronDown/>}</button>
        {settingsOpen&&config&&<div className="border-t p-5">
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            <label className="flex items-center justify-between rounded-xl border p-3 text-sm font-medium">Enable scheduler<input type="checkbox" checked={config.enabled} onChange={e=>setConfig({...config,enabled:e.target.checked})} className="h-4 w-4 accent-fuchsia-600"/></label>
            <label className={`flex items-center justify-between rounded-xl border p-3 text-sm font-medium ${config.live_publish?'border-rose-300 bg-rose-50':''}`}>Live Meta publishing<input type="checkbox" checked={config.live_publish} onChange={e=>setConfig({...config,live_publish:e.target.checked})} className="h-4 w-4 accent-rose-600"/></label>
            <label className="text-xs font-semibold uppercase text-slate-500">Midday start<input type="time" value={config.midday_time} onChange={e=>setConfig({...config,midday_time:e.target.value})} className="mt-2 block w-full rounded-xl border px-3 py-2 text-sm font-normal text-slate-900"/></label>
            <label className="text-xs font-semibold uppercase text-slate-500">Evening start<input type="time" value={config.evening_time} onChange={e=>setConfig({...config,evening_time:e.target.value})} className="mt-2 block w-full rounded-xl border px-3 py-2 text-sm font-normal text-slate-900"/></label>
            <label className="text-xs font-semibold uppercase text-slate-500">Posts per batch<input type="number" min={1} max={5} value={config.batch_size} onChange={e=>setConfig({...config,batch_size:Number(e.target.value)})} className="mt-2 block w-full rounded-xl border px-3 py-2 text-sm font-normal text-slate-900"/></label>
            <label className="text-xs font-semibold uppercase text-slate-500">Minutes between posts<input type="number" min={2} max={60} value={config.post_interval_minutes} onChange={e=>setConfig({...config,post_interval_minutes:Number(e.target.value)})} className="mt-2 block w-full rounded-xl border px-3 py-2 text-sm font-normal text-slate-900"/></label>
            <label className="text-xs font-semibold uppercase text-slate-500">Minimum inventory<input type="number" min={1} value={config.minimum_inventory} onChange={e=>setConfig({...config,minimum_inventory:Number(e.target.value)})} className="mt-2 block w-full rounded-xl border px-3 py-2 text-sm font-normal text-slate-900"/></label>
            <label className="text-xs font-semibold uppercase text-slate-500">Reviewer threshold<input type="number" min={60} max={100} value={config.minimum_review_score} onChange={e=>setConfig({...config,minimum_review_score:Number(e.target.value)})} className="mt-2 block w-full rounded-xl border px-3 py-2 text-sm font-normal text-slate-900"/></label>
            <label className="text-xs font-semibold uppercase text-slate-500">Attempts after rejection<input type="number" min={1} max={5} value={config.max_review_attempts} onChange={e=>setConfig({...config,max_review_attempts:Number(e.target.value)})} className="mt-2 block w-full rounded-xl border px-3 py-2 text-sm font-normal text-slate-900"/></label>
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div className="rounded-2xl border p-4"><label className="flex items-center justify-between text-sm font-semibold">Approved quantity offer<input type="checkbox" checked={config.quantity_offer_enabled} onChange={e=>setConfig({...config,quantity_offer_enabled:e.target.checked})} className="h-4 w-4 accent-fuchsia-600"/></label><p className="mt-1 text-xs text-slate-500">The agent may use only this exact Arabic offer. Leave disabled unless checkout honors it.</p><textarea dir="rtl" lang="ar" disabled={!config.quantity_offer_enabled} value={config.approved_quantity_offer_ar} onChange={e=>setConfig({...config,approved_quantity_offer_ar:e.target.value})} placeholder="مثال: اشتر قطعتين واحصل على الثالثة مجاناً" className="mt-3 min-h-24 w-full rounded-xl border p-3 text-right text-sm disabled:bg-slate-100"/></div>
            <div className="rounded-2xl border p-4"><label className="text-sm font-semibold">Brand and compliance notes</label><p className="mt-1 text-xs text-slate-500">Facts and tone the creative team should respect. Internal notes stay in English.</p><textarea value={config.brand_notes} onChange={e=>setConfig({...config,brand_notes:e.target.value})} placeholder="Approved delivery facts, returns policy, brand tone…" className="mt-3 min-h-24 w-full rounded-xl border p-3 text-sm"/></div>
          </div>
          <div className="mt-5 flex justify-end"><button onClick={save} disabled={!!busy} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50">{busy==='save'?<Loader2 className="h-4 w-4 animate-spin"/>:<Save className="h-4 w-4"/>} Save settings</button></div>
        </div>}
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 font-bold text-slate-950"><CalendarClock className="h-5 w-5 text-fuchsia-600"/> Today&apos;s production</h2><p className="mt-1 text-xs text-slate-500">Queue a batch or generate the next post in an active batch.</p></div><div className="flex flex-wrap gap-2"><button onClick={()=>action('midday',()=>queueSocialAgentBatch(store,'midday',true),'Midday batch queued; first post processed.')} disabled={!!busy} className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-slate-50">14:00 batch</button><button onClick={()=>action('evening',()=>queueSocialAgentBatch(store,'evening',true),'Evening batch queued; first post processed.')} disabled={!!busy} className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-slate-50">18:00 batch</button><button onClick={()=>action('next',()=>prepareNextSocialPost(store),'Next queued post processed.')} disabled={!!busy} className="inline-flex items-center gap-2 rounded-xl bg-fuchsia-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy==='next'?<Loader2 className="h-3.5 w-3.5 animate-spin"/>:<Play className="h-3.5 w-3.5"/>} Create next</button></div></div>
          <div className="mt-5 space-y-2">{todayPosts.length?todayPosts.slice().reverse().map(post=><div key={post.id} className="flex items-center justify-between gap-3 rounded-xl border p-3"><div className="min-w-0"><div className="truncate text-sm font-semibold">{post.product?.title}</div><div className="text-xs text-slate-500">{new Date(post.scheduled_for).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} · reviewer {post.review?.score||'—'}</div></div><StatusPill status={post.status}/></div>):<div className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-400">No posts queued for today.</div>}</div>
          <div className="mt-4 flex gap-2"><button onClick={()=>action('due',()=>publishDueSocialPosts(store),'Due approved posts processed.')} disabled={!!busy} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-slate-50"><Send className="h-3.5 w-3.5"/> Publish due</button><button onClick={()=>action('analytics',()=>refreshSocialAnalytics(store),'Analytics and learning memory refreshed.')} disabled={!!busy} className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-slate-50"><BarChart3 className="h-3.5 w-3.5"/> Refresh analytics</button></div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between"><div><h2 className="flex items-center gap-2 font-bold text-slate-950"><PackageSearch className="h-5 w-5 text-fuchsia-600"/> Product ranking</h2><p className="mt-1 text-xs text-slate-500">All {number.format(catalog?.data?.active_count||0)} active products scanned; {number.format(catalog?.data?.eligible_count||0)} meet inventory, media, and storefront rules.</p></div><button onClick={()=>action('catalog',()=>socialAgentCatalog(store).then(result=>{setCatalog(result);return result}),'Catalog ranking refreshed.')} className="rounded-xl border p-2"><RefreshCcw className="h-4 w-4"/></button></div>
          {catalog?.error&&<div className="mt-4 text-sm text-rose-600">{catalog.error}</div>}
          <div className="mt-4 space-y-3">{(catalog?.data?.products||[]).slice(0,6).map((product:any,index:number)=><div key={product.id} className="grid grid-cols-[34px_44px_1fr_auto] items-center gap-3"><div className="text-center text-xs font-bold text-slate-400">#{index+1}</div><img src={product.images?.[0]?.url} alt={product.title} className="h-11 w-11 rounded-lg bg-slate-100 object-cover"/><div className="min-w-0"><div className="truncate text-sm font-semibold">{product.title}</div><div className="text-xs text-slate-500">Inventory {number.format(product.inventory)} · {catalog?.data?.season}</div></div><div className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">{product.ranking?.score||0}</div></div>)}</div>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="flex items-center gap-2 font-bold text-slate-950"><Activity className="h-5 w-5 text-fuchsia-600"/> Closed-loop learning memory</h2>
        <p className="mt-2 text-sm text-slate-600">{dashboard?.learning?.summary}</p>
        <div className="mt-5 grid gap-4 md:grid-cols-3"><div><div className="text-xs font-semibold uppercase text-emerald-600">Winning patterns</div><ul className="mt-2 space-y-2 text-sm text-slate-600">{(dashboard?.learning?.winning_patterns||[]).map((x:string)=><li key={x} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500"/>{x}</li>)}</ul></div><div><div className="text-xs font-semibold uppercase text-rose-600">Weak patterns</div><ul className="mt-2 space-y-2 text-sm text-slate-600">{(dashboard?.learning?.losing_patterns||[]).map((x:string)=><li key={x} className="flex gap-2"><XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500"/>{x}</li>)}</ul></div><div><div className="text-xs font-semibold uppercase text-blue-600">Next experiments</div><ul className="mt-2 space-y-2 text-sm text-slate-600">{(dashboard?.learning?.experiments||[]).map((x:string)=><li key={x} className="flex gap-2"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-blue-500"/>{x}</li>)}</ul></div></div>
      </Card>

      <section className="space-y-4"><div className="flex items-center justify-between"><div><h2 className="text-xl font-bold text-slate-950">Creative queue</h2><p className="text-sm text-slate-500">Arabic copy is isolated to customer-facing previews; operational controls remain English.</p></div><span className="text-xs text-slate-400">{dashboard?.posts?.length||0} recent posts</span></div>{dashboard?.posts?.length?dashboard.posts.map(post=><PostCard key={post.id} post={post} busy={!!busy} onPublish={post=>{const force=!config?.live_publish;if(window.confirm(`${force?'Live mode is off. Force-publish':'Publish'} this reviewer-approved post to Facebook and Instagram now?`)) action(`publish-${post.id}`,()=>publishSocialPost(store,post.id,force),'Post publishing completed.')}}/>):<Card className="p-12 text-center text-slate-400"><ImageIcon className="mx-auto mb-3"/>No creative history yet.</Card>}</section>
    </main>
  </div>
}
