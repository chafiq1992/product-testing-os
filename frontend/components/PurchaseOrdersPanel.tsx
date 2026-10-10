"use client"
import type { PurchaseOrder } from '@/lib/api'

function sizeKey(value: string): [number, number, string]{
  const text = String(value || '').trim().toLowerCase()
  const apparel: Record<string, number> = { xxs: 10, xs: 20, s: 30, m: 40, l: 50, xl: 60, xxl: 70, xxxl: 80 }
  if(text in apparel) return [0, apparel[text], text]
  const numeric = text.match(/^(\d+(?:\.\d+)?)/)
  if(numeric) return [1, Number(numeric[1]), text]
  return [2, 0, text]
}

function sortSizes(sizes: string[]){
  return sizes.slice().sort((a, b) => {
    const ka = sizeKey(a), kb = sizeKey(b)
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2])
  })
}

export function formatPoDate(value?: string | null){
  if(!value) return '—'
  const date = new Date(value)
  if(Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function PoStatusPill({ status, label }: { status: PurchaseOrder['status'], label?: string }){
  const open = status === 'open'
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${open ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${open ? 'bg-amber-500' : 'bg-emerald-600'}`} />
      {label || (open ? 'Open' : 'Closed')}
    </span>
  )
}

export default function PurchaseOrdersPanel({ orders, productId, dateFrom, dateTo }: {
  orders: PurchaseOrder[],
  productId: string,
  dateFrom?: string,
  dateTo?: string,
}){
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Purchase orders</div>
        <div className="text-[10px] text-slate-400">{dateFrom && dateTo ? `${dateFrom} → ${dateTo}` : 'Last 5 days'}</div>
      </div>
      {orders.length === 0 && <div className="px-1 py-3 text-center text-slate-400">No purchase orders for this product in the last 5 days.</div>}
      {orders.map(order => {
        const product = order.products.find(p => String(p.product_id || '') === String(productId))
        const sizes = sortSizes(product?.sizes || [])
        const colors = product?.colors || []
        return (
          <section key={order.id} className="rounded-lg border border-slate-200">
            <header className="flex items-start justify-between gap-2 border-b border-slate-100 px-2 py-1.5">
              <div className="min-w-0">
                <div className="truncate font-semibold text-slate-800" title={order.transfer_name || order.name}>{order.name}</div>
                <div className="text-[10px] text-slate-500">Created {formatPoDate(order.created_at)}{order.destination ? ` · ${order.destination}` : ''}</div>
              </div>
              <PoStatusPill status={order.status} label={`${order.status === 'open' ? 'Open' : 'Closed'} · ${order.status_label}`} />
            </header>
            <table className="w-full border-collapse text-center">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-1 font-semibold">Total items</th>
                  <th className="px-2 py-1 font-semibold">Total crates</th>
                  <th className="px-2 py-1 font-semibold">This product</th>
                </tr>
              </thead>
              <tbody>
                <tr className="text-sm font-bold text-slate-800">
                  <td className="px-2 pb-1.5">{order.total_items.toLocaleString()}</td>
                  <td className="px-2 pb-1.5">{order.total_crates || '—'}</td>
                  <td className="px-2 pb-1.5 text-indigo-700">{product ? product.quantity.toLocaleString() : '—'}</td>
                </tr>
              </tbody>
            </table>
            {(order.received_items != null || order.received_crates != null) && (
              <div className="border-t border-slate-100 px-2 py-1 text-[10px] text-slate-500">
                Received {order.received_items ?? '—'} items · {order.received_crates ?? '—'} crates
              </div>
            )}
            {product && sizes.length > 0 && (
              <div className="overflow-x-auto border-t border-slate-100 px-1.5 py-1.5">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="px-1.5 py-0.5 text-left font-medium text-slate-400" />
                      {sizes.map(size => <th key={size} className="whitespace-nowrap px-1 py-0.5 text-center font-semibold text-slate-600">{size}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {colors.map(color => (
                      <tr key={color} className="border-t border-slate-50">
                        <td className="whitespace-nowrap px-1.5 py-0.5 font-medium text-slate-600">{color}</td>
                        {sizes.map(size => {
                          const qty = product.matrix[color]?.[size]
                          return (
                            <td key={size} className="px-1 py-0.5 text-center">
                              <span className={`inline-block min-w-[22px] rounded px-1 py-0.5 text-[10px] font-bold ${qty ? 'bg-indigo-50 text-indigo-700' : 'text-slate-300'}`}>{qty ?? '—'}</span>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {order.partial_lines && <div className="border-t border-slate-100 px-2 py-1 text-[10px] text-amber-700">Variant lines load fully once the PO is opened in Inventory Helper.</div>}
          </section>
        )
      })}
    </div>
  )
}
