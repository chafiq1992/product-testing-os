"use client"
import { useMemo } from 'react'
import { ChatKit, useChatKit } from '@openai/chatkit-react'

export default function ChatKitWidget(){
  const deviceId = useMemo(()=>{
    try{
      const key = 'chatkit_device_id'
      const existing = typeof window!== 'undefined'? localStorage.getItem(key) : null
      if(existing) return existing
      const v = crypto?.randomUUID?.() || Math.random().toString(36).slice(2)
      if(typeof window!=='undefined') localStorage.setItem(key, v)
      return v
    }catch{ return 'anon' }
  },[])

  const { control } = useChatKit({
    api: {
      async getClientSecret(existing){
        if(existing){
          // Optionally implement refresh by calling the same endpoint
        }
        const base = process.env.NEXT_PUBLIC_API_BASE_URL || ''
        const res = await fetch(`${base}/api/chatkit/session`, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ user: deviceId }) })
        if(!res.ok){
          console.error('ChatKit session fetch failed', res.status)
          return undefined
        }
        const data = await res.json()
        if(!data?.client_secret){
          console.error('ChatKit missing client_secret', data)
        }
        return data?.client_secret
      },
    },
  })

  return (
    <div className="w-full flex items-center justify-center">
      <ChatKit control={control} className="h-[600px] w-full max-w-[420px]" />
    </div>
  )
}


