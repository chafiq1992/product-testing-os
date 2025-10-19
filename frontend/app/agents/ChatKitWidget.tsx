"use client"
import { useMemo } from 'react'
import { ChatKit, useChatKit } from '@openai/chatkit-react'

export default function ChatKitWidget(){
  const WORKFLOW_ID = process.env.NEXT_PUBLIC_CHATKIT_WORKFLOW_ID || process.env.NEXT_PUBLIC_CHATKIT_WORKFLOW || undefined
  const WORKFLOW_VERSION = process.env.NEXT_PUBLIC_CHATKIT_WORKFLOW_VERSION || undefined
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

  async function getClientSecret(existing: string | null){
    if(existing){
      // Optionally implement refresh policy
    }
    const base = process.env.NEXT_PUBLIC_API_BASE_URL || ''
    const res = await fetch(`${base}/api/chatkit/session`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({
        user: deviceId,
        workflow_id: WORKFLOW_ID, // allow frontend override if backend env not set
        version: WORKFLOW_VERSION,
      })
    })
    if(!res.ok){
      console.error('ChatKit session fetch failed', res.status)
      throw new Error(`ChatKit session HTTP ${res.status}`)
    }
    const data = await res.json()
    if(!data?.client_secret){
      const err = (data && (data.error || data.details)) ? JSON.stringify(data) : 'missing client_secret'
      console.error('ChatKit missing client_secret', err)
      throw new Error(`ChatKit session error: ${err}`)
    }
    return data?.client_secret as string
  }

  const { control } = useChatKit({
    // Fallback to OpenAI-hosted session if server-mode is disabled
    api: { getClientSecret },
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
  })

  return (
    <div className="w-full flex items-center justify-center relative z-50 pointer-events-auto isolate">
      <ChatKit control={control} className="h-[640px] w-full max-w-[480px] bg-white" />
    </div>
  )
}


