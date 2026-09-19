"use client"

import {useEffect,useRef,useState} from 'react'
import {approveAndPublishSocialPost,generateSocialReviewDraft,getSocialPostReview,type SocialAgentPost} from '@/lib/api'

export default function ManualReview({store,postId,onClose,onChanged}:{store:string,postId:string,onClose:()=>void,onChanged:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null)
  const [post,setPost]=useState<SocialAgentPost|null>(null)
  const [candidate,setCandidate]=useState<number>(1)
  const [accepted,setAccepted]=useState(false)
  const [imageReady,setImageReady]=useState(false)
  const [note,setNote]=useState('')
  const [busy,setBusy]=useState('Loading review…')
  const [error,setError]=useState('')
  const [result,setResult]=useState('')
  const asset=post?.assets?.find(item=>item.candidate===candidate)
  const image=asset?.draft_data_url||asset?.shopify?.url
  const review=asset?.review||post?.review||{}
  const canApprove=!!post&&['rejected','needs_review'].includes(post.status)
  const findings=['source_product_differences','visual_errors','factual_risks','arabic_errors','image_text_errors']
  async function load(){
    const response=await getSocialPostReview(store,postId)
    if(response.error||!response.data) throw new Error(response.error||'Review unavailable')
    setPost(response.data);setCandidate(response.data.assets?.[0]?.candidate||1);setAccepted(false);setImageReady(false)
  }
  function fail(err:any){setError(String(err?.response?.data?.detail||err?.message||err))}
  useEffect(()=>{
    dialog.current?.showModal()
    load().catch(fail).finally(()=>setBusy(''))
  },[store,postId]) // Re-open with a fresh snapshot for every review.
  async function regenerate(){
    setBusy('Generating one replacement draft…');setError('');setAccepted(false)
    try{await generateSocialReviewDraft(store,postId);await load();onChanged()}
    catch(err){fail(err)}finally{setBusy('')}
  }
  async function publish(){
    if(!post||!accepted||!imageReady||!canApprove) return
    setBusy('Approving and publishing…');setError('')
    try{
      const response=await approveAndPublishSocialPost(store,postId,candidate,post.updated_at||'',note)
      if(response.error||!response.data) throw new Error(response.error||'Publishing returned no result')
      const saved=response.data
      setResult(saved.status==='published'?'Published to Facebook and Instagram.':
        `Manual approval saved. ${saved.platforms?.facebook?.id?'Facebook published. ':''}${saved.platforms?.instagram?.id?'Instagram published. ':''}Publishing is incomplete; see the platform errors below.`)
      await load();onChanged()
    }catch(err){fail(err)}finally{setBusy('')}
  }
  return <dialog ref={dialog} onCancel={event=>{if(busy)event.preventDefault();else onClose()}} aria-labelledby="manual-review-title" className="fixed inset-0 z-50 m-auto max-h-[92vh] w-[min(1100px,95vw)] overflow-y-auto rounded-2xl bg-white p-0 text-slate-800 shadow-2xl backdrop:bg-slate-950/60">
    <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white p-5"><div><h2 id="manual-review-title" className="text-lg font-bold">Review and publish manually</h2><p className="text-sm text-slate-500">{post?.product?.title}</p></div><button disabled={!!busy} onClick={onClose} className="rounded-xl border px-3 py-2 disabled:opacity-50">Close</button></div>
    <div className="space-y-5 p-5">
      {busy&&<p role="status" className="rounded-xl bg-blue-50 p-3 text-blue-800">{busy}</p>}
      {error&&<p role="alert" className="rounded-xl bg-rose-50 p-3 text-rose-800">{error}</p>}
      {result&&<p role="status" className="rounded-xl bg-blue-50 p-3 text-blue-800">{result}</p>}
      {post&&<>
        {!!post.assets?.length&&<label className="block text-sm font-semibold">Candidate<select value={candidate} disabled={!!busy} onChange={event=>{setCandidate(Number(event.target.value));setAccepted(false);setImageReady(false)}} className="ml-3 rounded-lg border p-2">{post.assets.map(item=><option key={item.candidate} value={item.candidate}>Candidate {item.candidate} · AI {item.review?.decision||'unreviewed'}</option>)}</select></label>}
        <div className="grid gap-4 md:grid-cols-2">
          <div><h3 className="mb-2 text-sm font-bold">Original Shopify product</h3>{post.product?.images?.[0]?.url&&<img src={post.product.images[0].url} alt="Original product reference" className="max-h-[550px] w-full rounded-xl bg-slate-50 object-contain"/>}</div>
          <div><h3 className="mb-2 text-sm font-bold">Generated post to publish</h3>{image?<img key={image.slice(-80)} src={image} onLoad={()=>setImageReady(true)} onError={()=>{setImageReady(false);setError('The generated image could not be loaded. Reopen the review before approving.')}} alt="Generated candidate for manual approval" className="max-h-[550px] w-full rounded-xl bg-slate-50 object-contain"/>:<div className="rounded-xl bg-amber-50 p-6 text-sm">The previous generated image was not retained. Generate one replacement to review it here. This uses one image-generation attempt and stays held for your approval.</div>}</div>
        </div>
        <div className="rounded-xl border p-4"><h3 className="font-bold">AI review · {review.decision||'unavailable'}</h3><p className="mt-2 text-sm">{review.summary_en}</p><div className="mt-3 flex flex-wrap gap-2">{Object.entries(review.score_breakdown||{}).map(([key,value])=><span key={key} className="rounded-lg bg-slate-100 p-2 text-xs">{key.replaceAll('_',' ')}: {String(value)}/100</span>)}</div>{findings.filter(key=>review[key]?.length).map(key=><div key={key} className="mt-3"><h4 className="text-sm font-semibold capitalize">{key.replaceAll('_',' ')}</h4><ul className="mt-1 list-disc pl-5 text-sm text-rose-800">{review[key].map((text:string,index:number)=><li key={index}>{text}</li>)}</ul></div>)}</div>
        <div><h3 className="mb-2 font-bold">Caption to publish</h3><p dir="rtl" lang="ar" className="whitespace-pre-line rounded-xl bg-slate-50 p-4 text-right leading-7">{post.publish_caption||post.strategy?.caption_ar}</p></div>
        {Object.entries(post.error?.platform_errors||{}).map(([platform,message])=><p key={platform} className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><b>{platform}:</b> {String(message)}</p>)}
        {canApprove&&image&&<div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm">Manual approval overrides the AI review for this image. The original findings remain saved. Publishing will start now on Facebook and Instagram; missing platform permissions can still block delivery.</p><label className="block text-sm">Review note (optional)<textarea maxLength={1000} value={note} onChange={event=>setNote(event.target.value)} className="mt-1 w-full rounded-lg border p-2"/></label><label className="flex gap-3 text-sm"><input type="checkbox" checked={accepted} onChange={event=>setAccepted(event.target.checked)} className="mt-1"/>I compared this image with the product, reviewed the caption and findings, and approve this candidate for publication.</label><button disabled={!!busy||!accepted||!imageReady} onClick={publish} className="rounded-xl bg-fuchsia-600 px-4 py-3 font-semibold text-white disabled:opacity-40">Approve and publish now</button></div>}
        {!image&&['rejected','needs_review','failed'].includes(post.status)&&<button disabled={!!busy} onClick={regenerate} className="rounded-xl bg-slate-950 px-4 py-3 font-semibold text-white disabled:opacity-40">Generate replacement for review</button>}
      </>}
    </div>
  </dialog>
}
