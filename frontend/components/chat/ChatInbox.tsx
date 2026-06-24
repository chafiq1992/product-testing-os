"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Search, Send, Paperclip, Mic, X, ArrowLeft, Check, CheckCheck,
  ImageIcon, Play, Pause, Trash2, Loader2, MessageSquare, Circle,
} from 'lucide-react'
import {
  ChatAccount, ChatMessage, Conversation, Me,
  registerAccount, searchAccounts, fetchConversations, fetchMessages,
  markRead, sendMessageHttp, uploadMedia, mediaUrl, wsUrl,
} from './chatApi'
import { useAudioRecorder } from './useAudioRecorder'

function uuid() {
  try { return crypto.randomUUID() } catch { return `id_${Date.now()}_${Math.random().toString(36).slice(2)}` }
}

function timeLabel(iso?: string | null) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch { return '' }
}

function dayLabel(iso?: string | null) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const today = new Date()
    const yest = new Date(); yest.setDate(today.getDate() - 1)
    if (d.toDateString() === today.toDateString()) return 'Today'
    if (d.toDateString() === yest.toDateString()) return 'Yesterday'
    return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return '' }
}

function mimeToType(mime: string): ChatMessage['type'] {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'file'
}

function Avatar({ name, avatar, online, size = 44 }: { name: string; avatar?: string; online?: boolean; size?: number }) {
  const initial = (name || '?').charAt(0).toUpperCase()
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {avatar
        ? <img src={mediaUrl(avatar)} alt={name} className="rounded-full object-cover w-full h-full" />
        : <div className="rounded-full w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-indigo-600 text-white font-bold" style={{ fontSize: size * 0.4 }}>{initial}</div>}
      {online !== undefined && (
        <span className={`absolute bottom-0 right-0 block rounded-full ring-2 ring-white ${online ? 'bg-green-500' : 'bg-slate-300'}`} style={{ width: size * 0.28, height: size * 0.28 }} />
      )}
    </div>
  )
}

function AudioPlayer({ src }: { src: string }) {
  const ref = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  return (
    <div className="flex items-center gap-2 min-w-[160px]">
      <button
        type="button"
        onClick={() => { const a = ref.current; if (!a) return; if (a.paused) { a.play(); setPlaying(true) } else { a.pause(); setPlaying(false) } }}
        className="h-9 w-9 shrink-0 rounded-full bg-black/10 hover:bg-black/20 flex items-center justify-center"
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <div className="flex-1 h-1.5 rounded-full bg-black/15" />
      <audio ref={ref} src={src} onEnded={() => setPlaying(false)} className="hidden" />
    </div>
  )
}

function MessageView({ m, mine }: { m: ChatMessage; mine: boolean }) {
  const url = mediaUrl(m.media_url)
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'} px-3`}>
      <div className={`max-w-[78%] rounded-2xl px-3 py-2 shadow-sm text-[15px] leading-snug ${mine ? 'bg-blue-600 text-white rounded-br-sm' : 'bg-white text-slate-800 rounded-bl-sm border border-slate-200'}`}>
        {m.type === 'image' && url && (
          <a href={url} target="_blank" rel="noreferrer">
            <img src={url} alt={m.media_name || 'image'} className="rounded-lg max-h-72 object-cover mb-1" />
          </a>
        )}
        {m.type === 'video' && url && (
          <video src={url} controls className="rounded-lg max-h-72 mb-1" />
        )}
        {m.type === 'audio' && url && <AudioPlayer src={url} />}
        {m.type === 'file' && url && (
          <a href={url} target="_blank" rel="noreferrer" className={`flex items-center gap-2 underline ${mine ? 'text-white' : 'text-blue-600'}`}>
            <Paperclip size={14} /> {m.media_name || 'file'}
          </a>
        )}
        {m.text && <div className="whitespace-pre-wrap break-words">{m.text}</div>}
        <div className={`flex items-center gap-1 justify-end mt-0.5 text-[10px] ${mine ? 'text-blue-100' : 'text-slate-400'}`}>
          <span>{timeLabel(m.created_at)}</span>
          {mine && (
            m.status === 'sending' ? <Loader2 size={11} className="animate-spin" />
              : m.status === 'failed' ? <span className="text-red-200">!</span>
              : m.status === 'read' ? <CheckCheck size={13} className="text-sky-200" />
              : m.status === 'delivered' ? <CheckCheck size={13} />
              : <Check size={13} />
          )}
        </div>
      </div>
    </div>
  )
}

