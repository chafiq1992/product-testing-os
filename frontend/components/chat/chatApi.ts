// Minimal API layer for the internal chat/inbox.
// Same-origin in production (FastAPI serves the static export); honours
// NEXT_PUBLIC_API_BASE_URL when the API lives on another host.

const API = process.env.NEXT_PUBLIC_API_BASE_URL || ''

export type ChatAccount = {
  id: string
  handle: string
  name: string
  avatar: string
  kind?: string
  online?: boolean
  last_seen?: string | null
}

export type ChatMessage = {
  id: string
  conversation_id?: string
  sender_id: string
  recipient_id: string
  type: 'text' | 'image' | 'video' | 'audio' | 'file'
  text?: string | null
  media_url?: string | null
  media_mime?: string | null
  media_name?: string | null
  duration?: string | null
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed'
  created_at?: string | null
  read_at?: string | null
  client_id?: string
}

export type Conversation = {
  peer: ChatAccount
  last_message: ChatMessage | null
  unread: number
}

export type Me = { id: string; handle?: string; name?: string; avatar?: string; kind?: string }

function abs(path: string) {
  return `${API}${path}`
}

// Resolve a (possibly relative) media url against the API host so it renders
// even when the frontend is served from a different origin.
export function mediaUrl(url?: string | null): string {
  if (!url) return ''
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:')) return url
  return `${API}${url.startsWith('/') ? '' : '/'}${url}`
}

export function wsUrl(accountId: string): string {
  let base = API
  if (!base && typeof window !== 'undefined') base = window.location.origin
  const proto = base.startsWith('https') ? 'wss' : base.startsWith('http') ? 'ws'
    : (typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss' : 'ws')
  const host = base.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return `${proto}://${host}/api/chat/ws/${encodeURIComponent(accountId)}`
}

async function jget(path: string) {
  const res = await fetch(abs(path))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
async function jpost(path: string, body: object) {
  const res = await fetch(abs(path), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function registerAccount(me: Me): Promise<ChatAccount> {
  const { data } = await jpost('/api/chat/register', {
    id: me.id, handle: me.handle || me.id, name: me.name || me.id, avatar: me.avatar || '', kind: me.kind || '',
  })
  return data
}

export async function searchAccounts(q: string, me: string): Promise<ChatAccount[]> {
  const { data } = await jget(`/api/chat/search?q=${encodeURIComponent(q)}&me=${encodeURIComponent(me)}`)
  return data || []
}

export async function getAccount(id: string): Promise<ChatAccount | null> {
  try {
    const { data } = await jget(`/api/chat/account/${encodeURIComponent(id)}`)
    return data || null
  } catch { return null }
}

export async function fetchConversations(me: string): Promise<Conversation[]> {
  const { data } = await jget(`/api/chat/conversations?me=${encodeURIComponent(me)}`)
  return data || []
}

export async function fetchMessages(me: string, peer: string, before?: string): Promise<ChatMessage[]> {
  const q = `me=${encodeURIComponent(me)}&peer=${encodeURIComponent(peer)}${before ? `&before=${encodeURIComponent(before)}` : ''}`
  const { data } = await jget(`/api/chat/messages?${q}`)
  return data || []
}

export async function markRead(me: string, peer: string): Promise<void> {
  try { await jpost('/api/chat/read', { me, peer }) } catch {}
}

export async function sendMessageHttp(payload: {
  sender: string; recipient: string; type?: string; text?: string
  media_url?: string; media_mime?: string; media_name?: string; duration?: string; client_id?: string
}): Promise<ChatMessage> {
  const { data, error } = await jpost('/api/chat/send', payload)
  if (error) throw new Error(error)
  return data
}

export async function uploadMedia(file: Blob, kind: string, filename?: string): Promise<{
  url: string; mime: string; name: string; size: number
}> {
  const fd = new FormData()
  fd.append('file', file, filename || (file as File).name || 'media')
  fd.append('kind', kind)
  const res = await fetch(abs('/api/chat/upload'), { method: 'POST', body: fd })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const { data, error } = await res.json()
  if (error) throw new Error(error)
  return data
}
