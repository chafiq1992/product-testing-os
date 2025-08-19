'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import Dropzone from '@/components/Dropzone'
import TagsInput from '@/components/TagsInput'
import { launchTest } from '@/lib/api'

export default function Page(){
  const [audience,setAudience]=useState('Parents of toddlers in Morocco')
  const [title,setTitle]=useState('')
  const [price,setPrice]=useState<number|''>('')
  const [benefits,setBenefits]=useState<string[]>(['Comfy all-day wear'])
  const [pains,setPains]=useState<string[]>(['Kids scuff shoes'])
  const [files,setFiles]=useState<File[]>([])
  const [loading,setLoading]=useState(false)
  const [result,setResult]=useState<{test_id:string,status:string}|null>(null)

  async function onLaunch(){
    setLoading(true)
    try{
      const res = await launchTest({audience, benefits, pain_points:pains, base_price: price===''?undefined:Number(price), title: title||undefined, images: files})
      setResult(res)
    }finally{ setLoading(false) }
  }

  return (
    <div className="container">
      <h1 className="text-2xl font-bold mb-4">Product Testing OS</h1>
      <div className="grid md:grid-cols-2 gap-6">
        <motion.div className="card p-6" initial={{opacity:0,y:10}} animate={{opacity:1,y:0}}>
          <div className="space-y-4">
            <div>
              <div className="label mb-1">Audience</div>
              <input className="input w-full" value={audience} onChange={e=>setAudience(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="label mb-1">Optional title</div>
                <input className="input w-full" value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Doll Sneakers – Pink" />
              </div>
              <div>
                <div className="label mb-1">Base price (MAD)</div>
                <input className="input w-full" value={price} onChange={e=> setPrice(e.target.value===''?'':Number(e.target.value)) } placeholder="189" />
              </div>
            </div>
            <div>
              <div className="label mb-2">Key benefits</div>
              <TagsInput value={benefits} onChange={setBenefits} placeholder="Add benefit & Enter" />
            </div>
            <div>
              <div className="label mb-2">Pain points</div>
              <TagsInput value={pains} onChange={setPains} placeholder="Add pain & Enter" />
            </div>
            <div>
              <div className="label mb-2">Images (optional)</div>
              <Dropzone files={files} onFiles={setFiles} />
            </div>
            <div className="flex gap-3 pt-2">
              <button disabled={loading} onClick={onLaunch} className="btn btn-primary disabled:opacity-60">{loading?'Launching…':'Launch test'}</button>
              <button onClick={()=>{setAudience('');setTitle('');setPrice('');setBenefits([]);setPains([]);setFiles([]);setResult(null)}} className="btn btn-ghost">Reset</button>
            </div>
          </div>
        </motion.div>

        <motion.div className="card p-6" initial={{opacity:0,y:10}} animate={{opacity:1,y:0}}>
          <h2 className="text-lg font-semibold mb-3">Review</h2>
          <ul className="text-slate-300 text-sm space-y-2">
            <li><strong>Audience:</strong> {audience||'—'}</li>
            <li><strong>Title:</strong> {title||'—'}</li>
            <li><strong>Price:</strong> {price||'—'}</li>
            <li><strong>Benefits:</strong> {benefits.join(', ')||'—'}</li>
            <li><strong>Pain points:</strong> {pains.join(', ')||'—'}</li>
            <li><strong>Images:</strong> {files.length}</li>
          </ul>
          {result && (
            <div className="mt-6 p-4 rounded-lg bg-[#0c122a] border border-slate-700">
              <div className="text-sm text-slate-300">Queued test <span className="font-mono">{result.test_id}</span></div>
              <div className="text-xs text-slate-400 mt-2">Pipeline will generate angles & images, create Shopify page and a paused Meta campaign.</div>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  )
}
