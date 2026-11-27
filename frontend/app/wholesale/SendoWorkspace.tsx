'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, InputHTMLAttributes } from 'react'
import { ArrowLeft, ClipboardList, Loader2, LogOut, Package, Plus, Users } from 'lucide-react'

const API = (process.env.NEXT_PUBLIC_API_BASE_URL || '') + '/api/wholesale/sendo'
const SESSION_KEY = 'wholesale_sendo_session'
const ORDER_RETRY_KEY = 'wholesale_sendo_order_retry'
const button = 'inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50'
const secondary = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40'
const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200'
const card = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5'

type Lang = 'en' | 'ar'
type Identity = { merchant_name: string; vendor_name: string }
type Session = Identity & { token: string }
type Variant = { id: number; title: string; sku: string; price: string; stock: number }
type Product = {
  id: number
  name: string
  sku: string
  description: string
  price: string
  stock: number
  status: 'active' | 'draft' | 'archived'
  variants: Variant[]
}
type Customer = { id: string; name: string; phone: string; address: string; city: string }
type Order = {
  id: string
  order_name: string
  customer_name: string
  total: string
  status: string
  payment_status?: string
  fulfillment_status?: string
  created_at: string
  items?: {
    product_id: number
    variant_id?: number | null
    variant_title?: string | null
    name: string
    sku: string
    quantity: number
    unit_price: string
  }[]
}
type Page<T> = { items: T[]; has_more: boolean }
type Tab = 'products' | 'customers' | 'orders'
type Options = { method?: 'POST' | 'PUT'; body?: object; signal?: AbortSignal; search?: string }
type Send = <T>(path: string, options?: Options) => Promise<T>

const text = {
  en: {
    title: 'Sendo wholesale', back: 'Wholesale sign-in', code: 'Vendor access code',
    codeHelp: 'Enter the access code issued by your Sendo admin.',
    signIn: 'Sign in', signOut: 'Sign out', retry: 'Try again', loading: 'Loading…',
    accessError: 'This code is invalid or your access is disabled. Check with your Sendo admin.',
    sessionEnded: 'Your Sendo session has ended. Sign in again to continue.',
    unavailable: 'Could not reach Sendo. Please try again.',
    validation: 'Check the information you entered and try again.',
    products: 'Products', customers: 'Customers', orders: 'Orders',
    addProduct: 'Add product', addCustomer: 'Add customer', newOrder: 'New order',
    searchProduct: 'Search by product name or SKU', searchCustomer: 'Search by name or phone',
    name: 'Name', sku: 'SKU', description: 'Description', price: 'Unit price (MAD)',
    stock: 'Stock', phone: 'Phone', address: 'Delivery address', city: 'City', note: 'Order note',
    quantity: 'Quantity', available: 'Available', edit: 'Edit', cancel: 'Cancel', save: 'Save',
    payment: 'Payment', fulfillment: 'Fulfillment',
    variants: 'Variants', draft: 'Draft', archived: 'Archived', totalStock: 'Total stock',
    variantManagement: 'Manage variant prices and stock in the Sendo store.',
    saving: 'Saving…', saved: 'Saved.', previous: 'Previous', next: 'Next',
    page: 'Page', noRecords: 'No results found.', select: 'Select', add: 'Add', remove: 'Remove',
    chooseCustomer: 'Choose a customer', chooseProducts: 'Choose products',
    changeCustomer: 'Change customer', orderItems: 'Order items', estimated: 'Estimated total',
    placeOrder: 'Create order', placing: 'Creating order…', created: 'Created order',
    invalidQuantity: 'Enter a whole number of units within the available stock.',
  },
  ar: {
    title: 'الجملة عبر Sendo', back: 'تسجيل الدخول للجملة', code: 'رمز دخول المورّد',
    codeHelp: 'أدخل رمز الدخول الذي أعطاك إياه مسؤول Sendo.',
    signIn: 'تسجيل الدخول', signOut: 'تسجيل الخروج', retry: 'إعادة المحاولة', loading: 'جارٍ التحميل…',
    accessError: 'رمز الدخول غير صالح أو تم إيقاف وصولك. تواصل مع مسؤول Sendo.',
    sessionEnded: 'انتهت جلستك في Sendo. سجّل الدخول مجددًا للمتابعة.',
    unavailable: 'تعذّر الاتصال بـ Sendo. أعد المحاولة.',
    validation: 'تحقّق من المعلومات المدخلة ثم أعد المحاولة.',
    products: 'المنتجات', customers: 'العملاء', orders: 'الطلبات',
    addProduct: 'إضافة منتج', addCustomer: 'إضافة عميل', newOrder: 'طلب جديد',
    searchProduct: 'ابحث باسم المنتج أو رمزه', searchCustomer: 'ابحث بالاسم أو رقم الهاتف',
    name: 'الاسم', sku: 'رمز المنتج', description: 'الوصف', price: 'سعر الوحدة (درهم)',
    stock: 'المخزون', phone: 'الهاتف', address: 'عنوان التوصيل', city: 'المدينة', note: 'ملاحظة الطلب',
    quantity: 'الكمية', available: 'المتوفر', edit: 'تعديل', cancel: 'إلغاء', save: 'حفظ',
    payment: 'الدفع', fulfillment: 'التنفيذ',
    variants: 'الخيارات', draft: 'مسودة', archived: 'مؤرشف', totalStock: 'إجمالي المخزون',
    variantManagement: 'عدّل أسعار الخيارات ومخزونها في متجر Sendo.',
    saving: 'جارٍ الحفظ…', saved: 'تم الحفظ.', previous: 'السابق', next: 'التالي',
    page: 'الصفحة', noRecords: 'لا توجد نتائج.', select: 'اختيار', add: 'إضافة', remove: 'حذف',
    chooseCustomer: 'اختر عميلاً', chooseProducts: 'اختر المنتجات',
    changeCustomer: 'تغيير العميل', orderItems: 'منتجات الطلب', estimated: 'المجموع التقريبي',
    placeOrder: 'إنشاء الطلب', placing: 'جارٍ إنشاء الطلب…', created: 'تم إنشاء الطلب',
    invalidQuantity: 'أدخل كمية صحيحة ضمن المخزون المتوفر.',
  },
}
type Copy = (typeof text)['en']

