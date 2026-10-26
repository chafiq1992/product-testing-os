'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, CheckCircle2, ChevronRight, Loader2, MessageCircle, Minus, Plus, RefreshCw, Scale, Search, ShoppingBag, ShoppingBasket, Trash2 } from 'lucide-react'
import {
  Customer, CustomerApiError, CustomerCatalog, CustomerMerchant, CustomerOrderRequest, CustomerProduct, CustomerVariant,
  customerApi, customerError, customerImage, customerLineCents, customerMoney, customerPriceCents, customerStock, customerWeight, gramsFromInput, withCustomerCartLock, canPersistCustomerCartDraft,
} from '../../lib/customer'
import { CustomerDialog, CustomerPhoto, customerButton, customerField } from './CustomerUi'

type Lang = 'en' | 'ar'
type CartLine = {
  product_id: string | number; variant_id: string | number; title: string; variant_title: string
  image: string; price: string | number; weight: boolean; amount: number; available: number
  fulfillment_group?: string; currency?: string
}
type SavedCart = {
  customer_id: string; merchant_ref: string; lines: CartLine[]; name: string; address1: string; city: string
  pending: CustomerOrderRequest | null
  revision?: number
}
type Choice = { product: CustomerProduct; variant: CustomerVariant | null; replace?: boolean }
const lineKey = (line: Pick<CartLine, 'product_id' | 'variant_id'>) => `${line.product_id}::${line.variant_id}`

