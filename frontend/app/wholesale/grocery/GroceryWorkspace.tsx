"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, ImagePlus, Loader2, Minus, Package, Plus, RefreshCw, Scale, ShoppingBasket, Trash2, X } from 'lucide-react'
import BarcodeScanner from './BarcodeScanner'
import { normalizeBarcode, validateBarcode } from './scanner'
import { available, CartLine, exactProduct, GroceryProduct, kgToGrams, lineCents, priceCents, productImage, quantityLabel, searchProducts, shortCode } from './groceryData'

const API = process.env.NEXT_PUBLIC_API_BASE_URL || ''
type Lang = 'en' | 'ar'
type Props = { vendor: any; lang: Lang; mode: 'inventory' | 'sale'; initialProducts: any[]; productsReady: boolean; onDone: () => void; onChanged: () => void }
type Draft = { id?: number; barcode: string; short_code: string; name: string; price: string; stock: string; cost_price: string; unit_type: 'unit' | 'weight'; section: string; pack_count: string; pack_weight_kg: string; total_kg: string; image_url: string }
type Pending = { kind: 'product' | 'order'; method: string; path: string; body: any }
const blank: Draft = { barcode: '', short_code: '', name: '', price: '', stock: '', cost_price: '', unit_type: 'unit', section: 'G', pack_count: '1', pack_weight_kg: '', total_kg: '', image_url: '' }
const field = 'mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50'
const primary = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:opacity-40'
function moneyCents(value: number) { return (value / 100).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' DH' }
function StockImage({ product, size = 'h-12 w-12' }: { product?: Partial<GroceryProduct>; size?: string }) {
  const src = productImage(product)
  return src ? <img src={src.startsWith('/') ? API + src : src} alt={product?.title || ''} className={`${size} shrink-0 rounded-xl bg-slate-100 object-cover`} /> : <span className={`${size} flex shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700`}><Package size={22} /></span>
}

export function GroceryHome({ products, lang }: { products: any[]; lang: Lang }) {
  const ar = lang === 'ar'
  return <section className="mx-auto max-w-6xl rounded-3xl border border-emerald-100 bg-white p-6 md:p-8">
    <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-800"><ShoppingBasket size={18} />{ar ? 'متجرك، بطريقة أسهل' : 'Your grocery, made simple'}</div>
    <h2 className="text-2xl font-black">{ar ? 'بيع سريع، بالوحدة أو بالوزن' : 'Quick sales, by item or by weight.'}</h2>
    <p className="mt-3 max-w-xl text-slate-500">{ar ? 'ابحث بالاسم أو الرمز القصير أو امسح الباركود. المنتجات والعملاء والطلبات محفوظة في حساب بقالتك.' : 'Find products by name or short ID, or scan their code. Products, customers and orders belong to your grocery account.'}</p>
    <div className="mt-6 flex gap-8"><div><strong className="text-2xl">{products.length}</strong><p className="text-sm text-slate-500">{ar ? 'منتج' : 'Products'}</p></div><div><strong className="text-2xl">{products.filter(p => p.unit_type === 'weight').length}</strong><p className="text-sm text-slate-500">{ar ? 'منتج يباع بالوزن' : 'Sold by weight'}</p></div></div>
    {!!products.length && <div className="mt-6 flex flex-wrap gap-3">{products.slice(0, 6).map(p => <div key={p.id} className="flex items-center gap-2 rounded-xl border p-2"><StockImage product={p} size="h-10 w-10" /><div><strong className="block text-xs" dir="ltr">{p.short_code}</strong><span className="text-xs text-slate-500">{p.title}</span></div></div>)}</div>}
  </section>
}

