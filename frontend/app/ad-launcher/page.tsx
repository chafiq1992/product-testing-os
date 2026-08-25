"use client"

import {useEffect,useMemo,useState} from 'react'
import Link from 'next/link'
import {
  AlertTriangle,ArrowLeft,CheckCircle2,Clock3,Film,Image as ImageIcon,Layers3,
  Loader2,LockKeyhole,LogIn,Rocket,ShieldCheck,Sparkles,UploadCloud,WandSparkles,XCircle,
} from 'lucide-react'
import ShopifyStoreSelect from '@/components/ShopifyStoreSelect'
import {
  adLauncherConnection,createAdLauncherJob,getAdLauncherJob,getAdLauncherProductCards,launchAdLauncherJob,retryAdLauncherJob,
  systemHealthLogin,systemHealthMe,type AdLauncherJob,type AdLauncherProductCard,
} from '@/lib/api'

function Card({children,className=''}:{children:React.ReactNode,className?:string}){
  return <section className={`rounded-3xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</section>
}

function Status({status}:{status:string}){
  const tone=status==='launched'?'border-emerald-200 bg-emerald-50 text-emerald-700'
    :status==='approved'?'border-blue-200 bg-blue-50 text-blue-700'
    :['rejected','failed','launch_failed'].includes(status)?'border-rose-200 bg-rose-50 text-rose-700'
    :'border-amber-200 bg-amber-50 text-amber-700'
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wide ${tone}`}>{status.replaceAll('_',' ')}</span>
}

function Login({onReady}:{onReady:()=>void}){
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  async function submit(event:React.FormEvent){
    event.preventDefault();setBusy(true);setError('')
    try{
      const result=await systemHealthLogin({email,password,remember:true})
      if(result.error||!result.data?.token) throw new Error(result.error||'Login failed')
      localStorage.setItem('ptos_system_admin_token',result.data.token)
      onReady()
    }catch(err:any){setError(String(err?.response?.data?.detail||err?.message||err))}
    finally{setBusy(false)}
  }
  return <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-900">
    <form onSubmit={submit} className="w-full max-w-md rounded-3xl bg-white p-7 shadow-2xl">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-600 text-white"><ShieldCheck/></div>
      <h1 className="mt-5 text-2xl font-bold">Ad Launcher Control Room</h1>
      <p className="mt-2 text-sm text-slate-500">Use the same administrator account as System Health.</p>
      <label className="mt-6 block text-xs font-bold uppercase tracking-wide text-slate-500">Email</label>
      <input required type="email" value={email} onChange={event=>setEmail(event.target.value)} className="mt-2 w-full rounded-xl border px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-500"/>
      <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-slate-500">Password</label>
      <input required type="password" value={password} onChange={event=>setPassword(event.target.value)} className="mt-2 w-full rounded-xl border px-3 py-2.5 outline-none focus:ring-2 focus:ring-violet-500"/>
      {error&&<div className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}
      <button disabled={busy} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy?<Loader2 className="h-4 w-4 animate-spin"/>:<LogIn className="h-4 w-4"/>} Sign in</button>
    </form>
  </main>
}

function MediaPreview({url,type,name}:{url:string,type:string,name:string}){
  if(type==='video') return <video controls src={url} className="aspect-[4/5] w-full bg-slate-950 object-contain"/>
  return <img src={url} alt={name} className="aspect-[4/5] w-full bg-slate-100 object-cover"/>
}

