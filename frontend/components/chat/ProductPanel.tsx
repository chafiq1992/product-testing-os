"use client"

import { useEffect, useState } from 'react'
import { X, Send, Package, Check, Loader2 } from 'lucide-react'
import { CatalogProduct, ProductCard, fetchCatalogProduct, priceLabel } from './catalog'

// Clean, slide-in product detail (price, gallery, description, variants).
export default function ProductPanel({
  vendorId, productId, fallback, onClose, onSend,
}: {
  vendorId: string
  productId: string | null
  fallback?: ProductCard | null
  onClose: () => void
  onSend?: (card: ProductCard) => void
}) {
  const open = !!productId
  const [product, setProduct] = useState<CatalogProduct | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeImg, setActiveImg] = useState(0)

  useEffect(() => {
    if (!productId) return
    setProduct(null); setActiveImg(0); setLoading(true)
    let alive = true
    fetchCatalogProduct(vendorId, productId)
      .then(p => { if (alive) setProduct(p) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [vendorId, productId])

  const title = product?.title || fallback?.title || ''
  const images = product?.images?.length ? product.images : (fallback?.image ? [fallback.image] : [])
  const mainImg = images[activeImg] || images[0] || ''
  const compareAt = product?.compare_at_price ? parseFloat(product.compare_at_price) : 0
  const priceMin = product?.price_min ?? fallback?.price_min ?? 0
  const priceMax = product?.price_max ?? fallback?.price_max ?? 0
  const available = product?.available ?? fallback?.available ?? 0

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/40 transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      />
      {/* Panel */}
      <aside
        className={`fixed top-0 right-0 z-50 h-full w-full max-w-md bg-white shadow-2xl transition-transform duration-300 ease-out flex flex-col ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <span className="text-sm font-bold text-slate-500 flex items-center gap-1.5"><Package size={16} /> Product</span>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-slate-100 text-slate-500"><X size={20} /></button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* Gallery */}
          <div className="bg-slate-50">
            <div className="aspect-square w-full bg-white flex items-center justify-center overflow-hidden">
              {mainImg
                ? <img src={mainImg} alt={title} className="w-full h-full object-contain" />
                : <Package size={64} className="text-slate-200" />}
            </div>
            {images.length > 1 && (
              <div className="flex gap-2 p-3 overflow-x-auto">
                {images.map((src, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveImg(i)}
                    className={`h-14 w-14 shrink-0 rounded-lg overflow-hidden border-2 ${i === activeImg ? 'border-blue-500' : 'border-transparent'}`}
                  >
                    <img src={src} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="p-4 space-y-4">
            <div>
              <h2 className="text-xl font-black text-slate-900 leading-tight">{title || (loading ? 'Loading…' : '')}</h2>
              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                <span className="text-lg font-extrabold text-blue-600">{priceLabel(priceMin, priceMax)}</span>
                {compareAt > 0 && compareAt > priceMin && (
                  <span className="text-sm text-slate-400 line-through">{compareAt.toFixed(2)} DH</span>
                )}
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${available > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                  {available > 0 ? `${available} in stock` : 'Out of stock'}
                </span>
              </div>
            </div>

            {/* Variants / sizes */}
            {product?.variants?.length ? (
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Variants</p>
                <div className="space-y-1.5">
                  {product.variants.map(v => (
                    <div key={v.id} className={`flex items-center justify-between rounded-lg border px-3 py-2 ${v.available > 0 ? 'border-slate-200' : 'border-slate-100 opacity-50'}`}>
                      <span className="text-sm font-medium text-slate-700">{v.title}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-slate-900">{v.price ? `${parseFloat(v.price).toFixed(2)} DH` : ''}</span>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${v.available > 0 ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                          {v.available > 0 ? v.available : '0'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : loading ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm"><Loader2 size={16} className="animate-spin" /> Loading details…</div>
            ) : null}

            {/* Description */}
            {product?.description_html && (
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Description</p>
                <div
                  className="prose prose-sm max-w-none text-slate-600 [&_img]:rounded-lg [&_*]:!text-slate-600"
                  dangerouslySetInnerHTML={{ __html: product.description_html }}
                />
              </div>
            )}
          </div>
        </div>

        {onSend && (
          <div className="p-3 border-t border-slate-100">
            <button
              onClick={() => {
                const card: ProductCard = {
                  vendor: vendorId, id: productId || '', title,
                  image: mainImg, price_min: priceMin, price_max: priceMax, available, handle: product?.handle,
                }
                onSend(card)
                onClose()
              }}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 transition"
            >
              <Send size={18} /> Send to chat
            </button>
          </div>
        )}
      </aside>
    </>
  )
}
