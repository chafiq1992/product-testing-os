'use client'
import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  connectMeta,
  refreshConnections,
  startEmbeddedSession,
  syncStores,
  type SendoConnections,
  type SendoSession,
} from '@/lib/sendoEmbed'

// Wraps a page that the delivery app embeds for a Sendo merchant: opens the
// workspace session before the page makes any API call, then shows which
// platforms are connected above it.
export default function SendoEmbed({ title, children }: { title: string, children: React.ReactNode }) {
  const [session, setSession] = useState<SendoSession | null>(null)
  const [failed, setFailed] = useState(false)
  const [connections, setConnections] = useState<SendoConnections | null>(null)
  const [busy, setBusy] = useState<'' | 'meta' | 'shopify'>('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    startEmbeddedSession()
      .then(s => {
        setConnections(s.connections || null)
        // A resumed session carries the status from when it was opened; read it fresh.
        return refreshConnections()
          .then(live => { if (live) setConnections(live) })
          .catch(() => {})
          .then(() => setSession(s))
      })
      .catch(() => setFailed(true))
  }, [])

  async function onConnectMeta() {
    setBusy('meta'); setNotice('')
    try {
      await connectMeta()
      const next = await refreshConnections()
      setConnections(next)
      if (next?.meta.connected) window.location.reload()
      else setNotice('Meta was not connected. Try again, and approve access to your ad account.')
    } catch {
      setNotice('Could not start the Meta connection. Try again in a moment.')
    } finally { setBusy('') }
  }

  async function onSyncShopify() {
    setBusy('shopify'); setNotice('')
    try {
      const next = await syncStores()
      setConnections(next)
      if (!next?.shopify.connected) setNotice('No connected Shopify store yet. Connect one from Connections in your Sendo dashboard.')
    } catch {
      setNotice('Could not refresh your store. Try again in a moment.')
    } finally { setBusy('') }
  }

  if (failed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f6f7f2] p-6 text-center text-[#183d32]">
        <div className="max-w-sm">
          <h1 className="text-lg font-semibold">This session has ended</h1>
          <p className="mt-2 text-sm text-[#67776e]">Open {title} again from your Sendo dashboard.</p>
        </div>
      </div>
    )
  }
  if (!session) {
    return <div className="min-h-screen flex items-center justify-center bg-[#f6f7f2] text-sm text-[#67776e]">Loading {title}…</div>
  }

  const meta = connections?.meta
  const shopify = connections?.shopify
  return (
    <div className="min-h-screen bg-[#f6f7f2]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#dce5dd] bg-[#fdfefa] px-4 py-3 text-sm text-[#183d32]">
        <strong className="mr-auto font-semibold">{title}</strong>
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${meta?.connected ? 'bg-[#e1f1e6] text-[#176a54]' : 'bg-[#eef1ec] text-[#67776e]'}`}>
          Meta Ads: {meta?.connected ? `connected${meta.user_name ? ` (${meta.user_name})` : ''}` : 'not connected'}
        </span>
        {!meta?.connected && (
          <button type="button" onClick={onConnectMeta} disabled={busy !== ''}
            className="rounded-full bg-[#176a54] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#10543f] disabled:opacity-60">
            {busy === 'meta' ? 'Waiting for Meta…' : 'Connect Meta Ads'}
          </button>
        )}
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${shopify?.connected ? 'bg-[#e1f1e6] text-[#176a54]' : 'bg-[#eef1ec] text-[#67776e]'}`}>
          Shopify: {shopify?.connected ? shopify.shop : 'not connected'}
        </span>
        <button type="button" onClick={onSyncShopify} disabled={busy !== ''} title="Refresh store connection from Sendo"
          className="inline-flex items-center rounded-full border border-[#dce5dd] bg-white p-1.5 text-[#183d32] hover:bg-[#f0f4ed] disabled:opacity-60">
          <RefreshCw className={`h-3.5 w-3.5 ${busy === 'shopify' ? 'animate-spin' : ''}`} />
          <span className="sr-only">Refresh store connection</span>
        </button>
      </div>
      {notice && <div className="border-b border-[#f3e3b5] bg-[#fdf6e3] px-4 py-2 text-xs text-[#7a5a00]" role="status">{notice}</div>}
      {meta?.connected ? children : (
        <div className="mx-auto max-w-xl p-8 text-center text-[#183d32]">
          <h2 className="text-lg font-semibold">Connect your Meta ad account</h2>
          <p className="mt-2 text-sm text-[#67776e]">
            {title} reads your campaigns and spend from Meta, then matches them with your Shopify orders.
          </p>
          <button type="button" onClick={onConnectMeta} disabled={busy !== ''}
            className="mt-5 rounded-full bg-[#176a54] px-5 py-2 text-sm font-semibold text-white hover:bg-[#10543f] disabled:opacity-60">
            {busy === 'meta' ? 'Waiting for Meta…' : 'Connect Meta Ads'}
          </button>
        </div>
      )}
    </div>
  )
}
