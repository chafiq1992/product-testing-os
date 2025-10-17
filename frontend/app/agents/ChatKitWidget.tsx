"use client"
import { useMemo } from 'react'
import { ChatKit, useChatKit } from '@openai/chatkit-react'
import type { ChatKitOptions } from '@openai/chatkit'

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

  const options: ChatKitOptions = {
    api: {},
    theme: {
      colorScheme: 'light',
      radius: 'pill',
      density: 'normal',
      typography: {
        baseSize: 16,
        fontFamily: '"OpenAI Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
        fontFamilyMono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace',
        fontSources: [
          {
            family: 'OpenAI Sans',
            src: 'https://cdn.openai.com/common/fonts/openai-sans/v2/OpenAISans-Regular.woff2',
            weight: 400,
            style: 'normal',
            display: 'swap',
          },
        ],
      },
    },
    composer: {
      attachments: { enabled: true, maxCount: 5, maxSize: 10485760 },
      tools: [
        {
          id: 'search_docs',
          label: 'Search docs',
          shortLabel: 'Docs',
          placeholderOverride: 'Search documentation',
          icon: 'book-open',
          pinned: false,
        },
      ],
    },
    startScreen: {
      greeting: '',
      prompts: [
        { icon: 'circle-question', label: 'What is ChatKit?', prompt: 'What is ChatKit?' },
      ],
    },
  }

  return (
    <div className="w-full flex items-center justify-center relative z-50 pointer-events-auto isolate">
      <ChatKit control={control} options={options} className="h-[640px] w-full max-w-[480px] bg-white" />
    </div>
  )
}


