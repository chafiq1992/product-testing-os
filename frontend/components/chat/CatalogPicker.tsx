"use client"

import { useEffect, useMemo, useState } from 'react'
import { X, Search, Loader2, Check, Send, Store, RefreshCw, Eye } from 'lucide-react'
import { Catalog, CatalogProduct, ProductCard, fetchCatalog, toProductCard, priceLabel } from './catalog'

// Pop-up grid of the vendor's in-stock products. Pick some or send the whole catalog.
export default function CatalogPicker({
  vendorId, vendorName, onClose, onSend, onPreview,
}: {
  vendorId: string
  vendorName?: string
  onClose: () => void
  onSend: (items: ProductCard[], asCatalog: boolean, title: string) => void
  onPreview: (productId: string, fallback: ProductCard) => void
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [term, setTerm] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const load = (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true)
    setError('')
    fetchCatalog(vendorId, refresh)
      .then(setCatalog)
      .catch(e => setError(e?.message || 'Failed to load catalog'))
      .finally(() => { setLoading(false); setRefreshing(false) })
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [vendorId])

  const products = catalog?.products || []
  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase()
    if (!q) return products
    return products.filter(p => p.title.toLowerCase().includes(q))
  }, [products, term])

  const toggle = (id: string) => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const title = vendorName ? `${vendorName} Catalog` : 'Catalog'

  const sendSelected = () => {
    const items = products.filter(p => selected.has(p.id)).map(p => toProductCard(vendorId, p))
    if (!items.length) return
    onSend(items, items.length > 1, title)
    onClose()
  }
  const sendAll = () => {
    const items = products.map(p => toProductCard(vendorId, p))
    if (!items.length) return
    onSend(items, true, title)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <div onClick={onClose} className="absolute inset-0 bg-black/50" />
      <div className="relative w-full max-w-3xl max-h-[88vh] bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center"><Store size={18} /></div>
          <div className="flex-1 min-w-0">
            <h2 className="font-black text-slate-900 leading-tight">{title}</h2>
            <p className="text-[11px] text-slate-400">{products.length} in-stock products</p>
          </div>
          <button onClick={() => load(true)} disabled={refreshing} className="p-2 rounded-full hover:bg-slate-100 text-slate-500" title="Refresh">
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 text-slate-500"><X size={20} /></button>
        </div>

        {/* Search */}
        <div className="px-4 py-2.5 border-b border-slate-100">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={term}
              onChange={e => setTerm(e.target.value)}
              placeholder="Search products"
              className="w-full pl-9 pr-3 py-2 rounded-full bg-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-3">
          {loading && <div className="py-16 text-center text-slate-400"><Loader2 size={22} className="animate-spin inline" /><p className="text-sm mt-2">Loading catalog…</p></div>}
          {!loading && error && <div className="py-16 text-center text-red-500 text-sm">{error}</div>}
          {!loading && !error && filtered.length === 0 && <div className="py-16 text-center text-slate-400 text-sm">No in-stock products found.</div>}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {filtered.map(p => {
              const isSel = selected.has(p.id)
              return (
                <div
                  key={p.id}
                  onClick={() => toggle(p.id)}
                  className={`group relative rounded-2xl border-2 cursor-pointer overflow-hidden transition ${isSel ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <div className="aspect-square bg-slate-50 overflow-hidden">
                    {p.image
                      ? <img src={p.image} alt={p.title} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-slate-300"><Store size={28} /></div>}
                  </div>
                  {/* selection check */}
                  <div className={`absolute top-2 left-2 h-6 w-6 rounded-full flex items-center justify-center ${isSel ? 'bg-blue-600 text-white' : 'bg-white/80 text-transparent border border-slate-300'}`}>
                    <Check size={14} />
                  </div>
                  {/* preview */}
                  <button
                    onClick={(e) => { e.stopPropagation(); onPreview(p.id, toProductCard(vendorId, p)) }}
                    className="absolute top-2 right-2 h-6 w-6 rounded-full bg-white/85 text-slate-600 flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                    title="Preview"
                  >
                    <Eye size={13} />
                  </button>
                  <div className="p-2">
                    <p className="text-xs font-semibold text-slate-800 truncate">{p.title}</p>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[11px] font-bold text-blue-600">{priceLabel(p.price_min, p.price_max)}</span>
                      <span className="text-[10px] text-green-600 font-bold">{p.available}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-4 py-3 border-t border-slate-100">
          <button
            onClick={sendSelected}
            disabled={selected.size === 0}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white font-bold py-2.5 transition"
          >
            <Send size={16} /> Send{selected.size > 0 ? ` (${selected.size})` : ' selected'}
          </button>
          <button
            onClick={sendAll}
            disabled={products.length === 0}
            className="flex items-center justify-center gap-2 rounded-xl border-2 border-blue-600 text-blue-600 hover:bg-blue-50 disabled:opacity-40 font-bold px-4 py-2.5 transition"
          >
            <Store size={16} /> Whole catalog
          </button>
        </div>
      </div>
    </div>
  )
}
