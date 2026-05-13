"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  Bot,
  CheckCircle2,
  Code2,
  ExternalLink,
  Home,
  Loader2,
  RefreshCw,
  Send,
  ShieldCheck,
  Store,
  User,
} from "lucide-react"

type ThemeStatus = {
  connected?: boolean
  store?: string
  shop?: string
  theme_gid?: string
  swatches_installed?: boolean
  files?: { layout?: boolean; snippet?: boolean; section?: boolean }
}

type ChatMessage = {
  id: string
  role: "agent" | "system" | "user"
  text: string
  filesChanged?: string[]
  filesConsidered?: string[]
  filesSentToModel?: string[]
  themeFileCount?: number
}

const STORES = ["irrakids", "irranova", "mmd"]

const EXAMPLES = [
  "Under the buy button, add 4 trust items using our theme default layout: 1 delivery, 2 exchange, 3 secure payment, 4 support.",
  "Find the product pricing section and make it cleaner on mobile without changing checkout behavior.",
  "Add a wholesale trust card under the product form only for wholesale-tagged products.",
]

function messageId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export default function ThemeEditorPage() {
  const apiBase = useMemo(() => process.env.NEXT_PUBLIC_API_BASE_URL || "", [])
  const [store, setStore] = useState("irrakids")
  const [status, setStatus] = useState<ThemeStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [running, setRunning] = useState(false)
  const [prompt, setPrompt] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: messageId(),
      role: "agent",
      text: "Tell me what you want changed in the Shopify theme. I will inspect the active theme files, edit the exact matching code, and report which files changed.",
    },
  ])
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem("ptos_store")
      if (saved && STORES.includes(saved)) setStore(saved)
    } catch {}
  }, [])

  useEffect(() => {
    refreshStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages, running])

  function addMessage(item: Omit<ChatMessage, "id">) {
    setMessages(prev => [...prev, { id: messageId(), ...item }].slice(-30))
  }

  async function readApiResponse(res: Response) {
    const text = await res.text()
    let json: any = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      const fallback = text.trim() || `Request failed with status ${res.status}`
      return { error: fallback, data: null }
    }
    if (!res.ok && !json?.error) {
      return { error: `Request failed with status ${res.status}`, data: json?.data || null }
    }
    return json || {}
  }

  async function refreshStatus() {
    setLoadingStatus(true)
    try {
      const res = await fetch(`${apiBase}/api/theme-editor/status?store=${encodeURIComponent(store)}`)
      const json = await readApiResponse(res)
      if (json?.error) {
        setStatus(json?.data || { connected: false, store })
        addMessage({ role: "system", text: json.error })
      } else {
        setStatus(json?.data || null)
      }
    } catch (err: any) {
      setStatus({ connected: false, store })
      addMessage({ role: "system", text: err?.message || "Could not load theme status." })
    } finally {
      setLoadingStatus(false)
    }
  }

  async function runAgent(actionPrompt = prompt) {
    const text = actionPrompt.trim()
    if (!text || running) return
    setRunning(true)
    setPrompt("")
    addMessage({ role: "user", text })
    try {
      const res = await fetch(`${apiBase}/api/theme-editor/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store, prompt: text }),
      })
      const json = await readApiResponse(res)
      if (json?.error) {
        addMessage({ role: "system", text: json.error })
      } else {
        const data = json?.data || {}
        const changed = Array.isArray(data.files_changed) ? data.files_changed : []
        const considered = Array.isArray(data.files_considered) ? data.files_considered : []
        const sentToModel = Array.isArray(data.files_sent_to_model) ? data.files_sent_to_model : []
        const failed = Array.isArray(data.failed_edits) && data.failed_edits.length > 0
          ? " Some edits could not be applied because the exact code did not match."
          : ""
        addMessage({
          role: "agent",
          text: `${data.message || "Theme action completed."}${failed}`,
          filesChanged: changed,
          filesConsidered: considered,
          filesSentToModel: sentToModel,
          themeFileCount: typeof data.theme_file_count === "number" ? data.theme_file_count : undefined,
        })
        await refreshStatus()
      }
    } catch (err: any) {
      addMessage({ role: "system", text: err?.message || "Theme action failed." })
    } finally {
      setRunning(false)
    }
  }

  function handleStoreChange(value: string) {
    setStore(value)
    try { localStorage.setItem("ptos_store", value) } catch {}
  }

  function onComposerKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      runAgent()
    }
  }

  const connected = !!status?.connected
  const themeId = status?.theme_gid?.split("/").pop() || "Not loaded"

  return (
    <div className="flex min-h-screen bg-[#f7f7f8] text-slate-950">
      <aside className="hidden w-72 shrink-0 border-r border-slate-200 bg-white p-4 lg:block">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-blue-50 text-blue-600">
            <Bot size={21} />
          </div>
          <div>
            <h1 className="text-sm font-black">Theme Agent</h1>
            <p className="text-xs font-semibold text-slate-500">OpenAI + Shopify theme code</p>
          </div>
        </div>

        <div className="space-y-4">
          <section>
            <label className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-400">
              <Store size={14} /> Store
            </label>
            <select
              value={store}
              onChange={e => handleStoreChange(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
            >
              {STORES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-black uppercase tracking-widest text-slate-400">Active Theme</span>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${connected ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                {connected ? "Connected" : "Offline"}
              </span>
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Shop</p>
                <p className="mt-1 break-all font-bold">{status?.shop || "Not connected"}</p>
              </div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-400">Theme ID</p>
                <p className="mt-1 font-mono text-xs font-bold">{themeId}</p>
              </div>
            </div>
            <button
              onClick={refreshStatus}
              disabled={loadingStatus}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {loadingStatus ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
              Refresh
            </button>
          </section>

          <section className="space-y-2">
            <Link href="/shopify-connect" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100">
              <ShieldCheck size={16} /> OAuth
            </Link>
            <Link href="/" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100">
              <Home size={16} /> Home
            </Link>
            {status?.shop && (
              <a href={`https://${status.shop}`} target="_blank" className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-blue-600 hover:bg-blue-50">
                <ExternalLink size={16} /> Open Store
              </a>
            )}
          </section>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-2xl bg-blue-50 text-blue-600">
                <Bot size={19} />
              </div>
              <div>
                <h1 className="text-sm font-black">Theme Agent</h1>
                <p className="text-xs font-semibold text-slate-500">{connected ? "Connected" : "Select store"}</p>
              </div>
            </div>
            <select
              value={store}
              onChange={e => handleStoreChange(e.target.value)}
              className="max-w-[130px] rounded-xl border border-slate-200 bg-white px-2 py-2 text-xs font-bold outline-none"
            >
              {STORES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4">
          <div className="flex-1 space-y-6 py-8">
            {messages.map(message => (
              <div key={message.id} className={`flex gap-3 ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                {message.role !== "user" && (
                  <div className={`mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full ${message.role === "system" ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"}`}>
                    {message.role === "system" ? <Code2 size={16} /> : <Bot size={16} />}
                  </div>
                )}
                <div className={`max-w-[82%] rounded-[22px] px-4 py-3 text-[15px] leading-7 shadow-sm ${
                  message.role === "user"
                    ? "bg-blue-600 text-white"
                    : message.role === "system"
                      ? "border border-red-100 bg-red-50 text-red-700"
                      : "border border-slate-200 bg-white text-slate-800"
                }`}>
                  <p className="whitespace-pre-wrap">{message.text}</p>
                  {message.role === "agent" && (message.filesChanged?.length || message.filesSentToModel?.length || message.filesConsidered?.length || message.themeFileCount) ? (
                    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-xs font-semibold text-slate-500">
                      {message.themeFileCount ? <p>Theme files found: {message.themeFileCount}</p> : null}
                      {message.filesChanged?.length ? <p>Changed: {message.filesChanged.join(", ")}</p> : null}
                      {message.filesSentToModel?.length ? <p>Sent to model: {message.filesSentToModel.slice(0, 8).join(", ")}{message.filesSentToModel.length > 8 ? "..." : ""}</p> : null}
                      {!message.filesSentToModel?.length && message.filesConsidered?.length ? <p>Read from Shopify: {message.filesConsidered.slice(0, 8).join(", ")}{message.filesConsidered.length > 8 ? "..." : ""}</p> : null}
                    </div>
                  ) : null}
                </div>
                {message.role === "user" && (
                  <div className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-900 text-white">
                    <User size={15} />
                  </div>
                )}
              </div>
            ))}
            {running && (
              <div className="flex justify-start gap-3">
                <div className="mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-600">
                  <Bot size={16} />
                </div>
                <div className="rounded-[22px] border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-500 shadow-sm">
                  <span className="inline-flex items-center gap-2"><Loader2 className="animate-spin" size={16} /> Reading theme files and editing code...</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="sticky bottom-0 bg-gradient-to-t from-[#f7f7f8] via-[#f7f7f8] to-transparent pb-5 pt-4">
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
              {EXAMPLES.map(example => (
                <button
                  key={example}
                  onClick={() => setPrompt(example)}
                  disabled={running}
                  className="shrink-0 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 shadow-sm hover:border-blue-200 hover:text-blue-700 disabled:opacity-60"
                >
                  {example.length > 76 ? `${example.slice(0, 76)}...` : example}
                </button>
              ))}
            </div>

            <div className="rounded-[26px] border border-slate-200 bg-white p-2 shadow-xl shadow-slate-200/70">
              <div className="flex items-end gap-2">
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  onKeyDown={onComposerKeyDown}
                  rows={1}
                  placeholder="Message the theme agent..."
                  className="max-h-40 min-h-[52px] flex-1 resize-none rounded-[20px] bg-transparent px-4 py-3 text-[15px] font-medium leading-6 outline-none placeholder:text-slate-400"
                />
                <button
                  onClick={() => runAgent()}
                  disabled={running || !prompt.trim()}
                  className="mb-1 grid h-11 w-11 shrink-0 place-items-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-100 transition hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
                  title="Send"
                >
                  {running ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                </button>
              </div>
            </div>
            <div className="mt-2 flex items-center justify-center gap-2 text-[11px] font-semibold text-slate-400">
              <CheckCircle2 size={13} />
              The agent reads your active Shopify theme and applies exact file edits through OAuth.
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
