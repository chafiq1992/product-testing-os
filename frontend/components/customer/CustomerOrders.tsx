'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Clock3, Loader2, MessageCircle, Package, RefreshCw, ShoppingBag } from 'lucide-react'
import { CustomerMerchant, CustomerOrder, customerApi, customerError, customerMoney, customerOrderQuantity, customerPriceCents } from '../../lib/customer'

export default function CustomerOrders({ lang, merchants, refreshKey, onShop, onChat }: {
  lang: 'en' | 'ar'; merchants: CustomerMerchant[]; refreshKey: number
  onShop: () => void; onChat: (merchant: CustomerMerchant) => void
}) {
  const ar = lang === 'ar', t = (en: string, arabic: string) => ar ? arabic : en
  const [orders, setOrders] = useState<CustomerOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  async function reload() {
    setLoading(true); setError('')
    try { setOrders(await customerApi.orders() || []) }
    catch (cause) { setError(customerError(cause, lang)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [refreshKey])
  function status(value?: string) {
    const key = (value || 'received').toLowerCase()
    const labels: Record<string, [string, string]> = {
      received: ['Received', 'تم الاستلام'], pending: ['Pending', 'قيد الانتظار'], unpaid: ['Payment pending', 'في انتظار الدفع'],
      paid: ['Paid', 'مدفوع'], fulfilled: ['Completed', 'مكتمل'], completed: ['Completed', 'مكتمل'],
      cancelled: ['Cancelled', 'ملغى'], canceled: ['Cancelled', 'ملغى'], processing: ['Preparing', 'قيد التحضير'],
      open: ['Open', 'مفتوح'], unfulfilled: ['Preparing', 'قيد التحضير'], delivered: ['Delivered', 'تم التسليم'],
    }
    return labels[key] ? labels[key][ar ? 1 : 0] : value || t('Received', 'تم الاستلام')
  }
  return <div className="pb-24">
    <div className="mb-6 flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-emerald-700">{t('Only your orders', 'طلباتك فقط')}</p><h1 className="mt-1 text-2xl font-black">{t('My orders', 'طلباتي')}</h1></div><button type="button" onClick={() => void reload()} disabled={loading} aria-label={t('Refresh orders', 'تحديث الطلبات')} className="rounded-2xl border border-slate-200 bg-white p-3 text-slate-500"><RefreshCw size={19} className={loading ? 'animate-spin' : ''} /></button></div>
    {error && <p role="alert" className="mb-5 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-800">{error}</p>}
    {loading && !orders.length ? <div className="flex justify-center py-20"><Loader2 className="animate-spin text-emerald-600" size={30} /></div>
      : !orders.length ? <div className="rounded-3xl border border-slate-100 bg-white px-6 py-16 text-center"><ShoppingBag size={45} className="mx-auto mb-4 text-emerald-300" /><h2 className="text-lg font-black">{t('Your first order starts here', 'طلبك الأول يبدأ هنا')}</h2><p className="mx-auto mt-2 max-w-sm text-sm text-slate-500">{t('Shop with a linked merchant. Your orders and updates will stay together here.', 'تسوق لدى تاجر مرتبط بحسابك وستجد طلباتك وتحديثاتها هنا.')}</p><button type="button" onClick={onShop} className="mt-6 rounded-2xl bg-emerald-700 px-6 py-3 text-sm font-bold text-white">{t('Browse my shops', 'تصفح متاجري')}</button></div>
        : <div className="space-y-4">{orders.map(order => {
          const key = `${order.merchant_ref}:${order.id}`, open = expanded === key, merchant = merchants.find(item => item.ref === order.merchant_ref)
          const created = order.created_at ? new Date(order.created_at) : null
          return <article key={key} className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm"><button type="button" onClick={() => setExpanded(open ? null : key)} aria-expanded={open} className="flex w-full items-start justify-between gap-4 p-5 text-start"><div className="flex gap-3"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><Package size={23} /></span><div><p className="text-xs font-bold text-emerald-700">{order.merchant_name || merchant?.name || t('Your merchant', 'التاجر')}</p><h2 className="mt-1 font-black">{order.name || `#${order.id}`}</h2><p className="mt-1 flex items-center gap-1.5 text-xs text-slate-400"><Clock3 size={12} />{created && !Number.isNaN(created.getTime()) ? created.toLocaleString(ar ? 'ar-MA' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</p></div></div><div className="text-end"><p className="text-sm font-black">{customerMoney(customerPriceCents(order.total_price ?? order.total), lang, order.currency || 'MAD')}</p><span className={`mt-2 inline-block rounded-full px-2.5 py-1 text-[10px] font-bold ${/cancel/i.test(order.status || '') ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-800'}`}>{status(order.status)}</span><span className="mt-2 block text-slate-300">{open ? <ChevronUp size={16} className="ms-auto" /> : <ChevronDown size={16} className="ms-auto" />}</span></div></button>
            {open && <div className="border-t border-slate-100 px-5 pb-5"><div className="divide-y divide-slate-100">{(order.line_items || []).map((line, index) => <div key={index} className="flex items-start justify-between gap-3 py-3 text-sm"><div><p className="font-bold">{line.title || line.name || t('Product', 'منتج')}</p>{line.variant_title && !/default title/i.test(line.variant_title) && <p className="mt-1 text-xs text-slate-400">{line.variant_title}</p>}</div><span className="whitespace-nowrap text-slate-600">{customerOrderQuantity(line, lang)}</span></div>)}</div><p className="mt-3 text-xs text-slate-500">{t('Payment', 'الدفع')}: {status(order.payment_status || 'unpaid')}</p>{merchant && <button type="button" onClick={() => onChat(merchant)} className="mt-4 flex min-h-11 items-center gap-2 rounded-xl border border-emerald-200 px-4 text-sm font-bold text-emerald-800"><MessageCircle size={16} />{t('Contact merchant', 'التواصل مع التاجر')}</button>}</div>}
          </article>
        })}</div>}
  </div>
}
