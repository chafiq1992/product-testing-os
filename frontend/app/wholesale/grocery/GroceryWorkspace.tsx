"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Loader2, Minus, Plus, RefreshCw, ScanBarcode, Search, ShoppingBasket, Trash2 } from 'lucide-react'
import BarcodeScanner from './BarcodeScanner'
import { normalizeBarcode } from './scanner'

const API = process.env.NEXT_PUBLIC_API_BASE_URL || ''
type Lang = 'en' | 'ar'
type Props = { vendor: any; lang: Lang; mode: 'inventory' | 'sale'; onDone: () => void; onChanged: () => void }
type Item = { product: any; variant: any }
type Draft = { productId?: string; barcode: string; name: string; price: string; stock: string; cost_price: string }
type CartLine = { variant_id: number; quantity: number }
type Pending = { kind: string; method: string; path: string; body: any }
const blank: Draft = { barcode: '', name: '', price: '', stock: '', cost_price: '' }
const input = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50'
const primary = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:opacity-50'
function stock(v: any) { return Math.max(0, Number(v.inventory_available ?? v.available_quantity ?? v.inventory_quantity ?? 0)) }
function cents(value: any) { return Math.round(Number(value || 0) * 100) }
function money(value: any) { return (Number(value || 0)).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' DH' }

export function GroceryHome({ products, lang }: { products: any[]; lang: Lang }) {
  const ar = lang === 'ar'
  return <section className="mx-auto max-w-6xl rounded-3xl border border-emerald-100 bg-white p-6 md:p-8">
    <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-800"><ScanBarcode size={18} />{ar ? 'متجرك، بطريقة أسهل' : 'Your grocery, made simple'}</div>
    <h2 className="text-2xl font-black">{ar ? 'امسح الباركود وواصل عملك' : 'Scan a barcode. Keep business moving.'}</h2>
    <p className="mt-3 max-w-xl text-slate-500">{ar ? 'أضف المنتجات وحدّث المخزون بالمسح، أو امسح منتجات العميل لإنشاء طلب. الكتالوج والطلبات والعملاء والمحادثات في أماكنها المعتادة.' : 'Scan to add products and update stock, or scan a customer’s basket to create an order. Your catalog, orders, customers and chat stay in their usual places.'}</p>
    <div className="mt-6 flex gap-8"><div><strong className="text-2xl">{products.length}</strong><p className="text-sm text-slate-500">{ar ? 'منتج في الكتالوج' : 'Catalog products'}</p></div><div><strong className="text-2xl">{products.reduce((n, p) => n + (p.variants || []).reduce((s: number, v: any) => s + stock(v), 0), 0)}</strong><p className="text-sm text-slate-500">{ar ? 'وحدة متوفرة' : 'Units available'}</p></div></div>
  </section>
}

