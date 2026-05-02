"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import {
  Bot,
  CheckCircle2,
  ExternalLink,
  Layers3,
  Loader2,
  Palette,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Store,
} from "lucide-react"

type ThemeStatus = {
  connected?: boolean
  store?: string
  shop?: string
  theme_gid?: string
  swatches_installed?: boolean
  files?: { layout?: boolean; snippet?: boolean; section?: boolean }
}

type LogItem = {
  role: "agent" | "system" | "user"
  text: string
}

const STORES = ["irrakids", "irranova", "mmd"]

export default function ThemeEditorPage() {
  const apiBase = useMemo(() => process.env.NEXT_PUBLIC_API_BASE_URL || "", [])
  const [store, setStore] = useState("irrakids")
  const [status, setStatus] = useState<ThemeStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [running, setRunning] = useState(false)
  const [prompt, setPrompt] = useState("Improve the product pricing section in the theme. Keep the current layout, but make the price block cleaner and easier to read on mobile.")
  const [logs, setLogs] = useState<LogItem[]>([
    { role: "agent", text: "OpenAI theme agent ready. Select a Shopify store, then describe the theme code change you want." },
  ])

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

  function addLog(item: LogItem) {
    setLogs(prev => [item, ...prev].slice(0, 8))
  }

  async function refreshStatus() {
    setLoadingStatus(true)
    try {
      const res = await fetch(`${apiBase}/api/theme-editor/status?store=${encodeURIComponent(store)}`)
      const json = await res.json()
      if (json?.error) {
        setStatus(json?.data || { connected: false, store })
        addLog({ role: "system", text: json.error })
      } else {
        setStatus(json?.data || null)
      }
    } catch (err: any) {
      setStatus({ connected: false, store })
      addLog({ role: "system", text: err?.message || "Could not load theme status." })
    } finally {
      setLoadingStatus(false)
    }
  }

  async function runAgent(actionPrompt = prompt) {
    const text = actionPrompt.trim()
    if (!text) return
    setRunning(true)
    addLog({ role: "user", text })
    try {
      const res = await fetch(`${apiBase}/api/theme-editor/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store, prompt: text }),
      })
      const json = await res.json()
      if (json?.error) {
        addLog({ role: "system", text: json.error })
      } else {
        const changed = Array.isArray(json?.data?.files_changed) && json.data.files_changed.length
          ? ` Changed: ${json.data.files_changed.join(", ")}.`
          : ""
        const failed = Array.isArray(json?.data?.failed_edits) && json.data.failed_edits.length
          ? ` Some edits could not be applied exactly.`
          : ""
        addLog({ role: "agent", text: `${json?.data?.message || "Theme action completed."}${changed}${failed}` })
        await refreshStatus()
      }
    } catch (err: any) {
      addLog({ role: "system", text: err?.message || "Theme action failed." })
    } finally {
      setRunning(false)
    }
  }

  function handleStoreChange(value: string) {
    setStore(value)
    try { localStorage.setItem("ptos_store", value) } catch {}
  }

  const connected = !!status?.connected
  const installed = !!status?.swatches_installed
  const themeId = status?.theme_gid?.split("/").pop() || "Not loaded"

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-950 text-white">
              <Layers3 size={20} />
            </div>
            <div>
              <h1 className="text-base font-black">Shopify Theme Editor</h1>
              <p className="text-xs font-semibold text-slate-500">OpenAI theme code agent</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/shopify-connect" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
              <ShieldCheck size={16} /> OAuth
            </Link>
            <Link href="/" className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-sm font-bold text-white hover:bg-slate-800">
              Home
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-4 p-4 md:p-6 lg:grid-cols-[300px_minmax(0,1fr)_340px]">
        <aside className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Store className="text-blue-600" size={18} />
              <h2 className="text-sm font-black">Store</h2>
            </div>
            <label className="mb-2 block text-[11px] font-black uppercase tracking-widest text-slate-400">Shopify store</label>
            <select
              value={store}
              onChange={e => handleStoreChange(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500"
            >
              {STORES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button
              onClick={refreshStatus}
              disabled={loadingStatus}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {loadingStatus ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
              Refresh
            </button>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-black">Active Theme</h2>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${connected ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                {connected ? "Connected" : "Disconnected"}
              </span>
            </div>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-[11px] font-black uppercase tracking-widest text-slate-400">Shop</dt>
                <dd className="mt-1 break-all font-bold text-slate-800">{status?.shop || "Not connected"}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-black uppercase tracking-widest text-slate-400">Theme ID</dt>
                <dd className="mt-1 font-mono text-xs font-bold text-slate-700">{themeId}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-black uppercase tracking-widest text-slate-400">Swatches</dt>
                <dd className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-black ${installed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                  {installed && <CheckCircle2 size={14} />}
                  {installed ? "Installed" : "Not installed"}
                </dd>
              </div>
            </dl>
          </section>
        </aside>

        <section className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-600">
                <Bot size={20} />
              </div>
              <div>
                <h2 className="text-sm font-black">Theme Agent</h2>
                <p className="text-xs font-semibold text-slate-500">Prompts OpenAI, then applies exact theme-file edits through Shopify OAuth</p>
              </div>
            </div>
          </div>

          <div className="space-y-4 p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <button
                onClick={() => runAgent("Find the product pricing section in the Shopify theme and improve its visual layout. Keep existing Liquid behavior intact.")}
                disabled={running}
                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left hover:border-blue-200 hover:bg-blue-50 disabled:opacity-60"
              >
                <span>
                  <span className="block text-sm font-black">Improve Pricing</span>
                  <span className="mt-1 block text-xs font-semibold text-slate-500">Ask the agent to edit product price code</span>
                </span>
                <Palette className="text-blue-600" size={20} />
              </button>
              <button
                onClick={() => runAgent("Review the product theme files and suggest the smallest safe change for the product page. Apply it only if the exact code location is clear.")}
                disabled={running}
                className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left hover:border-orange-200 hover:bg-orange-50 disabled:opacity-60"
              >
                <span>
                  <span className="block text-sm font-black">Safe Review</span>
                  <span className="mt-1 block text-xs font-semibold text-slate-500">Let the agent inspect before editing</span>
                </span>
                <RefreshCw className="text-orange-600" size={20} />
              </button>
            </div>

            <div>
              <label className="mb-2 block text-[11px] font-black uppercase tracking-widest text-slate-400">Codex instruction</label>
              <div className="flex flex-col gap-2 md:flex-row">
                <textarea
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  rows={3}
                  className="min-h-[92px] flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={() => runAgent()}
                  disabled={running || !prompt.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-blue-100 hover:bg-blue-700 disabled:opacity-60 md:w-36"
                >
                  {running ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                  Send
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-black">
                <Sparkles size={16} className="text-blue-600" /> Activity
              </div>
              {logs.map((log, idx) => (
                <div key={`${idx}-${log.text}`} className={`rounded-2xl border px-4 py-3 text-sm ${
                  log.role === "user" ? "border-blue-100 bg-blue-50 text-blue-900" :
                  log.role === "system" ? "border-red-100 bg-red-50 text-red-700" :
                  "border-slate-200 bg-slate-50 text-slate-700"
                }`}>
                  <span className="mr-2 font-black uppercase tracking-widest text-[10px]">{log.role}</span>
                  {log.text}
                </div>
              ))}
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-black">Swatch Preview</h2>
              {status?.shop && (
                <a href={`https://${status.shop}`} target="_blank" className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline">
                  Store <ExternalLink size={12} />
                </a>
              )}
            </div>
            <div className="space-y-3">
              <div>
                <p className="mb-2 text-[11px] font-black uppercase tracking-widest text-slate-400">Color</p>
                <div className="overflow-hidden rounded-2xl border-2 border-slate-950 bg-white shadow-sm">
                  <p className="px-3 py-2 text-center text-xs font-black text-slate-950">White/Black/Pink</p>
                  <div className="grid min-h-12 grid-cols-3 text-center text-[10px] font-black">
                    <span className="flex items-center justify-center bg-white text-slate-950">White</span>
                    <span className="flex items-center justify-center bg-slate-950 text-white">Black</span>
                    <span className="flex items-center justify-center bg-pink-300 text-slate-950">Pink</span>
                  </div>
                </div>
              </div>
              <div>
                <p className="mb-2 text-[11px] font-black uppercase tracking-widest text-slate-400">Size</p>
                <div className="rounded-2xl border-2 border-slate-950 bg-white p-3 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[10px] font-black uppercase text-slate-500">Size</span>
                    <span className="flex items-center gap-2 text-xl font-black text-slate-950">
                      <strong>21</strong><span className="text-[10px] uppercase text-slate-500">to</span><strong>25</strong>
                    </span>
                  </div>
                  <span className="mt-2 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-black text-orange-700">
                    <span className="grid h-5 w-5 place-items-center rounded-md bg-orange-400 text-[9px] text-white">BOX</span>
                    24 pcs per pack
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-black">Theme Files</h2>
            {[
              ["layout/theme.liquid", status?.files?.layout],
              ["snippets/ptos-variant-swatches.liquid", status?.files?.snippet],
              ["sections/ptos-variant-swatches.liquid", status?.files?.section],
            ].map(([label, ok]) => (
              <div key={String(label)} className="flex items-center justify-between border-t border-slate-100 py-2 text-xs">
                <span className="font-mono text-slate-600">{label}</span>
                <span className={`rounded-full px-2 py-0.5 font-black ${ok ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                  {ok ? "Ready" : "Missing"}
                </span>
              </div>
            ))}
          </section>
        </aside>
      </main>
    </div>
  )
}