class SendoError extends Error {
  constructor(readonly status: number, readonly detail?: string) {
    super(detail || 'Sendo request failed')
  }
}

function errorMessage(error: unknown, copy: Copy) {
  if (error instanceof SendoError && error.status === 422) return copy.validation
  if (error instanceof SendoError && error.status < 500 && error.detail) return error.detail
  return copy.unavailable
}

function stored(key: string) {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function store(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, value)
  } catch {
    // The browser may disable tab storage. The current session still works.
  }
}

async function callSendo<T>(path: string, options: Options = {}, token?: string): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' })
  if (token) headers.set('Authorization', 'Bearer ' + token)
  if (options.body) headers.set('Content-Type', 'application/json')
  if (options.search) headers.set('X-Wholesale-Search', encodeURIComponent(options.search))

  const response = await fetch(API + path, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : undefined
    throw new SendoError(response.status, detail)
  }
  if (!data) throw new SendoError(502)
  return data as T
}

function accessEnded(error: unknown) {
  return error instanceof SendoError && (error.status === 401 || error.status === 403)
}

export default function SendoWorkspace({ lang, onLangChange }: {
  lang: Lang
  onLangChange: (value: Lang) => void
}) {
  const copy = text[lang]
  const [session, setSession] = useState<Session | null>(null)
  const [checking, setChecking] = useState(true)
  const [restoreFailed, setRestoreFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const signOut = useCallback((reason: unknown = null) => {
    store(SESSION_KEY, null)
    setSession(null)
    setError(reason)
  }, [])

  useEffect(() => {
    const token = stored(SESSION_KEY)
    if (!token) {
      setChecking(false)
      return
    }
    const controller = new AbortController()
    setChecking(true)
    setRestoreFailed(false)
    callSendo<Identity>('/session', { signal: controller.signal }, token)
      .then(identity => setSession({ ...identity, token }))
      .catch(error => {
        if (controller.signal.aborted) return
        if (accessEnded(error)) signOut(error)
        else setRestoreFailed(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false)
      })
    return () => controller.abort()
  }, [retry, signOut])

  const send: Send = useCallback(async (path, options) => {
    try {
      return await callSendo(path, options, session?.token)
    } catch (error) {
      if (accessEnded(error)) signOut(error)
      throw error
    }
  }, [session?.token, signOut])

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const accessCode = String(new FormData(event.currentTarget).get('access_code') || '').trim()
    if (!accessCode) return
    setBusy(true)
    setError(null)
    try {
      const current = await callSendo<Session>('/session', { method: 'POST', body: { access_code: accessCode } })
      if (!current.token) throw new SendoError(502)
      store(SESSION_KEY, current.token)
      setSession(current)
    } catch (error) {
      setError(accessEnded(error) ? 'access' : error)
    } finally {
      setBusy(false)
    }
  }

  const languageButton = (
    <button type="button" className={secondary} onClick={() => onLangChange(lang === 'ar' ? 'en' : 'ar')}>
      {lang === 'ar' ? 'English' : 'العربية'}
    </button>
  )

  if (session) {
    return (
      <div dir={lang === 'ar' ? 'rtl' : 'ltr'} className="min-h-screen bg-slate-50">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6">
            <div>
              <h1 className="text-xl font-bold text-slate-900">{session.merchant_name}</h1>
              <p className="text-sm text-slate-600">{session.vendor_name}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {languageButton}
              <button type="button" className={secondary} onClick={() => signOut()}>
                <LogOut size={16} aria-hidden="true" />{copy.signOut}
              </button>
            </div>
          </div>
        </header>
        <Store send={send} lang={lang} copy={copy} />
      </div>
    )
  }

  return (
    <main dir={lang === 'ar' ? 'rtl' : 'ltr'} className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-950 p-4">
      <div className="w-full max-w-md space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <a href="/wholesale/" className="inline-flex items-center gap-2 text-sm font-semibold text-white hover:underline">
            <ArrowLeft size={16} className="rtl:rotate-180" aria-hidden="true" />{copy.back}
          </a>
          {languageButton}
        </div>
        <section className="rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
          <h1 className="mb-5 text-2xl font-bold text-slate-900">{copy.title}</h1>
          {checking ? (
            <p className="flex items-center gap-2 text-sm text-slate-600" role="status">
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />{copy.loading}
            </p>
          ) : restoreFailed ? (
            <div className="space-y-4">
              <p role="alert" className="text-sm text-red-700">{copy.unavailable}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={button} onClick={() => setRetry(value => value + 1)}>{copy.retry}</button>
                <button type="button" className={secondary} onClick={() => { signOut(); setRestoreFailed(false) }}>{copy.signOut}</button>
              </div>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={signIn}>
              <p className="text-sm text-slate-600" id="sendo-code-help">{copy.codeHelp}</p>
              <Field label={copy.code} name="access_code" type="password" autoComplete="current-password" required maxLength={256} dir="ltr" aria-describedby="sendo-code-help" />
              {!!error && (
                <p className="text-sm text-red-700" role="alert">
                  {error === 'access' ? copy.accessError : accessEnded(error) ? copy.sessionEnded : errorMessage(error, copy)}
                </p>
              )}
              <button disabled={busy} className={button + ' w-full'}>
                {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                {copy.signIn}
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  )
}

function Field({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block space-y-1">
      <span className="block text-sm font-semibold text-slate-700">{label}</span>
      <input className={input} {...props} />
    </label>
  )
}

function money(amount: string | number, lang: Lang) {
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-MA' : 'en-GB', { style: 'currency', currency: 'MAD' }).format(Number(amount))
}

function useRecords<T>(resource: Tab, send: Send, revision: number, pageSize: number) {
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [records, setRecords] = useState<Page<T> | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const query = new URLSearchParams({ limit: String(pageSize), offset: String(offset) })
    setRecords(null)
    setError(null)
    const timer = window.setTimeout(async () => {
      try {
        const page = await send<Page<T>>('/' + resource + '?' + query, { search: search.trim(), signal: controller.signal })
        if (!controller.signal.aborted) setRecords(page)
      } catch (error) {
        if (!controller.signal.aborted) setError(error)
      }
    }, search ? 220 : 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [resource, send, search, offset, revision, pageSize, retry])

  return {
    offset, pageSize, search, records, error,
    changeSearch(value: string) {
      setSearch(value)
      setOffset(0)
    },
    previous: () => setOffset(value => Math.max(0, value - pageSize)),
    next: () => setOffset(value => value + pageSize),
    retry: () => setRetry(value => value + 1),
  }
}

type Listing<T> = ReturnType<typeof useRecords<T>>

function Records<T extends { id: number | string }>({ listing, label, copy, render }: {
  listing: Listing<T>
  label?: string
  copy: Copy
  render: (record: T) => React.ReactNode
}) {
  const { records, error, offset, pageSize } = listing
  return (
    <div className="space-y-3">
      {label && (
        <input type="search" className={input + ' max-w-sm'} aria-label={label} placeholder={label}
          value={listing.search} maxLength={100} onChange={event => listing.changeSearch(event.target.value)} />
      )}
      {error ? (
        <div className={card + ' flex flex-wrap items-center gap-3'} role="alert">
          <p className="text-sm text-red-700">{errorMessage(error, copy)}</p>
          <button type="button" className={secondary} onClick={listing.retry}>{copy.retry}</button>
        </div>
      ) : !records ? (
        <p className="px-1 py-2 text-sm text-slate-600" role="status">{copy.loading}</p>
      ) : records.items.length > 0 ? (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {records.items.map(record => (
            <li key={record.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              {render(record)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-1 py-2 text-sm text-slate-600">{copy.noRecords}</p>
      )}
      {(offset > 0 || records?.has_more) && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={secondary} onClick={listing.previous} disabled={offset === 0}>{copy.previous}</button>
          <span className="text-sm text-slate-600">{copy.page} {offset / pageSize + 1}</span>
          <button type="button" className={secondary} onClick={listing.next} disabled={!records?.has_more}>{copy.next}</button>
        </div>
      )}
    </div>
  )
}

function Store({ send, lang, copy }: { send: Send; lang: Lang; copy: Copy }) {
  const [tab, setTab] = useState<Tab>('products')
  const tabs = [
    { id: 'products', label: copy.products, Icon: Package },
    { id: 'customers', label: copy.customers, Icon: Users },
    { id: 'orders', label: copy.orders, Icon: ClipboardList },
  ] as const

  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-5 sm:px-6">
      <nav aria-label={copy.title} className="flex flex-wrap gap-2">
        {tabs.map(({ id, label, Icon }) => (
          <button key={id} type="button" aria-current={tab === id ? 'page' : undefined}
            className={tab === id ? button : secondary} onClick={() => setTab(id)}>
            <Icon size={16} aria-hidden="true" />{label}
          </button>
        ))}
      </nav>
      {tab === 'orders' ? <Orders send={send} lang={lang} copy={copy} /> : (
        <Directory key={tab} kind={tab} send={send} lang={lang} copy={copy} />
      )}
    </main>
  )
}

function isProduct(record: Product | Customer): record is Product {
  return 'sku' in record
}

function ProductSummary({ product, copy, lang }: { product: Product; copy: Copy; lang: Lang }) {
  const variants = product.variants || []
  const stock = variants.length ? variants.reduce((total, variant) => total + variant.stock, 0) : product.stock
  return (
    <div className="min-w-0 break-words">
      <p className="text-sm font-bold text-slate-900">
        {product.name}
        {product.status === 'draft' && <span className="ms-2 font-normal text-slate-600">{copy.draft}</span>}
        {product.status === 'archived' && <span className="ms-2 font-normal text-slate-600">{copy.archived}</span>}
      </p>
      <p className="text-xs text-slate-600">
        <bdi>{product.sku}</bdi> · {variants.length ? copy.variants + ' ' + variants.length : money(product.price, lang)} · {stock} {copy.available}
      </p>
    </div>
  )
}

function CustomerSummary({ customer }: { customer: Customer }) {
  return (
    <div className="min-w-0 break-words">
      <p className="text-sm font-bold text-slate-900">{customer.name}</p>
      <p className="text-xs text-slate-600">
        <bdi>{customer.phone}</bdi>{customer.city && ' · ' + customer.city}
      </p>
    </div>
  )
}

function Directory({ kind, send, lang, copy }: { kind: 'products' | 'customers'; send: Send; lang: Lang; copy: Copy }) {
  const [editor, setEditor] = useState<'new' | Product | Customer | null>(null)
  const [revision, setRevision] = useState(0)
  const [saved, setSaved] = useState(false)
  const listing = useRecords<Product | Customer>(kind, send, revision, 20)
  const add = kind === 'products' ? copy.addProduct : copy.addCustomer

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">{copy[kind]}</h2>
        <button type="button" className={button} onClick={() => { setEditor('new'); setSaved(false) }}>
          <Plus size={16} aria-hidden="true" />{add}
        </button>
      </div>
      {saved && <p role="status" className="text-sm font-semibold text-green-700">{copy.saved}</p>}
      {editor && (
        <RecordForm key={editor === 'new' ? 'new' : editor.id} kind={kind} record={editor === 'new' ? undefined : editor}
          copy={copy} send={send} cancel={() => setEditor(null)} saved={() => {
            setEditor(null)
            setSaved(true)
            setRevision(value => value + 1)
          }} />
      )}
      <Records copy={copy} listing={listing} label={kind === 'products' ? copy.searchProduct : copy.searchCustomer}
        render={record => (
          <>
            {isProduct(record) ? <ProductSummary product={record} copy={copy} lang={lang} /> : <CustomerSummary customer={record} />}
            <button type="button" className={secondary} aria-label={copy.edit + ' ' + record.name}
              onClick={() => { setEditor(record); setSaved(false) }}>{copy.edit}</button>
          </>
        )} />
    </section>
  )
}

function RecordForm({ kind, record, copy, send, cancel, saved }: {
  kind: 'products' | 'customers'
  record?: Product | Customer
  copy: Copy
  send: Send
  cancel: () => void
  saved: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const product = record && isProduct(record) ? record : undefined
  const customer = record && !isProduct(record) ? record : undefined
  const variants = product?.variants || []

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const get = (field: string) => String(fields.get(field) || '').trim()
    const body = kind === 'products'
      ? {
          name: get('name'),
          sku: get('sku'),
          description: get('description'),
          price: variants.length ? product?.price : get('price'),
          stock: variants.length ? product?.stock : Number(get('stock')),
        }
      : { name: get('name'), phone: get('phone'), address: get('address'), city: get('city') }
    setBusy(true)
    setError(null)
    try {
      const path = '/' + kind + (record ? '/' + encodeURIComponent(record.id) : '')
      await send(path, { method: record ? 'PUT' : 'POST', body })
      saved()
    } catch (error) {
      setError(error)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={card + ' space-y-4'} onSubmit={save}>
      <h3 className="font-bold text-slate-900">
        {record ? copy.edit + ' ' + record.name : kind === 'products' ? copy.addProduct : copy.addCustomer}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={copy.name} name="name" required maxLength={255} defaultValue={record?.name} />
        {kind === 'products' ? (
          <>
            <Field label={copy.sku} name="sku" required maxLength={80} defaultValue={product?.sku} />
            {variants.length > 0 ? (
              <div className="text-sm text-slate-700 sm:col-span-2">
                <p className="font-semibold">{copy.totalStock} {variants.reduce((total, variant) => total + variant.stock, 0)}</p>
                <p>{copy.variantManagement}</p>
              </div>
            ) : (
              <>
                <Field label={copy.price} name="price" type="number" min="0" step="0.01" required defaultValue={product?.price} />
                <Field label={copy.stock} name="stock" type="number" min="0" step="1" required defaultValue={product?.stock ?? 0} />
              </>
            )}
            <label className="block space-y-1 sm:col-span-2">
              <span className="block text-sm font-semibold text-slate-700">{copy.description}</span>
              <textarea className={input} name="description" rows={2} maxLength={2000} defaultValue={product?.description} />
            </label>
          </>
        ) : (
          <>
            <Field label={copy.phone} name="phone" type="tel" required maxLength={32} defaultValue={customer?.phone} />
            <Field label={copy.address} name="address" maxLength={255} defaultValue={customer?.address} />
            <Field label={copy.city} name="city" maxLength={100} defaultValue={customer?.city} />
          </>
        )}
      </div>
      {!!error && <p role="alert" className="text-sm text-red-700">{errorMessage(error, copy)}</p>}
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy}>{busy ? copy.saving : copy.save}</button>
        <button type="button" className={secondary} onClick={cancel} disabled={busy}>{copy.cancel}</button>
      </div>
    </form>
  )
}

function Orders({ send, lang, copy }: { send: Send; lang: Lang; copy: Copy }) {
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState('')
  const [revision, setRevision] = useState(0)
  const listing = useRecords<Order>('orders', send, revision, 20)

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">{copy.orders}</h2>
        {!creating && (
          <button type="button" className={button} onClick={() => { setCreating(true); setCreated('') }}>
            <Plus size={16} aria-hidden="true" />{copy.newOrder}
          </button>
        )}
      </div>
      {created && <p role="status" className="text-sm font-semibold text-green-700">{copy.created} <bdi>{created}</bdi></p>}
      {creating && (
        <OrderForm send={send} lang={lang} copy={copy} close={() => setCreating(false)} saved={order => {
          setCreated(order.order_name)
          setCreating(false)
          setRevision(value => value + 1)
        }} />
      )}
      <Records copy={copy} listing={listing} render={order => (
        <>
          <div className="min-w-0 break-words">
            <p className="text-sm font-bold text-slate-900"><bdi>{order.order_name}</bdi> · {order.customer_name}</p>
            <p className="text-xs text-slate-600">
              {order.created_at && new Date(order.created_at).toLocaleDateString(lang === 'ar' ? 'ar-MA' : 'en-GB')} · {money(order.total, lang)}
            </p>
            {order.items && order.items.length > 0 && (
              <p className="mt-1 text-xs text-slate-600">
                {order.items.map(item => item.quantity + ' × ' + item.name + (item.variant_title ? ' – ' + item.variant_title : '')).join(' · ')}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Status value={order.status} />
            {order.payment_status && <Status label={copy.payment} value={order.payment_status} />}
            {order.fulfillment_status && <Status label={copy.fulfillment} value={order.fulfillment_status} />}
          </div>
        </>
      )} />
    </section>
  )
}

function Status({ value, label }: { value: string; label?: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
      {label && <span className="me-1 font-normal">{label}</span>}{value.replaceAll('_', ' ')}
    </span>
  )
}

type Selection = { product: Product; variant?: Variant }
type Line = Selection & { quantity: string }
type OrderPayload = {
  customer_id: string
  address: string
  city: string
  note: string
  items: { product_id: number; variant_id?: number; quantity: number }[]
}
type Retry = { fingerprint: string; requestId: string }

async function orderFingerprint(payload: OrderPayload) {
  const encoded = new TextEncoder().encode(JSON.stringify(payload))
  const digest = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function readRetry(): Retry | null {
  try {
    const retry = JSON.parse(stored(ORDER_RETRY_KEY) || 'null')
    return typeof retry?.fingerprint === 'string' && typeof retry?.requestId === 'string' ? retry : null
  } catch {
    return null
  }
}

function selectionKey({ product, variant }: Selection) {
  return product.id + '/' + (variant?.id ?? '')
}

function selectionLabel({ product, variant }: Selection) {
  return variant ? product.name + ' – ' + (variant.title || variant.sku) : product.name
}

function OrderForm({ send, lang, copy, close, saved }: {
  send: Send
  lang: Lang
  copy: Copy
  close: () => void
  saved: (order: Order) => void
}) {
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [lines, setLines] = useState<Line[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const retry = useRef<Retry | null>(null)
  const products = useRecords<Product>('products', send, 0, 6)
  const customers = useRecords<Customer>('customers', send, 0, 6)
  const total = lines.reduce((sum, { product, variant, quantity }) => (
    sum + Number((variant || product).price) * Number(quantity || 0)
  ), 0)

  async function place(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!customer || !lines.length || busy) return
    const fields = new FormData(event.currentTarget)
    const items = lines.map(({ product, variant, quantity }) => ({
      product_id: product.id,
      variant_id: variant?.id,
      quantity: Number(quantity),
    }))
    if (items.some((item, index) => {
      const { variant, product } = lines[index]
      return !Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > (variant || product).stock
    })) {
      setError('quantity')
      return
    }
    const payload = {
      customer_id: customer.id,
      address: String(fields.get('address') || '').trim(),
      city: String(fields.get('city') || '').trim(),
      note: String(fields.get('note') || '').trim(),
      items: items.sort((first, second) => (
        first.product_id - second.product_id || (first.variant_id || 0) - (second.variant_id || 0)
      )),
    }
    setBusy(true)
    setError(null)
    try {
      const fingerprint = await orderFingerprint(payload)
      const pending = retry.current || readRetry()
      const requestId = pending?.fingerprint === fingerprint ? pending.requestId : crypto.randomUUID()
      retry.current = { fingerprint, requestId }
      store(ORDER_RETRY_KEY, JSON.stringify(retry.current))
      const order = await send<Order>('/orders', { method: 'POST', body: { ...payload, request_id: requestId } })
      store(ORDER_RETRY_KEY, null)
      saved(order)
    } catch (error) {
      setError(error)
    } finally {
      setBusy(false)
    }
  }

  function addItem(selection: Selection) {
    const key = selectionKey(selection)
    setLines(previous => previous.some(line => selectionKey(line) === key)
      ? previous
      : [...previous, { ...selection, quantity: '1' }])
  }

  function addButton(selection: Selection) {
    const { variant, product } = selection
    const disabled = busy || product.status !== 'active' || (variant || product).stock <= 0 ||
      lines.some(line => selectionKey(line) === selectionKey(selection))
    return (
      <button type="button" className={secondary} aria-label={copy.add + ' ' + selectionLabel(selection)}
        disabled={disabled} onClick={() => addItem(selection)}>{copy.add}</button>
    )
  }

  return (
    <div className={card + ' space-y-5'}>
      <h3 className="font-bold text-slate-900">{copy.newOrder}</h3>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <section className="space-y-2">
          <h4 className="text-sm font-bold text-slate-800">{copy.chooseCustomer}</h4>
          {customer ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3">
              <CustomerSummary customer={customer} />
              <button type="button" className={secondary} onClick={() => setCustomer(null)} disabled={busy}>{copy.changeCustomer}</button>
            </div>
          ) : (
            <Records copy={copy} listing={customers} label={copy.searchCustomer} render={value => (
              <>
                <CustomerSummary customer={value} />
                <button type="button" className={secondary} aria-label={copy.select + ' ' + value.name}
                  onClick={() => setCustomer(value)}>{copy.select}</button>
              </>
            )} />
          )}
        </section>
        <section className="space-y-2">
          <h4 className="text-sm font-bold text-slate-800">{copy.chooseProducts}</h4>
          <Records copy={copy} listing={products} label={copy.searchProduct} render={product => (
            <>
              <ProductSummary product={product} copy={copy} lang={lang} />
              {!product.variants?.length ? addButton({ product }) : (
                <ul aria-label={copy.variants} className="w-full space-y-2 border-s-2 border-slate-100 ps-2">
                  {product.variants.map(variant => (
                    <li key={variant.id} className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 break-words">
                        <p className="text-sm font-semibold">{variant.title || variant.sku}</p>
                        <p className="text-xs text-slate-600">{money(variant.price, lang)} · {variant.stock} {copy.available}</p>
                      </div>
                      {addButton({ product, variant })}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )} />
        </section>
      </div>
      <form className="space-y-4 border-t border-slate-200 pt-4" onSubmit={place}>
        {lines.length > 0 && (
          <section className="space-y-2">
            <h4 className="text-sm font-bold text-slate-800">{copy.orderItems}</h4>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {lines.map(line => {
                const key = selectionKey(line)
                const label = selectionLabel(line)
                const sellable = line.variant || line.product
                return (
                  <li key={key} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div className="min-w-0 break-words">
                      <p className="text-sm font-bold text-slate-900">{label}</p>
                      <p className="text-xs text-slate-600">{money(sellable.price, lang)} · {sellable.stock} {copy.available}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input type="number" required min="1" max={sellable.stock} step="1" value={line.quantity}
                        className={input + ' max-w-24'} aria-label={copy.quantity + ' ' + label} disabled={busy}
                        onChange={event => {
                          const quantity = event.target.value
                          setLines(previous => previous.map(entry => selectionKey(entry) === key ? { ...entry, quantity } : entry))
                        }} />
                      <button type="button" className={secondary} disabled={busy} aria-label={copy.remove + ' ' + label}
                        onClick={() => setLines(previous => previous.filter(entry => selectionKey(entry) !== key))}>{copy.remove}</button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )}
        {customer && (
          <div className="grid gap-3 sm:grid-cols-2" key={customer.id}>
            <Field label={copy.address} name="address" required maxLength={255} defaultValue={customer.address} disabled={busy} />
            <Field label={copy.city} name="city" required maxLength={100} defaultValue={customer.city} disabled={busy} />
            <Field label={copy.note} name="note" maxLength={500} disabled={busy} />
          </div>
        )}
        {!!error && <p role="alert" className="text-sm text-red-700">{error === 'quantity' ? copy.invalidQuantity : errorMessage(error, copy)}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-bold text-slate-800">{copy.estimated} <bdi>{money(total, lang)}</bdi></p>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={button} disabled={busy || !customer || !lines.length}>
              {busy ? copy.placing : copy.placeOrder}
            </button>
            <button type="button" className={secondary} onClick={close} disabled={busy}>{copy.cancel}</button>
          </div>
        </div>
      </form>
    </div>
  )
}