export default function GroceryWorkspace({ vendor, lang, mode, initialProducts, productsReady, onDone, onChanged }: Props) {
  const ar = lang === 'ar', t = (en: string, arabic: string) => ar ? arabic : en
  const prefix = `/api/wholesale/vendors/${encodeURIComponent(vendor.id)}/grocery`
  const storageKey = `grocery-v2:${vendor.account_id}:${mode}`
  const [products, setProducts] = useState<GroceryProduct[]>(initialProducts)
  const [loading, setLoading] = useState(!productsReady)
  const [loadError, setLoadError] = useState('')
  const [draft, setDraft] = useState<Draft>({ ...blank })
  const [dirty, setDirty] = useState(false)
  const [cart, setCart] = useState<CartLine[]>([])
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [payment, setPayment] = useState<'paid' | 'unpaid'>('paid')
  const [amountPaid, setAmountPaid] = useState('')
  const [query, setQuery] = useState('')
  const [clearInputKey, setClearInputKey] = useState(0)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null)
  const [receipt, setReceipt] = useState<any>(null)
  const [savedProduct, setSavedProduct] = useState<GroceryProduct | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [ready, setReady] = useState(false)
  const [weightProduct, setWeightProduct] = useState<GroceryProduct | null>(null)
  const [weightValue, setWeightValue] = useState('')
  const [weightError, setWeightError] = useState('')
  const [weightUnit, setWeightUnit] = useState<'g' | 'kg'>('g')
  const weightPromptRef = useRef(false)
  const busyRef = useRef(false), weightRef = useRef<HTMLInputElement>(null), nameRef = useRef<HTMLInputElement>(null)
  const byId = useMemo(() => new Map(products.map(p => [Number(p.id), p])), [products])
  const suggestions = useMemo(() => searchProducts(products, query), [products, query])
  const total = cart.reduce((sum, line) => { const p = byId.get(line.variant_id); return sum + (p ? lineCents(p, line) : 0) }, 0)
  const unavailable = cart.some(line => { const p = byId.get(line.variant_id); return !p || (p.unit_type === 'weight' ? (line.grams || 0) : (line.quantity || 0)) > available(p) })
  const locked = busy || !!pending || !!receipt
  const scannerPaused = locked || loading || !!loadError || uploading || !!weightProduct || mode === 'inventory' && (dirty || !!draft.id)
  const newWeightGrams = kgToGrams(draft.pack_weight_kg)
  const packTotal = newWeightGrams === null ? null : Number(draft.pack_count || 0) * newWeightGrams

  useEffect(() => { if (productsReady) { setProducts(initialProducts); setLoading(false) } }, [initialProducts, productsReady])
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null')
      if (saved && saved.account_id === vendor.account_id) {
        setDraft(saved.draft || { ...blank }); setDirty(!!saved.dirty); setCart(saved.cart || [])
        setCustomerName(saved.customerName || ''); setCustomerPhone(saved.customerPhone || ''); setPayment(saved.payment || 'paid')
        setAmountPaid(saved.amountPaid || ''); setPending(saved.pending || null); setReceipt(saved.receipt || null)
      }
    } catch { /* Unreadable drafts are never submitted. */ }
    setReady(true)
  }, [storageKey, vendor.account_id])
  function snapshot(operation = pending) { return { account_id: vendor.account_id, draft, dirty, cart, customerName, customerPhone, payment, amountPaid, pending: operation, receipt } }
  useEffect(() => { if (ready) { try { sessionStorage.setItem(storageKey, JSON.stringify(snapshot())) } catch {} } }, [ready, storageKey, draft, dirty, cart, customerName, customerPhone, payment, amountPaid, pending, receipt])
  useEffect(() => { setMessage(null) }, [lang])

  async function request(path: string, method = 'GET', body?: any) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000)
    try {
      const response = await fetch(API + path, { method, cache: 'no-store', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vendor.grocery_token || ''}` }, ...(body ? { body: JSON.stringify(body) } : {}) })
      const result = await response.json()
      if (!response.ok || result.error) {
        const detail = result.detail || result
        const error: any = new Error(typeof detail === 'string' ? detail : detail.message || detail.error || t('Check the entered information.', 'تحقق من المعلومات المدخلة.'))
        error.code = detail.error; error.status = response.status; throw error
      }
      return result
    } finally { clearTimeout(timer) }
  }
  async function reload() {
    setLoading(true); setLoadError('')
    try { const r = await request(prefix + '/products'); setProducts(r.data || []) }
    catch (e: any) { setLoadError(e.message || t('Stock could not load.', 'تعذر تحميل المخزون.')) }
    finally { setLoading(false) }
  }
  function resetLookup() { setQuery(''); setClearInputKey(k => k + 1) }
  function update<K extends keyof Draft>(key: K, value: Draft[K]) { setDirty(true); setDraft(d => ({ ...d, [key]: value })); setSavedProduct(null) }
  function edit(product: GroceryProduct) {
    if (locked || busyRef.current) return
    setDraft({ id: product.id, barcode: product.barcode || '', short_code: product.short_code, name: product.title, price: product.price, stock: String(product.stock ?? available(product)), cost_price: String((product as any).cost_price ?? ''), unit_type: product.unit_type, section: product.section || 'G', pack_count: String(product.pack_count || 1), pack_weight_kg: String(product.pack_weight_kg || ''), total_kg: String((product.stock_grams || 0) / 1000), image_url: productImage(product) })
    setDirty(false); setMessage(null); setSavedProduct(null); resetLookup(); setTimeout(() => nameRef.current?.focus(), 0)
  }
  function addUnit(product: GroceryProduct) {
    const previous = cart.find(l => l.variant_id === product.id)
    if ((previous?.quantity || 0) >= available(product)) { setMessage({ error: true, text: t('Not enough stock.', 'المخزون غير كاف.') }); return }
    setCart(c => { const row = c.find(l => l.variant_id === product.id); if ((row?.quantity || 0) >= available(product)) return c; return row ? c.map(l => l.variant_id === product.id ? { ...l, quantity: (l.quantity || 0) + 1 } : l) : [...c, { variant_id: product.id, quantity: 1 }] })
    resetLookup(); setMessage(null)
  }
  function choose(product: GroceryProduct) {
    if (locked || weightPromptRef.current || busyRef.current) return
    if (mode === 'inventory') { edit(product); return }
    if (product.unit_type === 'weight') { weightPromptRef.current = true; setWeightProduct(product); setWeightError(''); setWeightValue(''); setWeightUnit('g'); resetLookup(); setTimeout(() => weightRef.current?.focus(), 0) }
    else addUnit(product)
  }
  function scan(raw: string) {
    if (scannerPaused || weightPromptRef.current || busyRef.current) return
    const exact = exactProduct(products, raw)
    if (exact) { choose(exact); return }
    const possible = searchProducts(products, raw)
    if (possible.length || /^[a-z]{1,8}-?\d*$/i.test(raw)) { setQuery(raw); setMessage({ error: true, text: t('Choose a matching product below. No exact ID was selected.', 'اختر منتجاً من النتائج أدناه. لم يتم اختيار رمز مطابق.') }); return }
    if (mode === 'sale') { setMessage({ error: true, text: t('Product not found. Add it to your catalog first.', 'المنتج غير مسجل. أضفه إلى الكتالوج أولاً.') }); return }
    if (!validateBarcode(raw)) { setMessage({ error: true, text: t('Check the barcode or add a product without a barcode.', 'تحقق من الباركود أو أضف المنتج بدونه.') }); return }
    setDraft({ ...blank, barcode: normalizeBarcode(raw) }); setDirty(true); setMessage({ error: false, text: t('New product. Add its details once; a short ID is assigned automatically.', 'منتج جديد. أدخل بياناته مرة واحدة وسيتم إنشاء رمز قصير تلقائياً.') }); setTimeout(() => nameRef.current?.focus(), 0)
  }
  function addWeight(e: React.FormEvent) {
    e.preventDefault(); if (!weightProduct) return
    const grams = weightUnit === 'kg' ? kgToGrams(weightValue) : /^\d+$/.test(weightValue) ? Number(weightValue) : null
    const current = cart.find(l => l.variant_id === weightProduct.id)?.grams || 0
    if (!grams || !Number.isSafeInteger(grams) || grams < 1 || current + grams > available(weightProduct)) { setWeightError(t('Enter whole grams within the available stock.', 'أدخل وزناً بالغرام ضمن المخزون المتوفر.')); return }
    setCart(c => { const row = c.find(l => l.variant_id === weightProduct.id); return row ? c.map(l => l.variant_id === weightProduct.id ? { ...l, grams: (l.grams || 0) + grams } : l) : [...c, { variant_id: weightProduct.id, grams }] })
    weightPromptRef.current = false; setWeightProduct(null); setMessage(null); resetLookup()
  }
  async function upload(file?: File) {
    if (!file) return
    if (file.size > 8 * 1024 * 1024) { setMessage({ error: true, text: t('Choose an image smaller than 8 MB.', 'اختر صورة أصغر من 8 ميغابايت.') }); return }
    setUploading(true); setMessage(null)
    try {
      const body = new FormData(); body.append('image', file)
      const response = await fetch(API + prefix + '/images', { method: 'POST', headers: { Authorization: `Bearer ${vendor.grocery_token}` }, body })
      const result = await response.json(), url = result.data?.image_url
      if (!response.ok || !url) throw new Error(result.detail?.message || t('Image upload failed.', 'تعذر رفع الصورة.'))
      update('image_url', url)
    } catch (e: any) { setMessage({ error: true, text: e.message }) }
    finally { setUploading(false) }
  }
  function errorText(e: any) {
    const messages: Record<string, [string, string]> = { insufficient_inventory: ['Stock changed. Adjust the basket.', 'تغير المخزون. عدّل السلة.'], insufficient_payment: ['Cash received is less than the total.', 'المبلغ المستلم أقل من الإجمالي.'], invalid_session: ['Sign out and sign in again to refresh your account.', 'سجل الخروج ثم ادخل مجدداً لتحديث الحساب.'], unpaid_customer_required: ['A credit order needs customer name and phone.', 'طلب الدين يحتاج اسم العميل وهاتفه.'], duplicate_barcode: ['This barcode belongs to another product in your account.', 'هذا الباركود مسجل لمنتج آخر في حسابك.'], account_setup_required: ['Sign out and sign in again to initialize your private grocery account.', 'سجل الخروج ثم ادخل مجدداً لتهيئة حساب البقالة الخاص بك.'] }
    return messages[e.code] ? t(...messages[e.code]) : e.message || t('Connection interrupted. Check the same request.', 'انقطع الاتصال. تحقق من نفس العملية.')
  }
  function applyProducts(changed: GroceryProduct[]) {
    setProducts(previous => { const result = new Map(previous.map(p => [p.id, p])); changed.forEach(p => result.set(p.id, p)); return [...result.values()] })
  }
  async function submit(operation: Pending) {
    if (busyRef.current) return
    if (!navigator.onLine) { setMessage({ error: true, text: t('Connect to the internet before saving.', 'اتصل بالإنترنت قبل الحفظ.') }); return }
    busyRef.current = true; setBusy(true); setMessage(null)
    try { sessionStorage.setItem(storageKey, JSON.stringify(snapshot(operation))) }
    catch { busyRef.current = false; setBusy(false); setMessage({ error: true, text: t('Enable browser storage before submitting.', 'فعّل تخزين المتصفح قبل الإرسال.') }); return }
    setPending(operation)
    try {
      const result = await request(operation.path, operation.method, operation.body)
      if (!result.data) throw new Error(t('Check the same request to recover the result.', 'تحقق من نفس العملية لاسترجاع النتيجة.'))
      if (operation.kind === 'order') { setReceipt(result.data); setCart([]); setAmountPaid(''); setCustomerName(''); setCustomerPhone(''); if (result.products) applyProducts(result.products) }
      else { applyProducts([result.data]); setSavedProduct(result.data); setDraft({ ...blank, section: draft.section }); setDirty(false); resetLookup(); setMessage({ error: false, text: t(`Product saved · ${result.data.short_code}`, `تم حفظ المنتج · ${result.data.short_code}`) }) }
      setPending(null); onChanged()
    } catch (e: any) {
      setMessage({ error: true, text: errorText(e) })
      if (e.status >= 400 && e.status < 500 && !['request_in_progress', 'request_conflict'].includes(e.code)) setPending(null)
    } finally { busyRef.current = false; setBusy(false) }
  }
  function saveProduct(e: React.FormEvent) {
    e.preventDefault()
    if (!draft.name.trim() || !/^\d+(\.\d{1,2})?$/.test(draft.price) || priceCents(draft.price) <= 0) { setMessage({ error: true, text: t('Enter a name and a positive selling price.', 'أدخل الاسم وثمن بيع موجباً.') }); return }
    const body: any = { request_id: crypto.randomUUID(), name: draft.name.trim(), barcode: draft.barcode.trim() || null, price: draft.price, unit_type: draft.unit_type, section: draft.section.toUpperCase(), image_url: draft.image_url || null, ...(draft.cost_price ? { cost_price: draft.cost_price } : {}) }
    if (draft.unit_type === 'weight') {
      if (draft.id) { const grams = kgToGrams(draft.total_kg); if (grams === null) { setMessage({ error: true, text: t('Enter total stock in kilograms, up to 3 decimals.', 'أدخل إجمالي المخزون بالكيلوغرام، حتى 3 منازل عشرية.') }); return }; body.stock_grams = grams }
      else { if (!/^\d+$/.test(draft.pack_count) || Number(draft.pack_count) < 1 || !newWeightGrams) { setMessage({ error: true, text: t('Enter the number of bags and kilograms in each bag.', 'أدخل عدد الأكياس ووزن كل كيس بالكيلوغرام.') }); return }; body.pack_count = Number(draft.pack_count); body.pack_weight_kg = draft.pack_weight_kg }
    } else { if (!/^\d+$/.test(draft.stock)) { setMessage({ error: true, text: t('Enter whole-unit stock.', 'أدخل المخزون بعدد صحيح من الوحدات.') }); return }; body.stock = Number(draft.stock) }
    void submit({ kind: 'product', method: draft.id ? 'PATCH' : 'POST', path: prefix + '/products' + (draft.id ? '/' + draft.id : ''), body })
  }
  function checkout() {
    if (!cart.length || unavailable) return
    if (payment === 'unpaid' && (!customerName.trim() || !customerPhone.trim())) { setMessage({ error: true, text: t('A credit order needs customer name and phone.', 'طلب الدين يحتاج اسم العميل وهاتفه.') }); return }
    if (payment === 'paid' && (!/^\d+(\.\d{1,2})?$/.test(amountPaid) || priceCents(amountPaid) < total)) { setMessage({ error: true, text: t('Enter cash received, at least the total.', 'أدخل المبلغ المستلم على ألا يقل عن الإجمالي.') }); return }
    void submit({ kind: 'order', method: 'POST', path: prefix + '/orders', body: { request_id: crypto.randomUUID(), line_items: cart, customer_name: customerName.trim(), customer_phone: customerPhone.trim(), payment_status: payment, ...(payment === 'paid' ? { amount_paid: amountPaid } : {}) } })
  }

  return <div dir={ar ? 'rtl' : 'ltr'} className="mx-auto max-w-6xl space-y-4 pb-12">
    <header className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-emerald-700">{t('Grocery account', 'حساب البقالة')}</p><h1 className="mt-1 text-2xl font-black">{mode === 'sale' ? t('Create order', 'إنشاء طلب') : t('Add a product', 'إضافة منتج')}</h1><p className="mt-1 text-sm text-slate-500">{t('Type a short ID or name. Scanning is always available.', 'اكتب الرمز القصير أو الاسم. يمكنك أيضاً مسح الرمز.')}</p></div><button aria-label={t('Refresh stock', 'تحديث المخزون')} onClick={reload} disabled={loading || busy} className="rounded-xl border bg-white p-3"><RefreshCw size={20} className={loading ? 'animate-spin' : ''} /></button></header>
    {message && <p role={message.error ? 'alert' : 'status'} className={`rounded-xl border p-3 text-sm ${message.error ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>{message.text}</p>}
    {loadError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-red-800">{loadError} <button onClick={reload} className="font-bold underline">{t('Retry', 'إعادة المحاولة')}</button></p>}
    {pending && <section className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="font-bold">{t('Recover the saved request without creating it twice.', 'استرجع العملية المحفوظة دون إنشائها مرتين.')}</p><code className="my-2 block text-xs" dir="ltr">{pending.body.request_id}</code><button disabled={busy} className={primary} onClick={() => submit(pending)}>{busy && <Loader2 className="animate-spin" size={18} />}{t('Check same request', 'التحقق من نفس العملية')}</button></section>}
    {savedProduct && <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-white p-4"><StockImage product={savedProduct} /><div><strong className="block">{savedProduct.title}</strong><span className="text-2xl font-black text-emerald-800" dir="ltr">{savedProduct.short_code}</span><span className="ms-3 text-sm text-slate-500">{quantityLabel(savedProduct, lang)}</span></div></div>}
    {receipt && <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><h2 className="flex items-center gap-2 text-lg font-bold"><CheckCircle2 />{t('Order saved', 'تم حفظ الطلب')} {receipt.name}</h2><p className="mt-2">{t('Total', 'الإجمالي')}: <strong>{moneyCents(priceCents(receipt.total_price))}</strong> · {receipt.financial_status === 'paid' ? t('Paid', 'مدفوع') : t('Unpaid', 'غير مدفوع')}</p>{receipt.financial_status === 'paid' && <p>{t('Change', 'الباقي')}: <strong>{moneyCents(priceCents(receipt.change || 0))}</strong></p>}<div className="mt-3 flex flex-wrap gap-4"><button className={primary} onClick={() => { setReceipt(null); setMessage(null); resetLookup() }}>{t('Create another order', 'إنشاء طلب آخر')}</button><button className="font-bold underline" onClick={onDone}>{t('View orders', 'عرض الطلبات')}</button></div></section>}
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <div className="space-y-3"><BarcodeScanner onScan={scan} onInputChange={setQuery} clearInputKey={clearInputKey} lang={lang} disabled={scannerPaused} />
        {!!suggestions.length && !scannerPaused && <div role="listbox" aria-label={t('Matching products', 'المنتجات المطابقة')} className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-sm">{suggestions.map(p => <button key={p.id} role="option" aria-selected="false" onClick={() => choose(p)} className="flex w-full items-center gap-3 border-b border-slate-100 p-3 text-start last:border-b-0 hover:bg-emerald-50"><StockImage product={p} /><div className="min-w-0 flex-1"><strong className="block truncate">{p.title}</strong><span className="font-mono text-sm font-bold text-emerald-800" dir="ltr">{p.short_code}</span><span className="ms-2 text-xs text-slate-500">{quantityLabel(p, lang)}</span></div><div className="shrink-0 text-sm font-bold">{moneyCents(priceCents(p.price))}<small className="block text-end font-normal text-slate-500">/{p.unit_type === 'weight' ? t('kg', 'كغ') : t('unit', 'وحدة')}</small></div></button>)}</div>}
        {query && !suggestions.length && !scannerPaused && <p className="rounded-xl bg-white p-4 text-sm text-slate-500">{t('No matching product. Add it first, or check the ID.', 'لا يوجد منتج مطابق. أضفه أولاً أو تحقق من الرمز.')}</p>}
        {loading && <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={16} className="animate-spin" />{t('Loading products…', 'جار تحميل المنتجات…')}</p>}
        {mode === 'inventory' && (dirty || draft.id) && !locked && <button className="w-full rounded-xl border bg-white p-3 font-bold" onClick={() => { if (!dirty || window.confirm(t('Discard unsaved changes and add another product?', 'تجاهل التغييرات غير المحفوظة وإضافة منتج آخر؟'))) { setDraft({ ...blank, section: draft.section }); setDirty(false); setMessage(null); resetLookup() } }}>{t('Add another product', 'إضافة منتج آخر')}</button>}
        <p className="px-1 text-xs leading-5 text-slate-500">{t('Every product gets a short ID. Type L for its section, or l23 to find L-23 and similar IDs.', 'كل منتج له رمز قصير. اكتب L لعرض القسم، أو l23 للعثور على L-23 والرموز المشابهة.')}</p>
      </div>
      {mode === 'inventory' ? <form onSubmit={saveProduct} className="space-y-4 rounded-2xl border bg-white p-5"><h2 className="text-lg font-bold">{draft.id ? t('Edit product', 'تعديل المنتج') : t('Product details', 'بيانات المنتج')}</h2><fieldset disabled={locked || uploading} className="space-y-4">
        <div className="flex items-center gap-4"><StockImage product={{ image_url: draft.image_url, title: draft.name }} size="h-20 w-20" /><label className="cursor-pointer rounded-xl border px-4 py-3 text-sm font-bold"><span className="flex items-center gap-2">{uploading ? <Loader2 className="animate-spin" size={18} /> : <ImagePlus size={18} />}{t('Product image', 'صورة المنتج')}</span><input aria-label={t('Product image', 'صورة المنتج')} type="file" accept="image/jpeg,image/png,image/webp" disabled={locked || uploading} className="sr-only" onChange={e => { void upload(e.target.files?.[0]); e.target.value = '' }} /></label></div>
        <label className="block text-sm font-semibold">{t('Product name', 'اسم المنتج')}<input ref={nameRef} required maxLength={200} value={draft.name} onChange={e => update('name', e.target.value)} className={field} /></label>
        <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-semibold">{t('Section initial (e.g. L)', 'حرف القسم (مثلاً L)')}<input required dir="ltr" maxLength={8} pattern="[A-Za-z]{1,8}" value={draft.section} readOnly={!!draft.id} onChange={e => update('section', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} className={field} placeholder="L" /></label><div className="text-sm font-semibold">{t('Short product ID', 'الرمز القصير')}<div className={field + ' font-mono font-black text-emerald-800'} dir="ltr">{draft.short_code || `${draft.section || 'G'}-…`}</div></div></div>
        <div className="grid grid-cols-2 gap-2"><button type="button" disabled={!!draft.id} onClick={() => update('unit_type', 'unit')} aria-pressed={draft.unit_type === 'unit'} className={`flex items-center justify-center gap-2 rounded-xl border p-3 font-bold ${draft.unit_type === 'unit' ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : ''}`}><Package size={18} />{t('By item', 'بالوحدة')}</button><button type="button" disabled={!!draft.id} onClick={() => update('unit_type', 'weight')} aria-pressed={draft.unit_type === 'weight'} className={`flex items-center justify-center gap-2 rounded-xl border p-3 font-bold ${draft.unit_type === 'weight' ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : ''}`}><Scale size={18} />{t('By weight', 'بالوزن')}</button></div>
        <label className="block text-sm font-semibold">{draft.unit_type === 'weight' ? t('Selling price per kg (DH)', 'ثمن البيع لكل كغ (درهم)') : t('Selling price per item (DH)', 'ثمن بيع الوحدة (درهم)')}<input required type="number" inputMode="decimal" min="0.01" step="0.01" value={draft.price} onChange={e => update('price', e.target.value)} className={field} /></label>
        {draft.unit_type === 'weight' ? draft.id ? <label className="block text-sm font-semibold">{t('Total stock remaining (kg)', 'إجمالي المخزون المتبقي (كغ)')}<input required type="number" inputMode="decimal" min="0" step="0.001" value={draft.total_kg} onChange={e => update('total_kg', e.target.value)} className={field} /><span className="mt-1 block text-xs font-normal text-slate-500">{t('Enter the complete remaining stock, including new deliveries.', 'أدخل المخزون الإجمالي المتبقي بما فيه الكميات الجديدة.')}</span></label> : <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3"><div className="grid grid-cols-2 gap-3"><label className="text-sm font-semibold">{t('Number of bags / packs', 'عدد الأكياس / العبوات')}<input required type="number" inputMode="numeric" min="1" step="1" value={draft.pack_count} onChange={e => update('pack_count', e.target.value)} className={field} /></label><label className="text-sm font-semibold">{t('Weight of each (kg)', 'وزن كل واحد (كغ)')}<input required type="number" inputMode="decimal" min="0.001" step="0.001" value={draft.pack_weight_kg} onChange={e => update('pack_weight_kg', e.target.value)} className={field} placeholder="25" /></label></div><p className="mt-3 text-sm font-bold text-emerald-900">{draft.pack_count || '0'} × {draft.pack_weight_kg || '0'} kg = {packTotal === null ? '—' : packTotal / 1000} kg</p></div> : <label className="block text-sm font-semibold">{t('Total stock (items)', 'إجمالي المخزون (وحدات)')}<input required type="number" inputMode="numeric" min="0" step="1" value={draft.stock} onChange={e => update('stock', e.target.value)} className={field} /></label>}
        <details><summary className="cursor-pointer text-sm font-semibold text-slate-600">{t('Barcode and cost (optional)', 'الباركود والتكلفة (اختياري)')}</summary><div className="mt-3 space-y-3"><label className="block text-sm">{t('Barcode', 'الباركود')}<input dir="ltr" value={draft.barcode} maxLength={64} onChange={e => update('barcode', e.target.value)} className={field} /></label><label className="block text-sm">{draft.unit_type === 'weight' ? t('Cost per kg (DH)', 'تكلفة الكغ (درهم)') : t('Cost per item (DH)', 'تكلفة الوحدة (درهم)')}<input type="number" inputMode="decimal" min="0" step="0.01" value={draft.cost_price} onChange={e => update('cost_price', e.target.value)} className={field} /></label></div></details>
        <button disabled={locked || uploading || loading || !!loadError} className={primary + ' w-full'}>{busy ? <Loader2 size={19} className="animate-spin" /> : <CheckCircle2 size={19} />}{draft.id ? t('Save changes', 'حفظ التغييرات') : t('Add product', 'إضافة المنتج')}</button>
      </fieldset></form> : <section className="space-y-4 rounded-2xl border bg-white p-5"><h2 className="flex items-center gap-2 text-lg font-bold"><ShoppingBasket size={20} />{t('Basket', 'السلة')}<span className="text-sm text-slate-400">{cart.length}</span></h2>
        {!cart.length && <div className="rounded-xl bg-slate-50 px-4 py-8 text-center text-slate-500">{t('Find or scan the first product.', 'ابحث عن أول منتج أو امسح رمزه.')}</div>}
        <div className="divide-y">{cart.map(line => { const p = byId.get(line.variant_id); const weight = p?.unit_type === 'weight'; return <div key={line.variant_id} className="flex gap-3 py-3"><StockImage product={p} /><div className="min-w-0 flex-1"><div className="flex justify-between gap-2"><strong className="truncate">{p?.title || t('Unavailable product', 'منتج غير متوفر')}</strong><strong className="whitespace-nowrap">{moneyCents(p ? lineCents(p, line) : 0)}</strong></div><p className="mt-0.5 text-xs text-slate-500"><span dir="ltr" className="font-mono font-bold">{p?.short_code}</span> · {moneyCents(priceCents(p?.price || 0))}/{weight ? t('kg', 'كغ') : t('unit', 'وحدة')}</p><div className="mt-2 flex items-center justify-between gap-2">{weight ? <span className="rounded-lg bg-emerald-50 px-3 py-2 font-bold text-emerald-900">{(line.grams || 0) / 1000} {t('kg', 'كغ')} <small className="font-normal">({line.grams} g)</small></span> : <div className="flex items-center gap-2"><button disabled={locked} aria-label={t('Decrease quantity', 'تقليل الكمية')} onClick={() => setCart(c => c.map(l => l.variant_id === line.variant_id ? { ...l, quantity: (l.quantity || 0) - 1 } : l).filter(l => (l.quantity || l.grams || 0) > 0))} className="rounded-lg border p-2"><Minus size={16} /></button><strong className="min-w-6 text-center">{line.quantity}</strong><button disabled={locked || !p || (line.quantity || 0) >= available(p)} aria-label={t('Increase quantity', 'زيادة الكمية')} onClick={() => p && addUnit(p)} className="rounded-lg border p-2 disabled:opacity-30"><Plus size={16} /></button></div>}<button disabled={locked} aria-label={t('Remove product', 'حذف المنتج')} onClick={() => setCart(c => c.filter(l => l.variant_id !== line.variant_id))} className="p-2 text-red-600"><Trash2 size={17} /></button></div>{(!p || (weight ? line.grams || 0 : line.quantity || 0) > available(p)) && <p className="mt-1 text-sm text-red-700">{t('Adjust quantity to current stock.', 'عدّل الكمية حسب المخزون الحالي.')}</p>}</div></div> })}</div>
        <div className="flex justify-between border-t pt-4 text-xl font-black"><span>{t('Total', 'الإجمالي')}</span><span>{moneyCents(total)}</span></div><fieldset disabled={locked} className="space-y-3"><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setPayment('paid')} aria-pressed={payment === 'paid'} className={`rounded-xl border p-3 font-bold ${payment === 'paid' ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : ''}`}>{t('Cash · paid', 'نقداً · مدفوع')}</button><button type="button" onClick={() => setPayment('unpaid')} aria-pressed={payment === 'unpaid'} className={`rounded-xl border p-3 font-bold ${payment === 'unpaid' ? 'border-amber-500 bg-amber-50 text-amber-900' : ''}`}>{t('Unpaid / credit', 'غير مدفوع / دين')}</button></div>
        {payment === 'paid' && <><label className="block text-sm font-semibold">{t('Cash received (DH)', 'المبلغ المستلم (درهم)')}<div className="mt-1 flex gap-2"><input aria-label={t('Cash received (DH)', 'المبلغ المستلم (درهم)')} type="number" inputMode="decimal" min="0" step="0.01" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} className={field + ' mt-0'} /><button type="button" onClick={() => setAmountPaid((total / 100).toFixed(2))} className="shrink-0 rounded-xl border px-3 text-sm font-bold">{t('Exact', 'المبلغ بالضبط')}</button></div></label><p className="text-sm text-slate-500">{t('Change', 'الباقي')}: <strong>{moneyCents(Math.max(0, priceCents(amountPaid) - total))}</strong></p></>}
        <details open={payment === 'unpaid' ? true : undefined}><summary className="cursor-pointer py-2 text-sm font-semibold text-slate-600">{payment === 'unpaid' ? t('Customer name and phone (required)', 'اسم العميل والهاتف (مطلوب)') : t('Customer details (optional)', 'بيانات العميل (اختياري)')}</summary><div className="space-y-2"><input aria-label={t('Customer name', 'اسم العميل')} value={customerName} onChange={e => setCustomerName(e.target.value)} className={field} placeholder={t('Customer name', 'اسم العميل')} /><input type="tel" aria-label={t('Customer phone', 'هاتف العميل')} value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} className={field} placeholder={t('Phone', 'الهاتف')} /></div></details><button className={primary + ' w-full'} disabled={locked || loading || !!loadError || !cart.length || unavailable || !!weightProduct} onClick={checkout}>{busy ? <Loader2 size={20} className="animate-spin" /> : <CheckCircle2 size={20} />}{t('Create order', 'إنشاء الطلب')}</button></fieldset>
      </section>}
    </div>
    {weightProduct && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-4"><form onSubmit={addWeight} role="dialog" aria-modal="true" aria-labelledby="weight-title" className="w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-xl"><div className="flex items-center gap-3"><StockImage product={weightProduct} /><div className="min-w-0 flex-1"><h2 id="weight-title" className="truncate text-lg font-black">{weightProduct.title}</h2><p className="text-sm text-slate-500">{weightProduct.short_code} · {quantityLabel(weightProduct, lang)} {t('available', 'متوفر')}</p></div><button type="button" aria-label={t('Close weight entry', 'إغلاق إدخال الوزن')} onClick={() => { weightPromptRef.current = false; setWeightProduct(null); setMessage(null); resetLookup() }}><X size={22} /></button></div>{weightError && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{weightError}</p>}<label className="block text-sm font-bold">{t('How much is the customer buying?', 'ما الوزن الذي يشتريه العميل؟')}<div className="mt-2 flex gap-2"><input ref={weightRef} aria-label={t('Sale weight', 'وزن البيع')} required type="number" inputMode="decimal" min={weightUnit === 'g' ? '1' : '0.001'} step={weightUnit === 'g' ? '1' : '0.001'} value={weightValue} onChange={e => setWeightValue(e.target.value)} className={field + ' mt-0 text-2xl font-bold'} /><select aria-label={t('Weight unit', 'وحدة الوزن')} value={weightUnit} onChange={e => { setWeightUnit(e.target.value as 'g' | 'kg'); setWeightValue('') }} className="rounded-xl border px-4 font-bold"><option value="g">{t('grams', 'غرام')}</option><option value="kg">{t('kg', 'كغ')}</option></select></div></label><div className="grid grid-cols-3 gap-2">{[250, 500, 1000].map(g => <button key={g} type="button" onClick={() => { setWeightUnit('g'); setWeightValue(String(g)) }} className="rounded-xl border py-3 text-sm font-bold">{g === 1000 ? '1 kg' : `${g} g`}</button>)}</div><p className="text-sm text-slate-500">{moneyCents(priceCents(weightProduct.price))}/{t('kg', 'كغ')}</p><button className={primary + ' w-full'}>{t('Add to order', 'إضافة إلى الطلب')}</button></form></div>}
  </div>
}