export default function AdLauncherPage(){
  const [authed,setAuthed]=useState<boolean|null>(null)
  const [store,setStore]=useState('irrakids')
  const [adAccountId,setAdAccountId]=useState('')
  const [productId,setProductId]=useState('')
  const [landingUrl,setLandingUrl]=useState('')
  const [files,setFiles]=useState<File[]>([])
  const [savedMedia,setSavedMedia]=useState<any[]>([])
  const [sourceJobId,setSourceJobId]=useState('')
  const [budget,setBudget]=useState(9)
  const [adsetCount,setAdsetCount]=useState<2|3>(3)
  const [creativeType,setCreativeType]=useState<'image'|'carousel'|'video'>('image')
  const [countries,setCountries]=useState('MA')
  const [aiMode,setAiMode]=useState(false)
  const [autoLaunch,setAutoLaunch]=useState(false)
  const [connection,setConnection]=useState<any>(null)
  const [jobId,setJobId]=useState('')
  const [job,setJob]=useState<AdLauncherJob|null>(null)
  const [productCards,setProductCards]=useState<AdLauncherProductCard[]>([])
  const [pollNonce,setPollNonce]=useState(0)
  const [busy,setBusy]=useState('')
  const [error,setError]=useState('')

  useEffect(()=>{
    try{setStore(localStorage.getItem('ptos_store')||'irrakids')}catch{}
    systemHealthMe().then(result=>setAuthed(!result.error)).catch(()=>setAuthed(false))
  },[])

  useEffect(()=>{
    if(!authed)return
    let alive=true
    adLauncherConnection(store,adAccountId||undefined).then(result=>{
      if(!alive)return
      const data=result.data||{ready:false,error:result.error}
      setConnection(data)
      if(!adAccountId){
        const accounts=Array.isArray(data.accounts)?data.accounts:[]
        let remembered=''
        try{remembered=localStorage.getItem(`ptos_meta_account_${store}`)||''}catch{}
        const validRemembered=accounts.some((item:any)=>String(item.account_id)===remembered)
        const next=(validRemembered?remembered:String(data.selected_account_id||accounts[0]?.account_id||''))
        if(next)setAdAccountId(next)
      }
    }).catch(()=>{if(alive)setConnection({ready:false})})
    return()=>{alive=false}
  },[authed,store,adAccountId])

  async function refreshProductCards(){
    try{
      const result=await getAdLauncherProductCards()
      if(result.data)setProductCards(result.data)
    }catch{}
  }

  useEffect(()=>{if(authed)refreshProductCards()},[authed])

  function selectStore(value:string){
    setStore(value);setAdAccountId('');setConnection(null);setProductId('');setLandingUrl('');setFiles([]);setSavedMedia([]);setSourceJobId('')
    try{localStorage.setItem('ptos_store',value)}catch{}
  }

  function selectAdAccount(value:string){
    setAdAccountId(value);setConnection(null)
    try{localStorage.setItem(`ptos_meta_account_${store}`,value)}catch{}
  }

  useEffect(()=>{
    if(!jobId||!authed)return
    let alive=true
    let timer:any
    async function poll(){
      try{
        const result=await getAdLauncherJob(store,jobId)
        if(!alive)return
        if(result.error||!result.data)throw new Error(result.error||'Job unavailable')
        setJob(result.data)
        const terminal=['rejected','failed','launched','launch_failed'].includes(result.data.status)
          ||(result.data.status==='approved'&&!result.data.request?.auto_launch&&result.data.stage!=='meta_retry_queued')
        if(!terminal)timer=setTimeout(poll,2200)
        else refreshProductCards()
      }catch(err:any){if(alive)setError(String(err?.response?.data?.detail||err?.message||err))}
    }
    poll()
    return()=>{alive=false;if(timer)clearTimeout(timer)}
  },[jobId,store,authed,pollNonce])

  const media=useMemo(()=>{
    const items=files.length?files:savedMedia
    const images=items.filter((item:any)=>files.length?item.type.startsWith('image/'):item.kind==='image').length
    const videos=items.filter((item:any)=>files.length?item.type.startsWith('video/'):item.kind==='video').length
    const saved=!files.length&&savedMedia.length?' · saved creative':''
    if(creativeType==='video'&&videos===1&&items.length===1)return {valid:true,label:`Video ad${saved}`,icon:Film}
    if(creativeType==='image'&&images===1&&items.length===1)return {valid:true,label:`Image ad${saved}`,icon:ImageIcon}
    if(creativeType==='carousel'&&images===items.length&&images>=2&&images<=10)return {valid:true,label:`Carousel · ${images} cards${saved}`,icon:Layers3}
    const requirement=creativeType==='carousel'?'Select 2–10 images':creativeType==='video'?'Select exactly one video':'Select exactly one image'
    return {valid:false,label:items.length?`Files do not match ${creativeType} · ${requirement}`:requirement,icon:UploadCloud}
  },[files,savedMedia,creativeType])

  async function analyze(){
    setError('');setJob(null);setJobId('')
    if(!productId.trim()||!media.valid||!adAccountId){setError('Choose a store and Meta ad account, enter a Shopify product ID, and select one valid creative format.');return}
    if(autoLaunch&&!window.confirm('Arm automatic LIVE scheduling? The campaign will be activated after reviewer approval and start at 23:59.'))return
    setBusy('analyze')
    try{
      const result=await createAdLauncherJob({
        store,ad_account_id:adAccountId,source_job_id:sourceJobId||undefined,product_id:productId.trim(),landing_url:landingUrl.trim()||undefined,
        daily_budget_per_adset_usd:budget,adset_count:adsetCount,creative_type:creativeType,ai_generated_adsets:aiMode,
        countries:countries.split(',').map(value=>value.trim().toUpperCase()).filter(Boolean),
        timezone:'Africa/Casablanca',auto_launch:autoLaunch,confirm_live_launch:autoLaunch,files,
      })
      if(result.error||!result.data?.job_id)throw new Error(result.error||'Could not start analysis')
      setJobId(result.data.job_id)
    }catch(err:any){
      if(err?.response?.status===401)setAuthed(false)
      setError(String(err?.response?.data?.detail||err?.message||err))
    }finally{setBusy('')}
  }

  async function retryJob(){
    if(!jobId||!job||!['failed','rejected','launch_failed'].includes(job.status))return
    const warning=job.status==='launch_failed'
      ?' The approved analysis, copy, images, and review will be kept; only the Meta launch will run again.'
      :job.request?.auto_launch?' If the review passes, the original auto-launch setting can create the Meta campaign.':''
    if(!window.confirm(`Resume this job from its latest successful checkpoint?${warning}`))return
    setBusy('retry');setError('')
    try{
      const result=await retryAdLauncherJob(store,jobId)
      if(result.error)throw new Error(result.error)
      const latest=await getAdLauncherJob(store,jobId)
      if(latest.data)setJob(latest.data)
      setPollNonce(value=>value+1)
    }catch(err:any){setError(String(err?.response?.data?.detail||err?.message||err))}
    finally{setBusy('')}
  }

  function loadProductCard(card:AdLauncherProductCard){
    const request=card.request||{}
    const nextStore=String(card.store||'irrakids')
    const nextAccount=String(request.meta_ad_account_id||'')
    setJobId('');setJob(null);setError('');setFiles([])
    setStore(nextStore);setAdAccountId(nextAccount);setConnection(null)
    setProductId(String(request.product_id||card.product_id||''))
    setLandingUrl(String(request.landing_url||''))
    setBudget(9)
    setAdsetCount(Number(request.adset_count)===2?2:3)
    setCountries((request.countries||['MA']).join(','))
    const restoredType=String(request.creative_type||'')
    const restoredMedia=Array.isArray(request.media)?request.media:[]
    const imageCount=restoredMedia.filter((item:any)=>item.kind==='image').length
    setCreativeType(restoredType==='carousel'||restoredType==='video'?restoredType:(imageCount>1?'carousel':'image'))
    setAiMode(!!request.ai_generated_adsets);setAutoLaunch(!!request.auto_launch)
    setSavedMedia(restoredMedia);setSourceJobId(card.job_id)
    try{
      localStorage.setItem('ptos_store',nextStore)
      if(nextAccount)localStorage.setItem(`ptos_meta_account_${nextStore}`,nextAccount)
    }catch{}
    window.scrollTo({top:0,behavior:'smooth'})
  }

  async function launch(){
    if(!jobId||!window.confirm(`Launch this approved ${job?.result?.plan?.adsets?.length||adsetCount+(aiMode?2:0)}-ad-set Sales campaign LIVE at 23:59?`))return
    setBusy('launch');setError('')
    try{
      const result=await launchAdLauncherJob(store,jobId)
      if(result.error)throw new Error(result.error)
      const latest=await getAdLauncherJob(store,jobId)
      if(latest.data)setJob(latest.data)
    }catch(err:any){setError(String(err?.response?.data?.detail||err?.message||err))}
    finally{setBusy('')}
  }

  if(authed===null)return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white"><Loader2 className="animate-spin"/></div>
  if(!authed)return <Login onReady={()=>setAuthed(true)}/>

  const plan=job?.result?.plan
  const review=job?.result?.review
  const metaAppModeError=String(job?.error?.message||'').includes('1885183')
  const Icon=media.icon

  return <div className="min-h-screen bg-slate-50 text-slate-800">
    <header className="sticky top-0 z-40 border-b bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-7">
        <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-600 text-white"><Rocket className="h-5 w-5"/></div><div><h1 className="font-bold text-slate-950">AI Meta Ad Launcher</h1><p className="text-xs text-slate-500">Shopify evidence → creative team → reviewer → scheduled Sales campaign</p></div></div>
        <div className="flex items-center gap-2">
          <ShopifyStoreSelect value={store} onChange={selectStore} disabled={!!jobId} className="rounded-xl border bg-white px-3 py-2 text-sm font-medium"/>
          <select value={adAccountId} onChange={event=>selectAdAccount(event.target.value)} disabled={!!jobId||!connection?.accounts?.length} aria-label="Meta ad account" className="max-w-64 rounded-xl border bg-white px-3 py-2 text-sm font-medium disabled:opacity-50">
            <option value="">Choose Meta ad account</option>
            {(connection?.accounts||[]).map((account:any)=><option key={account.account_id} value={account.account_id}>{account.name} · {account.currency||'—'} · act_{account.account_id}</option>)}
          </select>
          <Link href="/" className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white"><ArrowLeft className="h-4 w-4"/> Home</Link>
        </div>
      </div>
    </header>

    <main className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 md:px-7">
      <section className="overflow-hidden rounded-[2rem] bg-slate-950 p-6 text-white md:p-9">
        <div className="grid gap-7 lg:grid-cols-[1.25fr_.75fr] lg:items-end">
          <div><div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-violet-200"><Sparkles className="h-3.5 w-3.5"/> Creative-test operating system</div><h2 className="mt-5 max-w-4xl text-3xl font-bold tracking-tight md:text-5xl">Launch controlled Meta tests without surrendering the creative.</h2><p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300">One sequentially lettered Sales campaign. Choose two or three uploaded-creative ad sets, each at $9/day, with optional GPT Image tests. Shared broad audience, ABO budget, manual feeds, no catalog, no Advantage audience, and no Meta creative enhancements.</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5"><div className="flex items-center justify-between"><span className="text-sm text-slate-300">Store workspace · {store}</span>{connection?.ready?<CheckCircle2 className="h-5 w-5 text-emerald-300"/>:<AlertTriangle className="h-5 w-5 text-amber-300"/>}</div><div className="mt-3 font-semibold">{connection?.ready?`${connection.account?.name||'Ad account'} · ${connection.account?.currency||'USD'}`:'Needs a connected Meta token, ad account, page, and pixel'}</div><div className="mt-1 text-xs text-slate-400">act_{adAccountId||'—'} · Marketing API {connection?.api_version||'v26.0'}</div></div>
        </div>
      </section>

      {error&&<div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}

      <div className="grid gap-6 xl:grid-cols-[1.05fr_.95fr]">
        <Card className="p-6">
          <div className="flex items-start justify-between gap-4"><div><h3 className="text-xl font-bold text-slate-950">1. Product and destination</h3><p className="mt-1 text-sm text-slate-500">The agent reads Shopify first, then verifies the Arabic storefront page.</p></div><LockKeyhole className="text-violet-600"/></div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Shopify product ID<input value={productId} onChange={event=>setProductId(event.target.value.replace(/\D/g,''))} disabled={!!jobId} placeholder="1234567890" className="mt-2 block w-full rounded-xl border px-3 py-2.5 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-violet-500"/></label>
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Arabic page URL · optional<input value={landingUrl} onChange={event=>setLandingUrl(event.target.value)} disabled={!!jobId} placeholder="Uses Shopify onlineStoreUrl" className="mt-2 block w-full rounded-xl border px-3 py-2.5 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-violet-500"/></label>
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Uploaded-creative ad sets<select value={adsetCount} onChange={event=>setAdsetCount(Number(event.target.value)===2?2:3)} disabled={!!jobId} className="mt-2 block w-full rounded-xl border bg-white px-3 py-2.5 text-sm font-normal text-slate-900"><option value={2}>2 ad sets</option><option value={3}>3 ad sets</option></select><span className="mt-1 block normal-case font-normal text-slate-400">Each ad set contains one named ad.</span></label>
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Daily budget per ad set · USD<input type="number" value={budget} readOnly disabled={!!jobId} className="mt-2 block w-full rounded-xl border bg-slate-50 px-3 py-2.5 text-sm font-normal text-slate-900"/><span className="mt-1 block normal-case font-normal text-slate-400">Fixed at $9.00 each. Total: ${(budget*(adsetCount+(aiMode?2:0))||0).toFixed(2)}/day across {adsetCount+(aiMode?2:0)} ABO ad sets.</span></label>
            <label className="text-xs font-bold uppercase tracking-wide text-slate-500">Countries<input value={countries} onChange={event=>setCountries(event.target.value)} disabled={!!jobId} placeholder="MA" className="mt-2 block w-full rounded-xl border px-3 py-2.5 text-sm font-normal text-slate-900"/><span className="mt-1 block normal-case font-normal text-slate-400">ISO codes separated by commas.</span></label>
          </div>
        </Card>

        <Card className="p-6">
          <div><h3 className="text-xl font-bold text-slate-950">2. Creative input</h3><p className="mt-1 text-sm text-slate-500">Choose the ad format first, then upload files that match it.</p></div>
          <label className="mt-5 block text-xs font-bold uppercase tracking-wide text-slate-500">Ad creative format<select value={creativeType} onChange={event=>{setCreativeType(event.target.value as 'image'|'carousel'|'video');setFiles([]);setSavedMedia([]);setSourceJobId('')}} disabled={!!jobId} className="mt-2 block w-full rounded-xl border bg-white px-3 py-2.5 text-sm font-normal text-slate-900"><option value="image">One image ad</option><option value="carousel">Carousel · 2–10 images</option><option value="video">One video ad</option></select></label>
          <label className="mt-5 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center hover:border-violet-400 hover:bg-violet-50">
            <UploadCloud className="h-8 w-8 text-violet-600"/><span className="mt-3 font-semibold text-slate-800">Choose creative files</span><span className="mt-1 text-xs text-slate-500">JPG, PNG, WebP, MP4, MOV, or WebM</span>
            <input type="file" multiple={creativeType==='carousel'} accept={creativeType==='video'?'video/mp4,video/quicktime,video/webm':'image/jpeg,image/png,image/webp'} disabled={!!jobId} onChange={event=>{setFiles(Array.from(event.target.files||[]));setSavedMedia([]);setSourceJobId('')}} className="hidden"/>
          </label>
          <div className={`mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${media.valid?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-500'}`}><Icon className="h-4 w-4"/>{media.label}</div>
          {!!files.length&&<div className="mt-3 space-y-1 text-xs text-slate-500">{files.map(file=><div key={`${file.name}-${file.size}`} className="flex justify-between rounded-lg border px-3 py-2"><span className="truncate">{file.name}</span><span>{(file.size/1024/1024).toFixed(1)} MB</span></div>)}</div>}
          {!files.length&&!!savedMedia.length&&<div className="mt-3 space-y-1 text-xs text-slate-500">{savedMedia.map((item:any)=><div key={item.filename} className="flex justify-between rounded-lg border border-violet-100 bg-violet-50/50 px-3 py-2"><span className="truncate">{item.filename}</span><span>Saved</span></div>)}</div>}
        </Card>
      </div>

      <Card className="p-6">
        <div className="grid gap-4 lg:grid-cols-2">
          <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 ${aiMode?'border-violet-300 bg-violet-50':''}`}><input type="checkbox" checked={aiMode} disabled={!!jobId} onChange={event=>setAiMode(event.target.checked)} className="mt-1 h-4 w-4 accent-violet-600"/><div><div className="flex items-center gap-2 font-bold text-slate-950"><WandSparkles className="h-4 w-4 text-violet-600"/> Add two GPT Image ad sets</div><p className="mt-1 text-xs leading-5 text-slate-500">Appends two realistic, product-faithful 4:5 image tests. Total becomes {adsetCount+2} ad sets at ${budget.toFixed(2)} each.</p></div></label>
          <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 ${autoLaunch?'border-rose-300 bg-rose-50':''}`}><input type="checkbox" checked={autoLaunch} disabled={!!jobId} onChange={event=>setAutoLaunch(event.target.checked)} className="mt-1 h-4 w-4 accent-rose-600"/><div><div className="flex items-center gap-2 font-bold text-slate-950"><Clock3 className="h-4 w-4 text-rose-600"/> Auto-launch after approval</div><p className="mt-1 text-xs leading-5 text-slate-500">When armed, the reviewer may activate the completed campaign immediately. Delivery is still held until 23:59 Africa/Casablanca.</p></div></label>
        </div>
        <button onClick={analyze} disabled={!!busy||!!jobId||!connection?.ready} className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3.5 font-bold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50">{busy==='analyze'?<Loader2 className="h-5 w-5 animate-spin"/>:<Sparkles className="h-5 w-5"/>} Analyze, write, and review {adsetCount+(aiMode?2:0)} ad sets</button>
        {!!jobId&&<button onClick={()=>{setJobId('');setJob(null);setFiles([]);setError('')}} disabled={['running','queued','launching'].includes(job?.status||'')} className="mt-3 w-full rounded-xl border px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-40">Start another campaign</button>}
      </Card>

      {job&&<Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5"><div><div className="flex items-center gap-3"><h3 className="font-bold text-slate-950">Campaign job</h3><Status status={job.status}/></div><p className="mt-1 text-xs text-slate-500">{job.stage?.replaceAll('_',' ')} · {job.id}</p></div><span className="text-sm font-bold text-slate-500">{job.progress||0}%</span></div>
        <div className="h-2 bg-slate-100"><div className="h-full bg-violet-600 transition-all" style={{width:`${job.progress||0}%`}}/></div>
        {['queued','running','launching'].includes(job.status)&&<div className="flex items-center gap-3 border-b p-5 text-sm text-slate-600"><Loader2 className="h-5 w-5 animate-spin text-violet-600"/> The creative team is working. This log updates as evidence and decisions become available.</div>}
        {!!job.activity?.length&&<div className="p-5"><div className="flex flex-wrap items-end justify-between gap-2"><div><h4 className="font-bold text-slate-950">Explainable creation log</h4><p className="mt-1 text-xs text-slate-500">Concise evidence and decision summaries are shown; private hidden chain-of-thought is never displayed.</p></div><span className="text-xs text-slate-400">{job.activity.length} updates</span></div><div className="mt-4 space-y-3">{job.activity.map((item,index)=><div key={`${item.at}-${index}`} className="flex gap-3 rounded-2xl border bg-slate-50 p-4"><div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${item.status==='failed'||item.status==='attention'?'bg-rose-500':item.status==='running'?'animate-pulse bg-amber-500':'bg-emerald-500'}`}/><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold text-slate-900">{item.title}</span>{item.source==='openai_reasoning_summary'&&<span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-700">AI reasoning summary</span>}</div><p className="mt-1 whitespace-pre-line text-sm leading-6 text-slate-600">{item.summary}</p>{item.at&&<div className="mt-2 text-[10px] text-slate-400">{new Date(item.at).toLocaleTimeString()}</div>}</div></div>)}</div></div>}
        {job.error&&<div className="m-5 rounded-2xl bg-rose-50 p-4 text-sm text-rose-700"><b>{job.error.type||'Error'}:</b> {job.error.message}</div>}
        {metaAppModeError&&<div className="mx-5 mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><div className="font-bold">Meta app action required before retrying</div><ol className="mt-2 list-decimal space-y-1 pl-5"><li>Open <a href="https://developers.facebook.com/apps/" target="_blank" className="font-semibold underline">Meta for Developers</a> and select the app that issued this token.</li><li>Switch App Mode from Development to Live/Public and confirm the required Marketing API permissions.</li><li>Generate a fresh token from that Live app, update the launcher token, then use Retry Meta launch.</li></ol><p className="mt-2 text-xs">The launcher now tests ad creatives before creating a campaign, preventing this error from leaving another empty campaign.</p></div>}
        {['failed','rejected','launch_failed'].includes(job.status)&&<div className="border-t p-5"><button onClick={retryJob} disabled={busy==='retry'} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy==='retry'?<Loader2 className="h-4 w-4 animate-spin"/>:<Sparkles className="h-4 w-4"/>} {job.status==='launch_failed'?'Retry Meta launch':'Resume from saved checkpoint'}</button><p className="mt-2 text-xs text-slate-500">{job.status==='launch_failed'?'The approved plan is kept; only media transfer and Meta campaign creation run again.':'Completed evidence, copy, and generated images are reused when available.'}</p></div>}
      </Card>}

      {review&&plan&&<>
        <Card className={`p-6 ${review.approved?'border-emerald-200':'border-rose-200'}`}>
          <div className="flex flex-wrap items-start justify-between gap-5"><div className="flex items-start gap-3">{review.approved?<CheckCircle2 className="mt-1 h-7 w-7 text-emerald-600"/>:<XCircle className="mt-1 h-7 w-7 text-rose-600"/>}<div><h3 className="text-xl font-bold text-slate-950">Independent review: {review.approved?'approved':'rejected'}</h3><p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">{review.summary}</p></div></div><div className="rounded-2xl bg-slate-950 px-5 py-3 text-center text-white"><div className="text-3xl font-bold">{review.score}</div><div className="text-[10px] uppercase tracking-wide text-slate-400">score / 100</div></div></div>
          {!!review.blockers?.length&&<div className="mt-5 rounded-2xl bg-rose-50 p-4"><div className="text-xs font-bold uppercase tracking-wide text-rose-700">Launch blockers</div><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-rose-800">{review.blockers.map((item:string)=><li key={item}>{item}</li>)}</ul></div>}
          {review.approved&&job?.status==='approved'&&!job?.request?.auto_launch&&<button onClick={launch} disabled={busy==='launch'} className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3 font-bold text-white hover:bg-emerald-700 disabled:opacity-50">{busy==='launch'?<Loader2 className="h-5 w-5 animate-spin"/>:<Rocket className="h-5 w-5"/>} Launch approved campaign at 23:59</button>}
        </Card>

        <Card className="p-6">
          <div className="text-xs font-bold uppercase tracking-wide text-violet-600">Reference Meta hierarchy</div>
          <h3 className="mt-2 text-xl font-bold text-slate-950">Campaign · {plan.campaign_name}</h3>
          <p className="mt-1 text-sm text-slate-500">Sequential product campaign naming with the reference ABO hierarchy. Every ad set contains one named ad.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {plan.adsets?.map((adset:any)=><div key={adset.name} className="rounded-2xl border bg-slate-50 p-4"><div className="font-bold text-slate-900">{adset.name}</div><div className="mt-1 text-sm text-violet-600">Ad · {adset.ad_name}</div></div>)}
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[.8fr_1.2fr]">
          <Card className="overflow-hidden">
            {job?.result?.product?.images?.[0]?.url&&<img src={job.result.product.images[0].url} alt={job.result.product.title||'Product'} className="aspect-video w-full bg-slate-100 object-cover"/>}
            <div className="p-5"><div className="text-xs font-bold uppercase tracking-wide text-violet-600">Shopify evidence</div><h3 className="mt-2 text-xl font-bold text-slate-950">{job?.result?.product?.title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{plan.analysis?.product_analysis?.product_summary}</p><div className="mt-4 grid grid-cols-2 gap-2 text-sm"><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">Inventory</div><b>{job?.result?.product?.inventory??'—'}</b></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-xs text-slate-400">Price</div><b>{job?.result?.product?.price??'—'} MAD</b></div></div></div>
          </Card>
          <Card className="p-6"><div className="text-xs font-bold uppercase tracking-wide text-violet-600">Shared manual audience</div><h3 className="mt-2 text-2xl font-bold text-slate-950">{plan.audience?.audience_label}</h3><div className="mt-4 flex flex-wrap gap-2 text-sm">{plan.audience?.country_codes?.map((country:string)=><span key={country} className="rounded-full bg-slate-100 px-3 py-1.5 font-semibold">{country}</span>)}<span className="rounded-full bg-slate-100 px-3 py-1.5">Age {plan.audience?.age_min}–{plan.audience?.age_max}</span><span className="rounded-full bg-slate-100 px-3 py-1.5 capitalize">{plan.audience?.gender}</span><span className="rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700">No interests</span></div><p className="mt-4 text-sm leading-6 text-slate-600">{plan.audience?.rationale}</p><div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm"><div><b>Budget:</b> ${plan.total_daily_budget_usd}/day total · ${(plan.total_daily_budget_usd/plan.adsets.length).toFixed(2)} per ad set · ABO</div><div className="mt-1"><b>Start:</b> {new Date(plan.scheduled_start).toLocaleString()}</div><div className="mt-1"><b>Destination:</b> <a href={plan.landing_url} target="_blank" className="text-violet-600 underline">Arabic Shopify page</a></div></div></Card>
        </div>

        <section><div className="mb-3 flex items-end justify-between"><div><h3 className="text-xl font-bold text-slate-950">{review.approved?'Approved':'Generated'} ad-set plan</h3><p className="text-sm text-slate-500">Same audience, destination, placements, and budget method. Message angle and AI creative are the controlled variables.</p></div><span className="text-xs text-slate-400">Copy: {job?.result?.model} ({job?.result?.model_reasoning_effort||'high'}) · Images: {job?.result?.image_model}</span></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">{plan.adsets?.map((adset:any,index:number)=><Card key={`${adset.name}-${index}`} className="overflow-hidden">{adset.media_urls?.[0]&&<MediaPreview url={adset.media_urls[0]} type={adset.media_type} name={adset.name}/>}<div className="p-4"><div className="flex items-center justify-between gap-2"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${adset.origin==='ai_generated'?'bg-violet-50 text-violet-700':'bg-blue-50 text-blue-700'}`}>{adset.origin.replace('_',' ')}</span><span className="text-[10px] uppercase text-slate-400">{adset.media_type}</span></div><div className="mt-3 text-xs font-semibold text-violet-600">{adset.angle}</div><div dir="rtl" lang="ar" className="mt-3 text-right"><h4 className="font-bold leading-6 text-slate-950">{adset.headline_ar}</h4><p className="mt-2 whitespace-pre-line text-sm leading-7 text-slate-700">{adset.primary_text_ar}</p><p className="mt-2 text-xs text-slate-500">{adset.description_ar}</p></div>{adset.image_prompt&&<details className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-500"><summary className="cursor-pointer font-semibold text-slate-700">Media-buyer image prompt</summary><p className="mt-2 leading-5">{adset.image_prompt}</p></details>}</div></Card>)}</div></section>
      </>}

      {job?.status==='launched'&&job.result?.meta&&<Card className="border-emerald-200 bg-emerald-50 p-6"><div className="flex items-start gap-3"><CheckCircle2 className="mt-1 h-7 w-7 text-emerald-600"/><div><h3 className="text-xl font-bold text-emerald-950">Campaign scheduled successfully</h3><p className="mt-1 text-sm text-emerald-800">Campaign {job.result.meta.campaign_id} is active with a future start at {new Date(job.result.meta.scheduled_start).toLocaleString()}.</p><div className="mt-4 flex flex-wrap gap-2">{job.result.meta.adsets?.map((item:any)=><span key={item.adset_id} className="rounded-full border border-emerald-200 bg-white px-3 py-1.5 text-xs text-emerald-800">Ad set {item.index} · ${Number(item.daily_budget_usd).toFixed(2)}</span>)}</div></div></div></Card>}

      <Card className="p-6"><div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-xl font-bold text-slate-950">Saved product launch cards</h3><p className="mt-1 text-sm text-slate-500">Open a card to restore every input and its saved creative files, then edit or launch a fresh test.</p></div><button onClick={refreshProductCards} className="rounded-xl border px-3 py-2 text-xs font-bold text-slate-600">Refresh</button></div>{productCards.length?<div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{productCards.map(card=><button key={`${card.store}-${card.product_id}`} onClick={()=>loadProductCard(card)} className="overflow-hidden rounded-2xl border bg-white text-left transition hover:-translate-y-0.5 hover:border-violet-300 hover:shadow-md">{card.cover_url?<img src={card.cover_url} alt={card.product_title} className="aspect-video w-full bg-slate-100 object-cover"/>:<div className="flex aspect-video items-center justify-center bg-slate-100 text-slate-400"><ImageIcon/></div>}<div className="p-4"><div className="flex items-center justify-between gap-2"><span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-bold uppercase text-violet-700">{card.store}</span><span className="text-[10px] font-bold uppercase text-slate-400">{card.status.replaceAll('_',' ')}</span></div><h4 className="mt-3 line-clamp-2 font-bold text-slate-950">{card.product_title}</h4><p className="mt-1 text-xs text-slate-500">Product {card.product_id}</p><div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-600"><span className="rounded-lg bg-slate-100 px-2 py-1">${Number(card.request?.daily_budget_per_adset_usd||9)}/ad set</span><span className="rounded-lg bg-slate-100 px-2 py-1">{Number(card.request?.adset_count||3)+(card.request?.ai_generated_adsets?2:0)} ad sets</span><span className="rounded-lg bg-slate-100 px-2 py-1 capitalize">{card.request?.creative_type||'creative'}</span>{card.review_score!=null&&<span className="rounded-lg bg-slate-100 px-2 py-1">Review {card.review_score}/100</span>}</div><div className="mt-4 text-xs font-bold text-violet-600">Restore inputs →</div></div></button>)}</div>:<div className="mt-5 rounded-2xl bg-slate-50 p-6 text-center text-sm text-slate-500">Completed and in-progress products will appear here automatically.</div>}</Card>
    </main>
  </div>
}
