"use client"
import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export default function AdsRedirect(){
  const params = useSearchParams()
  const router = useRouter()
  useEffect(()=>{
    const id = params.get('id') || params.get('flow')
    if(id){ router.replace(`/studio/?id=${id}&mode=promotion`) }
    else{ router.replace(`/studio/?mode=promotion`) }
  },[params, router])
  return <div className="p-4 text-sm text-slate-500">Loading…</div>
}