export default function ChatInbox({ me, className = '', heightClass = 'h-[calc(100vh-7rem)]' }: {
  me: Me
  className?: string
  heightClass?: string
}) {
  const meId = (me.id || '').toLowerCase()
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activePeer, setActivePeer] = useState<ChatAccount | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loadingMsgs, setLoadingMsgs] = useState(false)
  const [text, setText] = useState('')
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set())
  const [typingPeer, setTypingPeer] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<ChatAccount[]>([])
  const [searching, setSearching] = useState(false)
  const [uploading, setUploading] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const seenIds = useRef<Set<string>>(new Set())
  const activePeerRef = useRef<ChatAccount | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const reconnectRef = useRef<number | null>(null)
  const pingRef = useRef<number | null>(null)
  const typingTimerRef = useRef<number | null>(null)
  const lastTypingSentRef = useRef(0)
  const imgInputRef = useRef<HTMLInputElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const recorder = useAudioRecorder()

  useEffect(() => { activePeerRef.current = activePeer }, [activePeer])

  const refreshConversations = useCallback(async () => {
    try { setConversations(await fetchConversations(meId)) } catch {}
  }, [meId])

  const isOnline = useCallback((id: string) => onlineIds.has((id || '').toLowerCase()), [onlineIds])

  // ── Conversation list bookkeeping ──────────────────────────
  const bumpConversation = useCallback((peerId: string, m: ChatMessage, incrementUnread: boolean) => {
    setConversations(prev => {
      const idx = prev.findIndex(c => c.peer.id === peerId)
      if (idx === -1) {
        // unknown peer — pull fresh list from server
        refreshConversations()
        return prev
      }
      const next = [...prev]
      const entry = { ...next[idx] }
      entry.last_message = m
      if (incrementUnread) entry.unread = (entry.unread || 0) + 1
      next.splice(idx, 1)
      return [entry, ...next]
    })
  }, [refreshConversations])

  // ── Incoming websocket events ──────────────────────────────
  const handleWsEvent = useCallback((evt: any) => {
    const type = evt?.type
    const data = evt?.data
    if (type === 'message' && data) {
      const peerId = data.sender_id === meId ? data.recipient_id : data.sender_id
      const ap = activePeerRef.current
      const inActive = ap && peerId === ap.id
      setMessages(prev => {
        // replace optimistic by client_id
        if (data.client_id) {
          const i = prev.findIndex(x => x.id === data.client_id || x.client_id === data.client_id)
          if (i !== -1) { const n = [...prev]; n[i] = data; seenIds.current.add(data.id); return n }
        }
        if (seenIds.current.has(data.id)) return prev
        seenIds.current.add(data.id)
        return inActive ? [...prev, data] : prev
      })
      const incoming = data.recipient_id === meId
      bumpConversation(peerId, data, incoming && !inActive)
      if (incoming && inActive) {
        markRead(meId, peerId)
        wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify({ type: 'read', data: { peer: peerId } }))
      }
    } else if (type === 'read' && data) {
      const ids = new Set<string>(data.message_ids || [])
      setMessages(prev => prev.map(x => ids.has(x.id) ? { ...x, status: 'read' } : x))
    } else if (type === 'presence' && data) {
      setOnlineIds(prev => { const n = new Set(prev); data.online ? n.add(data.id) : n.delete(data.id); return n })
    } else if (type === 'presence_snapshot' && data) {
      setOnlineIds(new Set((data.online || []).map((s: string) => s.toLowerCase())))
    } else if (type === 'typing' && data) {
      const ap = activePeerRef.current
      if (ap && data.peer === ap.id) {
        setTypingPeer(data.typing ? data.peer : null)
        if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current)
        if (data.typing) typingTimerRef.current = window.setTimeout(() => setTypingPeer(null), 3500)
      }
    }
  }, [meId, bumpConversation])

  // ── WebSocket lifecycle ────────────────────────────────────
  const connect = useCallback(() => {
    if (!meId) return
    try {
      const ws = new WebSocket(wsUrl(meId))
      wsRef.current = ws
      ws.onopen = () => {
        setConnected(true)
        if (pingRef.current) window.clearInterval(pingRef.current)
        pingRef.current = window.setInterval(() => {
          ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'ping' }))
        }, 25000)
      }
      ws.onmessage = (e) => { try { handleWsEvent(JSON.parse(e.data)) } catch {} }
      ws.onclose = () => {
        setConnected(false)
        if (pingRef.current) { window.clearInterval(pingRef.current); pingRef.current = null }
        if (reconnectRef.current) window.clearTimeout(reconnectRef.current)
        reconnectRef.current = window.setTimeout(connect, 2500)
      }
      ws.onerror = () => { try { ws.close() } catch {} }
    } catch {
      reconnectRef.current = window.setTimeout(connect, 3000)
    }
  }, [meId, handleWsEvent])

  useEffect(() => {
    if (!meId) return
    registerAccount(me).catch(() => {})
    refreshConversations()
    connect()
    return () => {
      if (pingRef.current) window.clearInterval(pingRef.current)
      if (reconnectRef.current) window.clearTimeout(reconnectRef.current)
      try { wsRef.current?.close() } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId])

  // ── Open a conversation ────────────────────────────────────
  const openPeer = useCallback(async (peer: ChatAccount) => {
    setActivePeer(peer)
    setSearchTerm(''); setSearchResults([])
    setTypingPeer(null)
    setLoadingMsgs(true)
    try {
      const msgs = await fetchMessages(meId, peer.id)
      msgs.forEach(m => seenIds.current.add(m.id))
      setMessages(msgs)
    } catch { setMessages([]) }
    setLoadingMsgs(false)
    markRead(meId, peer.id)
    wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify({ type: 'read', data: { peer: peer.id } }))
    setConversations(prev => prev.map(c => c.peer.id === peer.id ? { ...c, unread: 0 } : c))
  }, [meId])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, typingPeer])

  // ── Search ─────────────────────────────────────────────────
  useEffect(() => {
    const q = searchTerm.trim()
    if (!q) { setSearchResults([]); setSearching(false); return }
    setSearching(true)
    const t = window.setTimeout(async () => {
      try { setSearchResults(await searchAccounts(q, meId)) } catch { setSearchResults([]) }
      setSearching(false)
    }, 250)
    return () => window.clearTimeout(t)
  }, [searchTerm, meId])

  // ── Sending ────────────────────────────────────────────────
  const pushOptimistic = useCallback((peer: ChatAccount, partial: Partial<ChatMessage>): string => {
    const clientId = uuid()
    const optimistic: ChatMessage = {
      id: clientId, client_id: clientId, sender_id: meId, recipient_id: peer.id,
      type: 'text', status: 'sending', created_at: new Date().toISOString(), ...partial,
    }
    setMessages(prev => [...prev, optimistic])
    bumpConversation(peer.id, optimistic, false)
    return clientId
  }, [meId, bumpConversation])

  const dispatch = useCallback(async (peer: ChatAccount, clientId: string, payload: any) => {
    const ws = wsRef.current
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'send_message', data: { ...payload, recipient: peer.id, client_id: clientId } }))
      return
    }
    // HTTP fallback
    try {
      const saved = await sendMessageHttp({ sender: meId, recipient: peer.id, client_id: clientId, ...payload })
      setMessages(prev => prev.map(x => x.id === clientId ? saved : x))
      seenIds.current.add(saved.id)
    } catch {
      setMessages(prev => prev.map(x => x.id === clientId ? { ...x, status: 'failed' } : x))
    }
  }, [meId])

  const sendText = useCallback(() => {
    const peer = activePeer
    const body = text.trim()
    if (!peer || !body) return
    setText('')
    const clientId = pushOptimistic(peer, { type: 'text', text: body })
    dispatch(peer, clientId, { type: 'text', text: body })
  }, [activePeer, text, pushOptimistic, dispatch])

  const sendFiles = useCallback(async (files: FileList | null) => {
    const peer = activePeer
    if (!peer || !files || !files.length) return
    setUploading(true)
    for (const file of Array.from(files)) {
      const type = mimeToType(file.type || '')
      const clientId = pushOptimistic(peer, { type, media_url: URL.createObjectURL(file), media_name: file.name, media_mime: file.type })
      try {
        const up = await uploadMedia(file, type, file.name)
        await dispatch(peer, clientId, { type, media_url: up.url, media_mime: up.mime, media_name: up.name })
      } catch {
        setMessages(prev => prev.map(x => x.id === clientId ? { ...x, status: 'failed' } : x))
      }
    }
    setUploading(false)
  }, [activePeer, pushOptimistic, dispatch])

  const toggleRecord = useCallback(async () => {
    const peer = activePeer
    if (!peer) return
    if (!recorder.recording) { recorder.start(); return }
    const rec = await recorder.stop()
    if (!rec) return
    const clientId = pushOptimistic(peer, { type: 'audio', media_url: rec.url, duration: String(rec.duration), media_mime: rec.mime })
    try {
      const up = await uploadMedia(rec.blob, 'audio', `voice_${Date.now()}.webm`)
      await dispatch(peer, clientId, { type: 'audio', media_url: up.url, media_mime: up.mime, media_name: up.name, duration: String(rec.duration) })
    } catch {
      setMessages(prev => prev.map(x => x.id === clientId ? { ...x, status: 'failed' } : x))
    }
  }, [activePeer, recorder, pushOptimistic, dispatch])

  const onComposerKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText() }
  }

  const onTyping = () => {
    const peer = activePeerRef.current
    const ws = wsRef.current
    const now = Date.now()
    if (peer && ws?.readyState === WebSocket.OPEN && now - lastTypingSentRef.current > 1500) {
      lastTypingSentRef.current = now
      ws.send(JSON.stringify({ type: 'typing', data: { peer: peer.id, typing: true } }))
    }
  }

  // ── Render helpers ─────────────────────────────────────────
  const listItems = searchTerm.trim() ? searchResults.map(a => ({ peer: a, last_message: null as ChatMessage | null, unread: 0 })) : conversations

  const datedMessages = useMemo(() => {
    const out: Array<{ day?: string; m?: ChatMessage }> = []
    let lastDay = ''
    for (const m of messages) {
      const d = dayLabel(m.created_at)
      if (d !== lastDay) { out.push({ day: d }); lastDay = d }
      out.push({ m })
    }
    return out
  }, [messages])

  return (
    <div className={`flex ${heightClass} bg-slate-100 rounded-xl overflow-hidden border border-slate-200 ${className}`}>
      {/* ── Sidebar (conversation list) ── */}
      <aside className={`${activePeer ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-80 lg:w-96 bg-white border-r border-slate-200`}>
        <div className="p-3 border-b border-slate-200">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2"><MessageSquare size={20} className="text-blue-600" /> Chat</h2>
            <span className={`text-[11px] flex items-center gap-1 ${connected ? 'text-green-600' : 'text-slate-400'}`}>
              <Circle size={8} className={connected ? 'fill-green-500 text-green-500' : 'fill-slate-300 text-slate-300'} /> {connected ? 'Online' : 'Connecting'}
            </span>
          </div>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search by id, e.g. @username"
              className="w-full pl-9 pr-3 py-2 rounded-full bg-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {searching && <div className="p-4 text-center text-sm text-slate-400"><Loader2 size={16} className="animate-spin inline" /> Searching…</div>}
          {!searching && listItems.length === 0 && (
            <div className="p-6 text-center text-sm text-slate-400">
              {searchTerm.trim() ? 'No accounts found.' : 'No conversations yet. Search an id to start chatting.'}
            </div>
          )}
          {listItems.map(({ peer, last_message, unread }) => (
            <button
              key={peer.id}
              onClick={() => openPeer(peer)}
              className={`w-full flex items-center gap-3 px-3 py-3 hover:bg-slate-50 text-left border-b border-slate-100 ${activePeer?.id === peer.id ? 'bg-blue-50' : ''}`}
            >
              <Avatar name={peer.name} avatar={peer.avatar} online={isOnline(peer.id)} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900 truncate">{peer.name || peer.handle}</span>
                  <span className="text-[10px] text-slate-400 shrink-0">{timeLabel(last_message?.created_at)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500 truncate">
                    {last_message
                      ? (last_message.type === 'text' ? last_message.text : `📎 ${last_message.type}`)
                      : `@${peer.handle}`}
                  </span>
                  {unread > 0 && <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">{unread}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* ── Chat window ── */}
      <section className={`${activePeer ? 'flex' : 'hidden md:flex'} flex-col flex-1 bg-[#efeae2]`}>
        {!activePeer ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-2">
            <MessageSquare size={48} className="opacity-30" />
            <p className="text-sm">Select a conversation or search an id to start.</p>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 px-3 py-2.5 bg-white border-b border-slate-200">
              <button className="md:hidden p-1 text-slate-600" onClick={() => setActivePeer(null)}><ArrowLeft size={20} /></button>
              <Avatar name={activePeer.name} avatar={activePeer.avatar} online={isOnline(activePeer.id)} size={40} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-900 truncate">{activePeer.name || activePeer.handle}</div>
                <div className="text-[11px] text-slate-500">
                  {typingPeer === activePeer.id ? <span className="text-green-600">typing…</span> : isOnline(activePeer.id) ? 'online' : `@${activePeer.handle}`}
                </div>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto py-3 space-y-1.5" style={{ backgroundImage: 'radial-gradient(rgba(0,0,0,0.03) 1px, transparent 1px)', backgroundSize: '16px 16px' }}>
              {loadingMsgs && <div className="text-center text-sm text-slate-400 py-4"><Loader2 size={16} className="animate-spin inline" /></div>}
              {!loadingMsgs && messages.length === 0 && <div className="text-center text-sm text-slate-400 py-8">No messages yet. Say hi 👋</div>}
              {datedMessages.map((row, i) => row.day !== undefined
                ? <div key={`d-${i}`} className="flex justify-center my-2"><span className="text-[11px] bg-white/80 text-slate-500 px-2 py-0.5 rounded-full shadow-sm">{row.day}</span></div>
                : <MessageView key={row.m!.id} m={row.m!} mine={row.m!.sender_id === meId} />
              )}
              <div ref={bottomRef} />
            </div>

            {/* Composer */}
            <div className="px-2 py-2 bg-white border-t border-slate-200">
              {recorder.recording ? (
                <div className="flex items-center gap-3 px-2">
                  <button onClick={recorder.cancel} className="text-red-500 p-2"><Trash2 size={20} /></button>
                  <div className="flex-1 flex items-center gap-2 text-red-500">
                    <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-pulse" />
                    <span className="font-mono text-sm">{Math.floor(recorder.elapsed / 60)}:{String(recorder.elapsed % 60).padStart(2, '0')}</span>
                    <span className="text-slate-400 text-sm">recording…</span>
                  </div>
                  <button onClick={toggleRecord} className="h-10 w-10 rounded-full bg-blue-600 text-white flex items-center justify-center"><Send size={18} /></button>
                </div>
              ) : (
                <div className="flex items-end gap-2">
                  <button onClick={() => imgInputRef.current?.click()} className="p-2 text-slate-500 hover:text-blue-600" title="Photo / video"><ImageIcon size={22} /></button>
                  <button onClick={() => fileInputRef.current?.click()} className="p-2 text-slate-500 hover:text-blue-600" title="Attach file"><Paperclip size={22} /></button>
                  <textarea
                    value={text}
                    onChange={e => { setText(e.target.value); onTyping() }}
                    onKeyDown={onComposerKey}
                    rows={1}
                    placeholder="Type a message"
                    className="flex-1 resize-none max-h-32 px-3 py-2 rounded-2xl bg-slate-100 text-[15px] focus:outline-none focus:ring-2 focus:ring-blue-300"
                  />
                  {uploading && <Loader2 size={18} className="animate-spin text-slate-400 mb-2" />}
                  {text.trim()
                    ? <button onClick={sendText} className="h-10 w-10 shrink-0 rounded-full bg-blue-600 text-white flex items-center justify-center"><Send size={18} /></button>
                    : <button onClick={toggleRecord} className="h-10 w-10 shrink-0 rounded-full bg-blue-600 text-white flex items-center justify-center" title="Record voice"><Mic size={18} /></button>}
                </div>
              )}
              {recorder.error && <p className="text-xs text-red-500 px-2 pt-1">Mic error: {recorder.error}</p>}
            </div>
          </>
        )}
      </section>

      <input ref={imgInputRef} type="file" accept="image/*,video/*" multiple hidden onChange={e => { sendFiles(e.target.files); e.target.value = '' }} />
      <input ref={fileInputRef} type="file" multiple hidden onChange={e => { sendFiles(e.target.files); e.target.value = '' }} />
    </div>
  )
}