export default function CustomerStorefront({ customer, merchant, lang, onBack, onChat, onOrders, onOrderPlaced }: {
  customer: Customer; merchant: CustomerMerchant; lang: Lang; onBack: () => void
  onChat: (merchant: CustomerMerchant) => void; onOrders: () => void; onOrderPlaced: () => void
}) {
  const ar = lang === 'ar', t = (en: string, arabic: string) => ar ? arabic : en
  const storageKey = `customer-cart:v1:${customer.id}:${merchant.ref}`
  const [catalog, setCatalog] = useState<CustomerCatalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [lines, setLines] = useState<CartLine[]>([])
  const [ready, setReady] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [choice, setChoice] = useState<Choice | null>(null)
  const [weight, setWeight] = useState('')
  const [weightUnit, setWeightUnit] = useState<'g' | 'kg'>('g')
  const [choiceError, setChoiceError] = useState('')
  const [name, setName] = useState(customer.name || '')
  const [address1, setAddress1] = useState('')
  const [city, setCity] = useState('')
  const [pending, setPending] = useState<CustomerOrderRequest | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null)
  const [receipt, setReceipt] = useState<{ name: string; total: string | number } | null>(null)
  const busyRef = useRef(false)
  const revisionRef = useRef(0)
  const persistEpochRef = useRef(0)
  const cartCount = lines.reduce((sum, line) => sum + (line.weight ? 1 : line.amount), 0)
  const subtotal = lines.reduce((sum, line) => sum + customerLineCents(line.price, line.amount, line.weight), 0)
  const locked = saving || !!pending
  const requiresDelivery = !!(catalog?.merchant.requires_delivery ?? merchant.requires_delivery)
  const currency = lines[0]?.currency || catalog?.currency || 'MAD'
  const deliveryFee = requiresDelivery && lines.length ? customerPriceCents(catalog?.delivery_fees?.[currency] ?? catalog?.delivery_fee) : 0
  const total = subtotal + deliveryFee
  const money = (cents: number) => customerMoney(cents, lang, currency)

  function snapshot(overrides: Partial<SavedCart> = {}): SavedCart {
    return { customer_id: customer.id, merchant_ref: merchant.ref, lines, name, address1, city, pending, revision: revisionRef.current, ...overrides }
  }
  function restore(saved: SavedCart) {
    revisionRef.current = saved.revision || 0
    setLines(Array.isArray(saved.lines) ? saved.lines.filter(line => line && Number.isSafeInteger(line.amount) && line.amount > 0) : [])
    setName(saved.name || customer.name || ''); setAddress1(saved.address1 || ''); setCity(saved.city || '')
    setPending(saved.pending?.merchant_ref === merchant.ref ? saved.pending : null)
  }
  function write(overrides: Partial<SavedCart>) {
    const stored = JSON.parse(localStorage.getItem(storageKey) || 'null') as SavedCart | null
    const revision = Math.max(stored?.revision || 0, revisionRef.current) + 1
    localStorage.setItem(storageKey, JSON.stringify(snapshot({ ...overrides, revision })))
    revisionRef.current = revision
  }
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null') as SavedCart | null
      if (saved?.customer_id === customer.id && saved.merchant_ref === merchant.ref) {
        restore(saved)
      }
    } catch { /* Unreadable drafts are never submitted automatically. */ }
    setReady(true)
  }, [customer.id, merchant.ref, storageKey])
  useEffect(() => {
    if (!ready || busyRef.current) return
    const draft = snapshot(), epoch = ++persistEpochRef.current
    void withCustomerCartLock(storageKey, () => {
      if (epoch !== persistEpochRef.current) return
      try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || 'null') as SavedCart | null
        if (!canPersistCustomerCartDraft(saved, draft)) {
          if (saved) restore(saved)
          return
        }
        if (saved && JSON.stringify({ ...saved, revision: 0 }) === JSON.stringify({ ...draft, revision: 0 })) return
        const revision = (saved?.revision || 0) + 1
        localStorage.setItem(storageKey, JSON.stringify({ ...draft, revision }))
        revisionRef.current = revision
      } catch { /* Checkout requires a successful durable save. */ }
    })
  }, [ready, storageKey, lines, name, address1, city, pending])
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== storageKey || !event.newValue || busyRef.current) return
      try {
        const saved = JSON.parse(event.newValue) as SavedCart
        if (saved.customer_id !== customer.id || saved.merchant_ref !== merchant.ref) return
        restore(saved)
      } catch { /* Ignore malformed browser data. */ }
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [storageKey, customer.id, merchant.ref])

  async function reload(keepPending = !!pending) {
    setLoading(true); setLoadError('')
    try {
      const result = await customerApi.catalog(merchant.ref)
      setCatalog({ ...result, products: result.products || [], collections: result.collections || [] })
      if (!keepPending) setLines(previous => previous.map(line => {
        const product = result.products.find(item => String(item.id) === String(line.product_id))
        const variant = product?.variants.find(item => String(item.id) === String(line.variant_id))
        if (!product || !variant || customerWeight(product, variant) !== line.weight) return { ...line, available: 0 }
        return { ...line, price: variant.price, available: customerStock(product, variant), image: customerImage(product), fulfillment_group: product.fulfillment_group, currency: product.currency || result.currency || 'MAD' }
      }))
    } catch (error) { setLoadError(customerError(error, lang)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [merchant.ref])

  const categories = useMemo(() => {
    if (catalog?.collections.length) return catalog.collections.map(item => ({ key: `collection:${item.id}`, title: item.title }))
    return [...new Set((catalog?.products || []).map(product => product.product_type?.trim()).filter(Boolean))].map(title => ({ key: `type:${title}`, title: title! }))
  }, [catalog])
  const products = useMemo(() => (catalog?.products || []).filter(product => {
    if (query.trim() && !product.title.toLowerCase().includes(query.trim().toLowerCase())) return false
    if (category.startsWith('collection:') && !(product.collection_ids || []).map(String).includes(category.slice(11))) return false
    if (category.startsWith('type:') && product.product_type !== category.slice(5)) return false
    return true
  }), [catalog, query, category])

  function add(product: CustomerProduct, variant: CustomerVariant, amount: number, replace = false) {
    if (!ready || locked || busyRef.current) return
    const key = lineKey({ product_id: product.id, variant_id: variant.id })
    const existing = lines.find(line => lineKey(line) === key)
    if (!existing && lines.length >= 100) {
      const text = t('Your basket is full. Place this order before adding more products.', 'سلتك ممتلئة. أكد هذا الطلب قبل إضافة منتجات أخرى.')
      setChoiceError(text); setMessage({ error: true, text }); return
    }
    const lineCurrency = product.currency || catalog?.currency || 'MAD'
    if (lines.length && (lines[0].fulfillment_group !== product.fulfillment_group || (lines[0].currency || 'MAD') !== lineCurrency)) {
      const text = t('These products need separate orders. Finish your current basket first.', 'هذه المنتجات تحتاج إلى طلبات منفصلة. أكمل سلتك الحالية أولاً.')
      setChoiceError(text); setMessage({ error: true, text }); return
    }
    const next = replace ? amount : (existing?.amount || 0) + amount
    const available = customerStock(product, variant)
    if (!Number.isSafeInteger(next) || next < 1 || next > available) {
      const text = t('Choose an amount within the available stock.', 'اختر كمية ضمن المخزون المتوفر.')
      setChoiceError(text); setMessage({ error: true, text }); return
    }
    const line: CartLine = { product_id: product.id, variant_id: variant.id, title: product.title, variant_title: variant.title,
      image: customerImage(product), price: variant.price, weight: customerWeight(product, variant), amount: next, available,
      fulfillment_group: product.fulfillment_group, currency: lineCurrency }
    setLines(previous => existing ? previous.map(item => lineKey(item) === key ? line : item) : [...previous, line])
    if (replace) setCartOpen(true)
    setChoice(null); setMessage(null); setReceipt(null)
  }
  function choose(product: CustomerProduct) {
    if (locked || !ready) return
    const variants = product.variants || []
    setChoiceError(''); setWeight(''); setWeightUnit('g')
    if (variants.length === 1 && !customerWeight(product, variants[0])) add(product, variants[0], 1)
    else setChoice({ product, variant: variants.length === 1 ? variants[0] : null })
  }
  function editWeight(line: CartLine) {
    const product = catalog?.products.find(item => String(item.id) === String(line.product_id))
    const variant = product?.variants.find(item => String(item.id) === String(line.variant_id))
    if (!product || !variant || locked) return
    setCartOpen(false)
    setChoiceError(''); setWeight(String(line.amount)); setWeightUnit('g'); setChoice({ product, variant, replace: true })
  }
  function change(line: CartLine, delta: number) {
    if (locked || busyRef.current) return
    const amount = line.amount + delta
    if (amount < 1) setLines(previous => previous.filter(item => lineKey(item) !== lineKey(line)))
    else if (amount <= line.available) setLines(previous => previous.map(item => lineKey(item) === lineKey(line) ? { ...item, amount } : item))
  }
  const invalidCart = lines.some(line => line.amount > line.available || line.available < 1 ||
    line.fulfillment_group !== lines[0]?.fulfillment_group || (line.currency || 'MAD') !== (lines[0]?.currency || 'MAD'))

  async function submitOrderLocked(resume = false) {
    if (!ready) return
    if (!resume && (!lines.length || invalidCart || loading || !catalog)) return
    if (!resume && requiresDelivery && (!name.trim() || !address1.trim() || !city.trim() || !(catalog?.delivery_cities || []).some(item => item.name === city))) {
      setMessage({ error: true, text: t('Add your name, delivery address and city.', 'أدخل اسمك وعنوان التوصيل والمدينة.') }); return
    }
    let body: CustomerOrderRequest | null = null
    let existing: SavedCart | null = null
    try { existing = JSON.parse(localStorage.getItem(storageKey) || 'null') as SavedCart | null } catch {}
    if (existing && (existing.customer_id !== customer.id || existing.merchant_ref !== merchant.ref)) return
    if (resume) {
      if (!existing?.pending?.request_id) {
        if (existing) restore(existing)
        setMessage({ error: true, text: t('This basket changed in another tab. Check your orders before placing another.', 'تغيرت هذه السلة في نافذة أخرى. راجع طلباتك قبل إنشاء طلب آخر.') }); return
      }
      body = existing.pending
      restore(existing)
    } else {
      if (existing?.pending?.request_id) { restore(existing); return }
      const quantities = (items: CartLine[]) => JSON.stringify(items.map(line => [lineKey(line), line.amount]).sort())
      if (existing && quantities(existing.lines || []) !== quantities(lines)) {
        restore(existing)
        setMessage({ error: true, text: t('Your basket changed in another tab. Review it before ordering.', 'تغيرت سلتك في نافذة أخرى. راجعها قبل تأكيد الطلب.') }); return
      }
      body = {
        request_id: crypto.randomUUID(), merchant_ref: merchant.ref, expected_total: (total / 100).toFixed(2),
        line_items: lines.map(line => ({ product_id: line.product_id, variant_id: line.variant_id, ...(line.weight ? { grams: line.amount } : { quantity: line.amount }) })),
        ...(name.trim() ? { customer_name: name.trim() } : {}),
        ...(address1.trim() || city.trim() ? { address: { address1: address1.trim(), city: city.trim(), country: 'MA' } } : {}),
      }
    }
    if (!body) return
    try { write({ ...(resume && existing ? existing : {}), pending: body, ...(existing ? { lines: existing.lines } : {}) }) }
    catch { setMessage({ error: true, text: t('Enable browser storage before placing an order, so a retry cannot create a duplicate.', 'فعّل تخزين المتصفح قبل إرسال الطلب لتجنب تكراره عند إعادة المحاولة.') }); return }
    setPending(body); setMessage(null)
    try {
      const order = await customerApi.order(body)
      write({ lines: [], pending: null })
      setLines([]); setPending(null)
      setReceipt({ name: order.name || String(order.id), total: order.total_price ?? order.total ?? '0' })
      setMessage(null); onOrderPlaced()
      void reload()
    } catch (error) {
      const uncertain = !(error instanceof CustomerApiError) || error.uncertain
      if (!uncertain) {
        try { write({ pending: null }); setPending(null) } catch { /* Keep the original request if storage fails. */ }
        void reload(false)
      }
      setMessage({ error: true, text: uncertain ? t('Your order could not be confirmed yet. Keep this basket and retry the same order; it will use the same request number.', 'لم يتم تأكيد الطلب بعد. احتفظ بهذه السلة وأعد محاولة نفس الطلب باستخدام نفس الرقم.') : customerError(error, lang) })
    }
  }
  async function submitOrder(resume = false) {
    if (busyRef.current || !ready) return
    busyRef.current = true
    setSaving(true)
    try { await withCustomerCartLock(storageKey, () => submitOrderLocked(resume)) }
    catch (error) { setMessage({ error: true, text: customerError(error, lang) }) }
    finally { busyRef.current = false; setSaving(false) }
  }

  const choiceAvailable = choice?.variant ? customerStock(choice.product, choice.variant) : 0
  const choiceIsWeight = choice?.variant ? customerWeight(choice.product, choice.variant) : false
  const choiceAlready = choice?.variant ? lines.find(line => lineKey(line) === lineKey({ product_id: choice.product.id, variant_id: choice.variant!.id }))?.amount || 0 : 0
  const choiceRemaining = Math.max(0, choiceAvailable - (choice?.replace ? 0 : choiceAlready))

  return <div className="pb-32">
    <div className="mb-5 flex items-center justify-between gap-3">
      <button type="button" onClick={onBack} className="flex min-h-11 items-center gap-2 text-sm font-bold text-slate-600"><ArrowLeft size={18} className={ar ? 'rotate-180' : ''} />{t('All shops', 'المتاجر')}</button>
      <div className="flex gap-2"><button type="button" onClick={() => onChat(merchant)} className="flex min-h-11 items-center gap-2 rounded-xl border border-emerald-200 bg-white px-3 text-sm font-bold text-emerald-800"><MessageCircle size={17} />{t('Chat', 'دردشة')}</button><button type="button" onClick={() => void reload()} disabled={loading} aria-label={t('Refresh products', 'تحديث المنتجات')} className="rounded-xl border border-slate-200 bg-white p-3 text-slate-500"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /></button></div>
    </div>
    <section className="mb-5 flex items-center gap-4 rounded-3xl border border-emerald-100 bg-white p-5 sm:p-6">
      <CustomerPhoto src={merchant.avatar} title={merchant.name} className="h-16 w-16 shrink-0 rounded-2xl" />
      <div><p className="text-xs font-bold uppercase tracking-widest text-emerald-700">{t('Your local shop', 'متجرك القريب')}</p><h1 className="mt-1 text-2xl font-black tracking-tight">{merchant.name}</h1><p className="mt-1 text-sm text-slate-500">{t('Choose your products. Order directly from your merchant.', 'اختر منتجاتك واطلب مباشرة من التاجر.')}</p></div>
    </section>
    <label className="relative mb-4 block"><Search size={19} className="pointer-events-none absolute start-4 top-4 text-slate-400" /><input value={query} onChange={event => setQuery(event.target.value)} aria-label={t('Search products', 'البحث عن منتج')} placeholder={t('What are you looking for?', 'ما الذي تبحث عنه؟')} className={`${customerField} ps-11`} /></label>
    {message && !cartOpen && <p role="status" className={`mb-4 rounded-2xl p-4 text-sm ${message.error ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>{message.text}</p>}
    {!!categories.length && <div className="mb-5 flex gap-2 overflow-x-auto pb-2"><button type="button" onClick={() => setCategory('')} className={`whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-bold ${!category ? 'bg-emerald-700 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>{t('All', 'الكل')}</button>{categories.map(item => <button key={item.key} type="button" onClick={() => setCategory(item.key)} className={`whitespace-nowrap rounded-full px-5 py-2.5 text-sm font-bold ${category === item.key ? 'bg-emerald-700 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>{item.title}</button>)}</div>}
    {loadError && <div role="alert" className="mb-5 rounded-2xl border border-rose-100 bg-rose-50 p-4 text-sm text-rose-800">{loadError}<button onClick={() => void reload()} className="ms-3 font-bold underline">{t('Retry', 'حاول مجدداً')}</button></div>}
    {loading && !catalog ? <div className="flex justify-center p-16"><Loader2 className="animate-spin text-emerald-600" size={30} /></div>
      : !products.length ? <div className="rounded-3xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center"><ShoppingBasket size={40} className="mx-auto mb-4 text-emerald-300" /><h2 className="font-bold">{t(query || category ? 'No matching products' : 'Products will appear here', query || category ? 'لا توجد منتجات مطابقة' : 'ستظهر المنتجات هنا')}</h2><p className="mt-2 text-sm text-slate-500">{t(query || category ? 'Try another search or category.' : 'You can ask your merchant in chat.', query || category ? 'جرب بحثاً أو قسماً آخر.' : 'يمكنك سؤال التاجر عبر الدردشة.')}</p></div>
      : <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">{products.map(product => {
        const variants = product.variants || [], prices = variants.map(variant => customerPriceCents(variant.price)), low = prices.length ? Math.min(...prices) : 0
        const soldOut = !variants.some(variant => customerStock(product, variant) > 0)
        const isWeight = product.unit_type === 'weight'
        const inCart = lines.filter(line => String(line.product_id) === String(product.id)).reduce((sum, line) => sum + (line.weight ? 1 : line.amount), 0)
        return <article key={String(product.id)} className="overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm">
          <div className="relative"><CustomerPhoto src={customerImage(product)} title={product.title} className="aspect-square w-full" />{soldOut && <span className="absolute start-3 top-3 rounded-full bg-white/95 px-3 py-1 text-[11px] font-bold text-slate-600">{t('Sold out', 'غير متوفر')}</span>}{inCart > 0 && <span className="absolute end-3 top-3 flex h-7 min-w-7 items-center justify-center rounded-full bg-emerald-700 px-2 text-xs font-bold text-white">{inCart}</span>}</div>
          <div className="p-3.5 sm:p-4"><p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{product.product_type || (isWeight ? t('By weight', 'بالوزن') : t('In your shop', 'في متجرك'))}</p><h2 className="min-h-10 text-sm font-bold leading-5 sm:text-base">{product.title}</h2><div className="mt-3 flex items-end justify-between gap-2"><div><span className="text-sm font-black text-slate-900 sm:text-base">{customerMoney(low, lang, product.currency || catalog?.currency || 'MAD')}</span><span className="block text-[11px] text-slate-500">{isWeight ? t('per kg', 'للكيلوغرام') : prices.some(price => price !== low) ? t('from', 'ابتداءً من') : t('per item', 'للوحدة')}</span></div><button type="button" onClick={() => choose(product)} disabled={!ready || locked || soldOut} aria-label={t('Add ', 'إضافة ') + product.title} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-700 text-white transition hover:bg-emerald-800 disabled:bg-slate-100 disabled:text-slate-300"><Plus size={23} /></button></div></div>
        </article>
      })}</div>}
    {!!lines.length && <div className="fixed inset-x-4 bottom-24 z-20 mx-auto max-w-lg sm:bottom-24"><button type="button" onClick={() => setCartOpen(true)} className="flex w-full items-center justify-between gap-4 rounded-2xl bg-emerald-800 px-5 py-4 text-white shadow-xl shadow-emerald-900/20"><span className="flex items-center gap-3"><span className="rounded-lg bg-white/15 px-2.5 py-1.5 text-sm font-black">{cartCount}</span><span className="text-sm font-bold">{pending ? t('Confirm your order', 'تأكيد طلبك') : t('View basket', 'عرض السلة')}</span></span><span className="flex items-center gap-2 text-sm font-black">{money(total)}<ChevronRight size={18} className={ar ? 'rotate-180' : ''} /></span></button></div>}

    {choice && <CustomerDialog title={choice.product.title} closeLabel={t('Close', 'إغلاق')} onClose={() => { if (choice.replace) setCartOpen(true); setChoice(null) }}>
      <CustomerPhoto src={customerImage(choice.product)} title={choice.product.title} className="mb-5 aspect-[4/3] w-full rounded-2xl" />
      {!choice.variant ? <div className="space-y-2"><p className="mb-3 text-sm font-bold text-slate-600">{t('Choose an option', 'اختر النوع')}</p>{choice.product.variants.map(variant => <button key={String(variant.id)} type="button" disabled={customerStock(choice.product, variant) < 1} onClick={() => { if (customerWeight(choice.product, variant)) setChoice({ ...choice, variant }); else add(choice.product, variant, 1) }} className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 p-4 text-start disabled:opacity-35"><span className="text-sm font-bold">{variant.title || t('Standard', 'عادي')}</span><span className="text-sm font-bold text-emerald-800">{customerMoney(customerPriceCents(variant.price), lang, choice.product.currency || catalog?.currency || 'MAD')}{customerWeight(choice.product, variant) ? ' / kg' : ''}</span></button>)}</div>
        : choiceIsWeight ? <form onSubmit={event => { event.preventDefault(); const grams = gramsFromInput(weight, weightUnit); if (!grams || grams > choiceRemaining) setChoiceError(t('Enter a weight within the available stock.', 'أدخل وزناً ضمن المخزون المتوفر.')); else add(choice.product, choice.variant!, grams, choice.replace) }}>
          <div className="mb-4 flex items-center justify-between gap-3"><span className="flex items-center gap-2 font-bold text-emerald-800"><Scale size={19} />{customerMoney(customerPriceCents(choice.variant.price), lang, choice.product.currency || catalog?.currency || 'MAD')} / kg</span><span className="text-xs text-slate-500">{t('Available', 'المتوفر')}: {(choiceRemaining / 1000).toLocaleString(ar ? 'ar-MA' : 'en-GB')} kg</span></div>
          <div className="flex gap-2"><input autoFocus type="text" inputMode="decimal" value={weight} onChange={event => { setWeight(event.target.value); setChoiceError('') }} aria-label={t('Weight', 'الوزن')} placeholder={weightUnit === 'g' ? '250' : '0.250'} className={customerField} dir="ltr" /><select value={weightUnit} onChange={event => { setWeight(''); setWeightUnit(event.target.value as 'g' | 'kg') }} aria-label={t('Weight unit', 'وحدة الوزن')} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 font-bold"><option value="g">g</option><option value="kg">kg</option></select></div>
          <div className="my-3 flex gap-2">{[250, 500, 1000].map(grams => <button key={grams} type="button" disabled={grams > choiceRemaining} onClick={() => { setWeightUnit('g'); setWeight(String(grams)); setChoiceError('') }} className="flex-1 rounded-xl border border-emerald-100 bg-emerald-50 py-2.5 text-xs font-bold text-emerald-800 disabled:opacity-30">{grams === 1000 ? '1 kg' : `${grams} g`}</button>)}</div>
          {choiceError && <p role="alert" className="mb-3 text-sm text-rose-700">{choiceError}</p>}
          <button className={`${customerButton} mt-2 w-full`}><ShoppingBag size={18} />{choice.replace ? t('Update weight', 'تعديل الوزن') : t('Add to basket', 'أضف إلى السلة')}{gramsFromInput(weight, weightUnit) ? ` · ${customerMoney(customerLineCents(choice.variant.price, gramsFromInput(weight, weightUnit)!, true), lang, choice.product.currency || catalog?.currency || 'MAD')}` : ''}</button>
        </form> : null}
      {!choiceIsWeight && choiceError && <p role="alert" className="mt-3 text-sm text-rose-700">{choiceError}</p>}
    </CustomerDialog>}

    {cartOpen && <CustomerDialog title={t('Your basket', 'سلتك')} closeLabel={t('Close', 'إغلاق')} locked={saving} onClose={() => setCartOpen(false)}>
      {receipt ? <div className="py-5 text-center"><CheckCircle2 size={52} className="mx-auto text-emerald-600" /><h3 className="mt-4 text-xl font-black">{t('Order received', 'تم استلام طلبك')}</h3><p className="mt-2 text-sm text-slate-500">{merchant.name} · {receipt.name}</p><p className="mt-3 font-black">{money(customerPriceCents(receipt.total))}</p><p className="mt-3 text-sm text-slate-500">{t('Payment will be arranged with your merchant.', 'سيتم ترتيب الدفع مع التاجر.')}</p><button type="button" onClick={onOrders} className={`${customerButton} mt-5 w-full`}>{t('View my orders', 'عرض طلباتي')}</button></div>
        : !lines.length ? <div className="py-10 text-center text-slate-500"><ShoppingBasket size={40} className="mx-auto mb-4 text-emerald-300" />{t('Your basket is empty.', 'سلتك فارغة.')}</div>
          : <><p className="mb-4 text-sm text-slate-500">{merchant.name} · {t('One basket, one merchant', 'سلة واحدة لتاجر واحد')}</p>
            <div className="space-y-4">{lines.map(line => <div key={lineKey(line)} className="flex gap-3 border-b border-slate-100 pb-4"><CustomerPhoto src={line.image} title={line.title} className="h-16 w-16 shrink-0 rounded-2xl" /><div className="min-w-0 flex-1"><h3 className="text-sm font-bold">{line.title}</h3>{line.variant_title && !/default title/i.test(line.variant_title) && <p className="mt-0.5 text-xs text-slate-500">{line.variant_title}</p>}<p className="mt-1 text-xs text-slate-500">{money(customerPriceCents(line.price))}{line.weight ? ' / kg' : ''}</p><div className="mt-2 flex items-center justify-between gap-2">{line.weight ? <button type="button" disabled={locked} onClick={() => editWeight(line)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold disabled:opacity-40">{(line.amount / 1000).toLocaleString(ar ? 'ar-MA' : 'en-GB')} kg · {t('Edit', 'تعديل')}</button> : <div className="flex items-center rounded-xl border border-slate-200"><button type="button" disabled={locked} aria-label={t('Decrease quantity', 'تقليل الكمية')} onClick={() => change(line, -1)} className="p-2.5 disabled:opacity-30"><Minus size={14} /></button><span className="min-w-7 text-center text-sm font-bold">{line.amount}</span><button type="button" disabled={locked || line.amount >= line.available} aria-label={t('Increase quantity', 'زيادة الكمية')} onClick={() => change(line, 1)} className="p-2.5 disabled:opacity-30"><Plus size={14} /></button></div>}<strong className="text-sm">{money(customerLineCents(line.price, line.amount, line.weight))}</strong></div>{line.amount > line.available && <p className="mt-2 text-xs font-bold text-rose-700">{t('Stock changed. Reduce or remove this item.', 'تغير المخزون. قلل الكمية أو احذف المنتج.')}</p>}</div><button type="button" disabled={locked} aria-label={t('Remove ', 'حذف ') + line.title} onClick={() => setLines(previous => previous.filter(item => lineKey(item) !== lineKey(line)))} className="self-start rounded-lg p-2 text-slate-400 hover:text-rose-600 disabled:opacity-30"><Trash2 size={16} /></button></div>)}</div>
            <div className="mt-5 space-y-3"><label className="block text-xs font-bold text-slate-500">{t('Your phone', 'رقم هاتفك')}<div dir="ltr" className="mt-1 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">{customer.phone}</div></label><label className="block text-xs font-bold text-slate-500">{t(requiresDelivery ? 'Your name' : 'Your name (optional)', requiresDelivery ? 'اسمك' : 'اسمك (اختياري)')}<input value={name} onChange={event => setName(event.target.value)} disabled={locked} maxLength={160} autoComplete="name" className={`${customerField} mt-1`} /></label>{requiresDelivery && <div className="space-y-3"><label className="block text-xs font-bold text-slate-500">{t('Delivery address', 'عنوان التوصيل')}<input value={address1} onChange={event => setAddress1(event.target.value)} disabled={locked} maxLength={500} autoComplete="street-address" className={`${customerField} mt-1`} /></label><label className="block text-xs font-bold text-slate-500">{t('City', 'المدينة')}<select value={city} onChange={event => setCity(event.target.value)} disabled={locked} autoComplete="address-level2" className={`${customerField} mt-1`}><option value="">{t("Choose your city", "اختر مدينتك")}</option>{(catalog?.delivery_cities || []).map(item => <option key={item.id || item.name} value={item.name}>{item.name}</option>)}</select></label></div>}</div>
            {requiresDelivery && <div className="mt-5 space-y-2 border-t border-slate-100 pt-4 text-sm"><div className="flex justify-between text-slate-500"><span>{t("Products", "المنتجات")}</span><span>{money(subtotal)}</span></div><div className="flex justify-between text-slate-500"><span>{t("Delivery", "التوصيل")}</span><span>{money(deliveryFee)}</span></div>{!catalog?.delivery_cities?.length && <p className="text-xs text-rose-700">{t("Delivery is currently unavailable. Contact your merchant.", "التوصيل غير متاح حالياً. تواصل مع التاجر.")}</p>}</div>}<div className="my-5 flex items-center justify-between border-t border-slate-200 pt-5 text-lg font-black"><span>{t('Total', 'المجموع')}</span><span>{money(total)}</span></div>
            {message && <p role="alert" className={`mb-4 rounded-2xl p-4 text-sm ${message.error ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'}`}>{message.text}</p>}
            {pending && <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-bold">{t('This order is awaiting confirmation.', 'هذا الطلب في انتظار التأكيد.')}</p><p className="mt-1 text-xs leading-relaxed">{t('Retrying keeps the same request number. Your basket stays locked to prevent a duplicate order.', 'إعادة المحاولة تستعمل نفس رقم الطلب. تبقى السلة مقفلة لمنع تكراره.')}</p><button type="button" onClick={onOrders} className="mt-3 text-xs font-bold underline">{t('Check my order history', 'التحقق من سجل طلباتي')}</button></div>}
            <button type="button" disabled={saving || (!pending && (invalidCart || loading || !catalog))} onClick={() => void submitOrder(!!pending)} className={`${customerButton} w-full`}>{saving ? <Loader2 size={19} className="animate-spin" /> : pending ? <RefreshCw size={18} /> : <Check size={18} />}{saving ? t('Sending your order…', 'جاري إرسال طلبك…') : pending ? t('Retry the same order', 'إعادة محاولة نفس الطلب') : t('Place order', 'تأكيد الطلب')}</button><p className="mt-3 text-center text-xs leading-relaxed text-slate-500">{t('Pay as agreed with your merchant. Stock and final prices are confirmed when your order is received.', 'الدفع حسب الاتفاق مع التاجر. يتم تأكيد المخزون والأسعار النهائية عند استلام الطلب.')}</p>
          </>}
    </CustomerDialog>}
  </div>
}
