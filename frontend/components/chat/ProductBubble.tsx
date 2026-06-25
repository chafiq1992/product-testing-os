"use client"

import { Store, ChevronRight, Package } from 'lucide-react'
import { ChatMessage } from './chatApi'
import { ProductCard, CatalogCard, priceLabel } from './catalog'

function ProductMini({ card, onOpen }: { card: ProductCard; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="w-36 shrink-0 text-left rounded-xl overflow-hidden bg-white border border-slate-200 hover:border-blue-300 hover:shadow-md transition"
    >
      <div className="aspect-square bg-slate-50 overflow-hidden">
        {card.image
          ? <img src={card.image} alt={card.title} className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center text-slate-300"><Package size={26} /></div>}
      </div>
      <div className="p-2">
        <p className="text-xs font-semibold text-slate-800 truncate">{card.title}</p>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-[11px] font-bold text-blue-600 truncate">{priceLabel(card.price_min, card.price_max)}</span>
          {card.available > 0 && <span className="text-[10px] text-green-600 font-bold shrink-0">{card.available}</span>}
        </div>
      </div>
    </button>
  )
}

export default function ProductBubble({
  m, mine, onOpenProduct,
}: {
  m: ChatMessage
  mine: boolean
  onOpenProduct: (vendor: string, productId: string, fallback: ProductCard) => void
}) {
  const card = m.card

  if (m.type === 'product' && card) {
    const c = card as ProductCard
    return (
      <div className={`flex ${mine ? 'justify-end' : 'justify-start'} px-3`}>
        <button
          onClick={() => onOpenProduct(c.vendor, c.id, c)}
          className="max-w-[78%] w-64 text-left rounded-2xl overflow-hidden bg-white border border-slate-200 shadow-sm hover:shadow-md transition"
        >
          <div className="aspect-[4/3] bg-slate-50 overflow-hidden">
            {c.image
              ? <img src={c.image} alt={c.title} className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-slate-300"><Package size={36} /></div>}
          </div>
          <div className="p-3">
            <p className="font-bold text-slate-900 leading-tight line-clamp-2">{c.title}</p>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-blue-600 font-extrabold">{priceLabel(c.price_min, c.price_max)}</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${c.available > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                {c.available > 0 ? `${c.available} in stock` : 'Out of stock'}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1 text-blue-600 text-xs font-bold">
              View details <ChevronRight size={14} />
            </div>
          </div>
        </button>
      </div>
    )
  }

  if (m.type === 'catalog' && card) {
    const c = card as CatalogCard
    const items = c.products || []
    return (
      <div className={`flex ${mine ? 'justify-end' : 'justify-start'} px-3`}>
        <div className="max-w-[85%] rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
            <Store size={16} />
            <span className="font-bold text-sm flex-1 truncate">{c.title || 'Catalog'}</span>
            <span className="text-[11px] bg-white/20 rounded-full px-2 py-0.5">{c.count ?? items.length} items</span>
          </div>
          <div className="flex gap-2 p-2 overflow-x-auto max-w-[min(78vw,520px)]">
            {items.map(p => (
              <ProductMini key={p.id} card={p} onOpen={() => onOpenProduct(p.vendor || c.vendor, p.id, p)} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return null
}
