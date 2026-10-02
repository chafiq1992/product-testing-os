"use client"
import Link from 'next/link'
import { useEffect, useState } from 'react'
import AdsAgentSettings from '@/components/AdsAgentSettings'
import { useShopifyStores } from '@/lib/shopifyStores'

export default function AdsAgentSettingsPage() {
  const { stores } = useShopifyStores()
  const [store, setStore] = useState('irrakids')
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('store') || localStorage.getItem('ptos_store') || 'irrakids'
    setStore(requested === 'nouralibas' ? 'irrakids' : requested.toLowerCase())
  }, [])
  return <main className="min-h-screen bg-slate-50 text-slate-800">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-6 py-4">
      <nav aria-label="Ads management tabs" className="flex gap-2 text-sm font-semibold"><Link className="rounded-lg px-4 py-2 hover:bg-slate-50" href="/ads-management/">Campaigns</Link><Link aria-current="page" className="rounded-lg bg-violet-50 px-4 py-2 text-violet-700" href="/ads-management/settings/">AI agent settings</Link></nav>
      <label className="flex items-center gap-2 text-sm">Store<select className="rounded-lg border px-3 py-2" value={store} onChange={e => setStore(e.target.value)}>{stores.map(s => <option key={s.label} value={s.label}>{s.label}</option>)}</select></label>
    </header><AdsAgentSettings key={store} store={store} />
  </main>
}