export default function GroceryWorkspace({ vendor, lang, mode, onDone, onChanged }: Props) {
  const ar = lang === 'ar'
  const t = (en: string, arabic: string) => ar ? arabic : en
  const prefix = `/api/wholesale/vendors/${encodeURIComponent(vendor.id)}/grocery`
  const storageKey = `grocery-work:${vendor.id}:${mode}`
  const [products, setProducts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [draft, setDraft] = useState<Draft>(blank)
  const [cart, setCart] = useState<CartLine[]>([])
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [payment, setPayment] = useState<'paid' | 'unpaid'>('paid')
  const [amountPaid, setAmountPaid] = useState('')
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null)
  const [receipt, setReceipt] = useState<any>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [needsReview, setNeedsReview] = useState(false)
  const [ready, setReady] = useState(false)
  const busyRef = useRef(false)
  const fieldRef = useRef<HTMLInputElement>(null)

  const variants: Item[] = useMemo(() => products.flatMap(product => (product.variants || []).map((variant: any) => ({ product, variant }))), [products])
  const index = useMemo(() => {
    const map = new Map<string, Item[]>()
    variants.forEach(item => [...new Set([item.variant.barcode, item.variant.sku].filter(Boolean).map(normalizeBarcode))].forEach(code => map.set(code, [...(map.get(code) || []), item])))
    return map
  }, [variants])
  const byId = useMemo(() => new Map(variants.map(i => [Number(i.variant.id), i])), [variants])
  const totalCents = cart.reduce((sum, line) => sum + cents(byId.get(line.variant_id)?.variant.price) * line.quantity, 0)
  const unavailable = cart.some(line => !byId.has(line.variant_id) || line.quantity > stock(byId.get(line.variant_id)?.variant || {}))
  const filtered = search.trim() ? variants.filter(i => `${i.product.title} ${i.variant.barcode || ''} ${i.variant.sku || ''}`.toLowerCase().includes(search.toLowerCase())).slice(0, 12) : []

  async function request(path: string, method = 'GET', body?: any) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), method === 'GET' ? 45000 : 120000)
    try {
      const response = await fetch(API + path, { method, cache: 'no-store', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vendor.grocery_token || ''}` }, ...(body ? { body: JSON.stringify(body) } : {}) })
      const result = await response.json()
      if (!response.ok || result.error) {
        const detail = result.detail || result
        const error: any = new Error(typeof detail === 'string' ? detail : detail.message || detail.error || t('Please check the entered information.', 'تحقق من المعلومات المدخلة.'))
        error.code = detail.error
        error.status = response.status
        throw error
      }
      return result
    } finally { clearTimeout(timer) }
  }

  async function reload() {
    setLoading(true); setLoadError('')
    try { const result = await request(prefix + '/products'); setProducts(result.data || []) }
    catch (e: any) { setLoadError(e.message || t('Could not load stock. Try again.', 'تعذر تحميل المخزون. حاول مجدداً.')) }
    finally { setLoading(false) }
  }

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null')
      if (saved) {
        setDraft(saved.draft || blank); setCart(saved.cart || []); setCustomerName(saved.customerName || ''); setCustomerPhone(saved.customerPhone || '')
        setPayment(saved.payment || 'paid'); setAmountPaid(saved.amountPaid || ''); setPending(saved.pending || null); setNeedsReview(!!saved.needsReview); setReceipt(saved.receipt || null)
      }
    } catch { /* An unreadable draft never becomes a transaction. */ }
    setReady(true); void reload()
  }, [vendor.id, mode])

  useEffect(() => {
    if (!ready) return
    try { sessionStorage.setItem(storageKey, JSON.stringify({ draft, cart, customerName, customerPhone, payment, amountPaid, pending, needsReview, receipt })) } catch { /* pending writes persist synchronously before submission below */ }
  }, [ready, storageKey, draft, cart, customerName, customerPhone, payment, amountPaid, pending, needsReview, receipt])

  function edit(item: Item, barcode?: string) {
    if (pending || busyRef.current) return
    setDraft({ productId: String(item.product.id), barcode: barcode || item.variant.barcode || item.variant.sku || '', name: item.product.title || '', price: String(item.variant.price || ''), stock: String(stock(item.variant)), cost_price: String(item.variant.cost_price ?? '') })
    setMessage(null); setSearch(''); setTimeout(() => fieldRef.current?.focus(), 0)
  }
  function add(item: Item) {
    if (pending || busyRef.current) return
    const id = Number(item.variant.id)
    setCart(previous => {
      const existing = previous.find(l => l.variant_id === id)
      if ((existing?.quantity || 0) >= stock(item.variant)) { setMessage({ error: true, text: t('Not enough stock for another unit.', 'المخزون لا يكفي لإضافة وحدة أخرى.') }); return previous }
      return existing ? previous.map(l => l.variant_id === id ? { ...l, quantity: l.quantity + 1 } : l) : [...previous, { variant_id: id, quantity: 1 }]
    })
    setSearch(''); setReceipt(null)
  }
  function scan(raw: string) {
    if (pending || busyRef.current || loading || loadError) return
    const code = normalizeBarcode(raw)
    const matches = index.get(code) || []
    if (matches.length > 1) { setMessage({ error: true, text: t('This barcode matches more than one variant. Resolve the duplicate in the catalog before scanning it.', 'هذا الباركود مرتبط بأكثر من متغير. صحح التكرار في الكتالوج أولاً.') }); return }
    setMessage(null)
    if (mode === 'sale') {
      if (!matches.length) { setMessage({ error: true, text: t(`Unknown barcode ${code}. Add this product to stock first.`, `الباركود ${code} غير مسجل. أضف المنتج إلى المخزون أولاً.`) }); return }
      add(matches[0])
    } else if (matches.length) edit(matches[0], code)
    else { setDraft({ ...blank, barcode: code }); setMessage({ error: false, text: t('New barcode. Enter its name, unit price and stock once.', 'باركود جديد. أدخل الاسم وثمن الوحدة والمخزون مرة واحدة.') }); setTimeout(() => fieldRef.current?.focus(), 0) }
  }

  function errorText(e: any) {
    const labels: Record<string, [string, string]> = {
      insufficient_inventory: ['Stock changed. Refresh stock and check your basket.', 'تغير المخزون. حدّثه وراجع السلة.'],
      insufficient_payment: ['Amount received is less than the total.', 'المبلغ المستلم أقل من الإجمالي.'],
      unpaid_customer_required: ['Enter the customer’s name and phone for an unpaid order.', 'أدخل اسم العميل وهاتفه لحفظ طلب غير مدفوع.'],
      invalid_session: ['Session expired. Sign out and sign in again.', 'انتهت الجلسة. سجل الخروج ثم ادخل مجدداً.'],
      duplicate_barcode: ['This barcode is already assigned to another product.', 'هذا الباركود مسجل لمنتج آخر.'],
      needs_review: ['The result needs verification. Check the catalog or orders before taking further action. This request will not be submitted again.', 'تحتاج النتيجة إلى التحقق. راجع الكتالوج أو الطلبات. لن يعاد إرسال العملية.'],
      request_in_progress: ['This request is still processing. Wait, then check the same request.', 'العملية قيد التنفيذ. انتظر ثم تحقق من نفس العملية.'],
    }
    const pair = labels[e.code]
    return pair ? t(...pair) : e.message || t('Connection interrupted. Check the same request to avoid duplicates.', 'انقطع الاتصال. تحقق من نفس العملية لتجنب التكرار.')
  }

  async function submit(operation: Pending) {
    if (busyRef.current) return
    if (!navigator.onLine) { setMessage({ error: true, text: t('Connect to the internet before saving.', 'اتصل بالإنترنت قبل الحفظ.') }); return }
    busyRef.current = true; setBusy(true); setMessage(null)
    // Persist the exact request BEFORE sending; retries and reloads reuse its identity.
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ draft, cart, customerName, customerPhone, payment, amountPaid, pending: operation, needsReview: false }))
    } catch {
      busyRef.current = false; setBusy(false)
      setMessage({ error: true, text: t('Allow browser storage before saving so interrupted requests can be recovered safely.', 'فعّل تخزين المتصفح قبل الحفظ لاسترجاع العمليات المنقطعة بأمان.') }); return
    }
    setPending(operation)
    try {
      const result = await request(operation.path, operation.method, operation.body)
      if (!result.data) throw new Error(t('Unexpected response. Check the same request.', 'استجابة غير متوقعة. تحقق من نفس العملية.'))
      if (operation.kind === 'order') { setReceipt(result.data); setCart([]); setAmountPaid(''); setCustomerName(''); setCustomerPhone('') }
      else { setDraft(blank); setMessage({ error: false, text: result.existing ? t('Product already exists. Scan again to edit stock.', 'المنتج مسجل. امسحه مجدداً لتحديث المخزون.') : t('Product saved. Scan the next barcode.', 'تم حفظ المنتج. امسح الباركود التالي.') }) }
      setPending(null); setNeedsReview(false); onChanged(); void reload()
    } catch (e: any) {
      setMessage({ error: true, text: errorText(e) })
      if (e.code === 'needs_review') setNeedsReview(true)
      // A definite validation rejection may be corrected. Network/5xx outcomes retain identity.
      if (e.status >= 400 && e.status < 500 && !['needs_review', 'request_in_progress', 'request_conflict'].includes(e.code)) setPending(null)
    } finally { busyRef.current = false; setBusy(false) }
  }

  function saveProduct(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.barcode || !draft.name.trim() || !/^\d+(\.\d{1,2})?$/.test(draft.price) || Number(draft.price) <= 0 || !/^\d+$/.test(draft.stock)) { setMessage({ error: true, text: t('Scan a barcode, enter a name, a positive unit price and whole-unit stock.', 'امسح الباركود وأدخل الاسم وثمن وحدة موجب ومخزوناً صحيحاً.') }); return }
    const path = prefix + '/products' + (draft.productId ? '/' + encodeURIComponent(draft.productId) : '')
    void submit({ kind: 'product', path, method: draft.productId ? 'PATCH' : 'POST', body: { request_id: crypto.randomUUID(), barcode: draft.barcode, name: draft.name.trim(), price: draft.price, stock: Number(draft.stock), ...(draft.cost_price ? { cost_price: draft.cost_price } : {}) } })
  }
  function checkout() {
    if (unavailable || !cart.length) return
    if (payment === 'unpaid' && (!customerName.trim() || !customerPhone.trim())) { setMessage({ error: true, text: t('Enter the customer’s name and phone for an unpaid order.', 'أدخل اسم العميل وهاتفه لحفظ طلب غير مدفوع.') }); return }
    if (payment === 'paid' && (!/^\d+(\.\d{1,2})?$/.test(amountPaid) || cents(amountPaid) < totalCents)) { setMessage({ error: true, text: t('Enter the cash received, at least the order total.', 'أدخل المبلغ المستلم على ألا يقل عن الإجمالي.') }); return }
    void submit({ kind: 'order', path: prefix + '/orders', method: 'POST', body: { request_id: crypto.randomUUID(), line_items: cart, customer_name: customerName.trim() || undefined, customer_phone: customerPhone.trim() || undefined, payment_status: payment, ...(payment === 'paid' ? { amount_paid: amountPaid } : {}) } })
  }
  const locked = busy || !!pending || !!receipt

  return <div dir={ar ? 'rtl' : 'ltr'} className="mx-auto max-w-6xl space-y-5 pb-12">
    <div className="flex items-start justify-between gap-4"><div><div className="mb-1 text-xs font-bold uppercase tracking-widest text-emerald-700">{t('Grocery workspace', 'مساحة البقالة')}</div><h1 className="text-2xl font-black">{mode === 'sale' ? t('Scan an order', 'امسح منتجات الطلب') : t('Scan & stock', 'المسح والمخزون')}</h1><p className="mt-1 text-sm text-slate-500">{mode === 'sale' ? t('Each scan adds one unit. Review the basket, then save.', 'كل مسح يضيف وحدة. راجع السلة ثم احفظ.') : t('Scan a barcode to add a product or update its stock.', 'امسح الباركود لإضافة منتج أو تحديث مخزونه.')}</p></div><button aria-label={t('Refresh stock', 'تحديث المخزون')} onClick={reload} disabled={loading || busy} className="rounded-xl border bg-white p-3"><RefreshCw size={20} className={loading ? 'animate-spin' : ''} /></button></div>
    {message && <div role={message.error ? 'alert' : 'status'} className={`rounded-xl border p-4 text-sm ${message.error ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>{message.text}</div>}
    {loadError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4">{loadError} <button className="font-bold underline" onClick={reload}>{t('Retry', 'إعادة المحاولة')}</button></div>}
    {pending && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950"><p className="font-bold">{t('An unfinished request is saved on this device.', 'هناك عملية غير مكتملة محفوظة على هذا الجهاز.')}</p><p className="mt-1 text-sm">{needsReview ? t('Check your catalog or order history. Ask an administrator to reconcile this request before starting another.', 'راجع الكتالوج أو سجل الطلبات. اطلب من المسؤول التحقق من العملية قبل بدء أخرى.') : t('Check the same request to recover its result safely.', 'تحقق من نفس العملية لاسترجاع نتيجتها بأمان.')}</p><code className="mt-2 block break-all text-xs" dir="ltr">{pending.body.request_id}</code>{!needsReview && <button className={primary + ' mt-3'} disabled={busy} onClick={() => submit(pending)}>{busy && <Loader2 className="animate-spin" size={18} />}{t('Check same request', 'التحقق من نفس العملية')}</button>}</section>}
    {receipt && <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><h2 className="flex items-center gap-2 text-lg font-bold text-emerald-900"><CheckCircle2 />{t('Order saved', 'تم حفظ الطلب')} {receipt.name}</h2><p className="mt-2">{t('Total', 'الإجمالي')}: <strong>{money(receipt.total_price)}</strong> · {receipt.financial_status === 'paid' ? t('Paid', 'مدفوع') : t('Unpaid', 'غير مدفوع')}</p>{receipt.financial_status === 'paid' && <p>{t('Change', 'الباقي')}: <strong>{money(receipt.change)}</strong></p>}<div className="mt-3 flex flex-wrap items-center gap-4"><button className={primary} onClick={() => { setReceipt(null); setMessage(null) }}>{t('Start another order', 'بدء طلب آخر')}</button><button className="font-bold text-emerald-800 underline" onClick={onDone}>{t('View orders', 'عرض الطلبات')}</button></div></section>}
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-4"><BarcodeScanner onScan={scan} lang={lang} disabled={locked || loading || !!loadError || (mode === 'inventory' && !!draft.barcode)} />{mode === 'inventory' && draft.barcode && !locked && <button onClick={() => { if (window.confirm(t('Discard this unsaved product form and scan another barcode?', 'تجاهل بيانات المنتج غير المحفوظة ومسح باركود آخر؟'))) { setDraft(blank); setMessage(null) } }} className="w-full rounded-xl border bg-white p-3 text-sm font-bold">{t('Scan another product', 'مسح منتج آخر')}</button>}{loading && <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />{t('Loading current stock…', 'جار تحميل المخزون…')}</p>}
        <div className="rounded-2xl border bg-white p-4"><label className="mb-2 flex items-center gap-2 font-semibold"><Search size={17} />{t('Find by name or barcode', 'البحث بالاسم أو الباركود')}<input className="sr-only" tabIndex={-1} /></label><input aria-label={t('Search products', 'البحث عن المنتجات')} value={search} disabled={locked || loading || !!loadError} onChange={e => setSearch(e.target.value)} className={input} placeholder={t('Type a product name', 'اكتب اسم المنتج')} /><div className="mt-2 divide-y">{filtered.map(item => <button key={item.variant.id} disabled={locked} onClick={() => mode === 'sale' ? add(item) : edit(item)} className="flex w-full items-center justify-between gap-2 py-3 text-start"><span className="min-w-0"><span className="block truncate font-semibold">{item.product.title}</span><span className="text-xs text-slate-500">{item.variant.barcode || item.variant.sku} · {stock(item.variant)} {t('in stock', 'متوفر')}</span></span><span className="shrink-0 text-sm font-bold">{money(item.variant.price)}</span></button>)}{search && !filtered.length && <p className="py-3 text-sm text-slate-500">{t('No matching product. Scan a new barcode in stock entry to add it.', 'لا يوجد منتج مطابق. امسح باركوداً جديداً في صفحة المخزون لإضافته.')}</p>}</div></div>
      </div>
      {mode === 'inventory' ? <form onSubmit={saveProduct} className="space-y-4 rounded-2xl border bg-white p-5"><h2 className="text-lg font-bold">{draft.productId ? t('Update product', 'تحديث المنتج') : t('New product', 'منتج جديد')}</h2><fieldset disabled={locked} className="space-y-4"><label className="block text-sm font-semibold">{t('Scanned barcode', 'الباركود الممسوح')}<input aria-label={t('Scanned barcode', 'الباركود الممسوح')} readOnly value={draft.barcode} className={input + ' mt-1 font-mono'} dir="ltr" placeholder={t('Scan first', 'امسح أولاً')} /></label><label className="block text-sm font-semibold">{t('Product name', 'اسم المنتج')}<input ref={fieldRef} required maxLength={200} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} className={input + ' mt-1'} /></label><div className="grid grid-cols-2 gap-3"><label className="block text-sm font-semibold">{t('Unit price (DH)', 'ثمن الوحدة (درهم)')}<input required type="number" inputMode="decimal" min="0.01" step="0.01" value={draft.price} onChange={e => setDraft({ ...draft, price: e.target.value })} className={input + ' mt-1'} /></label><label className="block text-sm font-semibold">{t('Total stock (units)', 'إجمالي المخزون (وحدات)')}<input required type="number" inputMode="numeric" min="0" step="1" value={draft.stock} onChange={e => setDraft({ ...draft, stock: e.target.value })} className={input + ' mt-1'} /></label></div><label className="block text-sm font-semibold">{t('Unit cost (optional)', 'تكلفة الوحدة (اختياري)')}<input type="number" inputMode="decimal" min="0" step="0.01" value={draft.cost_price} onChange={e => setDraft({ ...draft, cost_price: e.target.value })} className={input + ' mt-1'} /></label><p className="text-xs text-slate-500">{t('Stock is the total available quantity, not an amount to add.', 'المخزون هو العدد الإجمالي المتوفر، وليس كمية تضاف إليه.')}</p><button disabled={locked || !draft.barcode || loading || !!loadError} className={primary + ' w-full'}>{busy ? <Loader2 size={19} className="animate-spin" /> : <CheckCircle2 size={19} />}{t('Save product', 'حفظ المنتج')}</button></fieldset></form> : <section className="space-y-4 rounded-2xl border bg-white p-5"><h2 className="flex items-center gap-2 text-lg font-bold"><ShoppingBasket size={20} />{t('Basket', 'السلة')}<span className="text-sm text-slate-400">{cart.reduce((n, l) => n + l.quantity, 0)}</span></h2>{!cart.length && <div className="rounded-xl bg-slate-50 px-4 py-10 text-center text-slate-500"><ScanBarcode className="mx-auto mb-2" />{t('Scan the first product to start.', 'امسح أول منتج للبدء.')}</div>}
        <div className="divide-y">{cart.map(line => { const item = byId.get(line.variant_id); return <div key={line.variant_id} className="py-3"><div className="flex justify-between gap-3"><span className="font-semibold">{item?.product.title || t('Unavailable product', 'منتج غير متوفر')}</span><span className="whitespace-nowrap font-bold">{money((cents(item?.variant.price) * line.quantity) / 100)}</span></div><div className="mt-2 flex items-center justify-between"><span className="text-xs text-slate-500">{money(item?.variant.price)} / {t('unit', 'وحدة')}</span><div className="flex items-center gap-2"><button aria-label={t('Decrease quantity', 'تقليل الكمية')} disabled={locked} onClick={() => setCart(c => c.map(l => l.variant_id === line.variant_id ? { ...l, quantity: l.quantity - 1 } : l).filter(l => l.quantity > 0))} className="rounded-lg border p-2"><Minus size={16} /></button><span className="min-w-6 text-center font-bold">{line.quantity}</span><button aria-label={t('Increase quantity', 'زيادة الكمية')} disabled={locked || !item || line.quantity >= stock(item.variant)} onClick={() => item && add(item)} className="rounded-lg border p-2 disabled:opacity-30"><Plus size={16} /></button><button aria-label={t('Remove product', 'حذف المنتج')} disabled={locked} onClick={() => setCart(c => c.filter(l => l.variant_id !== line.variant_id))} className="p-2 text-red-600"><Trash2 size={16} /></button></div></div>{(!item || line.quantity > stock(item.variant)) && <p className="mt-1 text-sm text-red-600">{t('Insufficient current stock. Adjust the quantity.', 'المخزون الحالي غير كاف. عدّل الكمية.')}</p>}</div> })}</div>
        <div className="flex justify-between border-t pt-4 text-xl font-black"><span>{t('Total', 'الإجمالي')}</span><span>{money(totalCents / 100)}</span></div><fieldset disabled={locked} className="space-y-3"><div className="grid grid-cols-2 gap-2"><button type="button" aria-pressed={payment === 'paid'} onClick={() => setPayment('paid')} className={`rounded-xl border p-3 font-bold ${payment === 'paid' ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : ''}`}>{t('Cash · paid', 'نقداً · مدفوع')}</button><button type="button" aria-pressed={payment === 'unpaid'} onClick={() => setPayment('unpaid')} className={`rounded-xl border p-3 font-bold ${payment === 'unpaid' ? 'border-amber-500 bg-amber-50 text-amber-900' : ''}`}>{t('Unpaid / credit', 'غير مدفوع / دين')}</button></div>{payment === 'paid' && <><label className="block text-sm font-semibold">{t('Cash received (DH)', 'المبلغ المستلم (درهم)')}<div className="mt-1 flex gap-2"><input type="number" inputMode="decimal" min="0" step="0.01" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} className={input} /><button type="button" onClick={() => setAmountPaid((totalCents / 100).toFixed(2))} className="shrink-0 rounded-xl border px-3 text-sm font-bold">{t('Exact', 'المبلغ بالضبط')}</button></div></label><p className="text-sm text-slate-500">{t('Change', 'الباقي')}: <strong>{money(Math.max(0, cents(amountPaid) - totalCents) / 100)}</strong></p></>}<details open={payment === 'unpaid' ? true : undefined}><summary className="cursor-pointer py-2 text-sm font-semibold text-slate-600">{payment === 'unpaid' ? t('Customer name and phone (required)', 'اسم العميل والهاتف (مطلوب)') : t('Customer details (optional)', 'بيانات العميل (اختياري)')}</summary><div className="mt-2 space-y-2"><input aria-label={t('Customer name', 'اسم العميل')} className={input} value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder={t('Customer name', 'اسم العميل')} /><input type="tel" aria-label={t('Customer phone', 'هاتف العميل')} className={input} value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder={t('Phone', 'الهاتف')} /></div></details><button className={primary + ' w-full'} disabled={locked || loading || !!loadError || !cart.length || unavailable} onClick={checkout}>{busy ? <Loader2 size={20} className="animate-spin" /> : <CheckCircle2 size={20} />}{payment === 'paid' ? t('Complete paid order', 'إتمام الطلب المدفوع') : t('Save unpaid order', 'حفظ طلب غير مدفوع')}</button></fieldset><p className="text-xs text-slate-500">{t('Prices and stock are checked again when you save. Internet connection required.', 'يتم التحقق مجدداً من الأسعار والمخزون عند الحفظ. الاتصال بالإنترنت ضروري.')}</p>
      </section>}
    </div>
  </div>
}
