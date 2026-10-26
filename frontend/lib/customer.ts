const API = process.env.NEXT_PUBLIC_API_BASE_URL || ''
const PREFIX = '/api/customers'

export type Customer = { id: string; phone: string; name?: string; chat_id: string }
export type CustomerMerchant = {
  ref: string; id: string; name: string; kind: 'vendor' | 'seller'; chat_id: string
  account_type?: string; avatar?: string; requires_delivery?: boolean
}
export type CustomerVariant = {
  id: string | number; title: string; price: string | number; available: number
  unit_type?: 'unit' | 'weight'; stock_grams?: number; image?: string
}
export type CustomerProduct = {
  id: string | number; title: string; image?: string; image_url?: string; images?: Array<string | { src: string }>
  product_type?: string; collection_ids?: Array<string | number>; variants: CustomerVariant[]
  unit_type?: 'unit' | 'weight'; price_unit?: string; stock_grams?: number
  price_min?: number; price_max?: number
  fulfillment_group?: string; currency?: string
}
export type CustomerCatalog = {
  merchant: CustomerMerchant; collections: Array<{ id: string | number; title: string }>; products: CustomerProduct[]
  delivery_fee?: string | number; delivery_fees?: Record<string, string | number>; currency?: string; delivery_cities?: Array<{ id?: string | number; name: string }>
}
export type CustomerOrderLine = {
  title?: string; name?: string; variant_title?: string; quantity?: number; grams?: number
  price?: string | number; unit_type?: 'unit' | 'weight'; image?: string
}
export type CustomerOrder = {
  id: string | number; name?: string; merchant_ref: string; merchant_name?: string
  status?: string; payment_status?: string; total?: string | number; total_price?: string | number
  created_at?: string; line_items?: CustomerOrderLine[]; request_id?: string
  currency?: string
}
export type CustomerOrderRequest = {
  request_id: string; merchant_ref: string
  expected_total?: string
  line_items: Array<{ product_id: string | number; variant_id: string | number; quantity?: number; grams?: number }>
  customer_name?: string; address?: { address1: string; city: string; province?: string; zip?: string; country?: string }
}

export class CustomerApiError extends Error {
  status: number
  code: string
  detail: unknown
  constructor(message: string, status = 0, code = 'network_error', detail?: unknown) {
    super(message); this.name = 'CustomerApiError'; this.status = status; this.code = code; this.detail = detail
  }
  get uncertain() {
    return this.status === 0 || this.status >= 500 || this.status === 408 ||
      /processing|pending|uncertain|review|in_progress|request_reused|request_conflict/i.test(this.code)
  }
}

/** Coordinate a single customer's merchant basket across tabs when supported. */
export async function withCustomerCartLock<T>(storageKey: string, action: () => Promise<T> | T): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return await navigator.locks.request(`customer-checkout:${storageKey}`, { mode: 'exclusive' }, async () => await action())
  }
  return await action()
}

export function canPersistCustomerCartDraft(saved: { revision?: number; pending?: { request_id: string } | null } | null,
  draft: { revision?: number; pending?: { request_id: string } | null }): boolean {
  if (!saved) return !draft.pending
  return (saved.revision || 0) === (draft.revision || 0) &&
    (saved.pending?.request_id || '') === (draft.pending?.request_id || '')
}

async function request<T>(path: string, method = 'GET', body?: object): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25000)
  try {
    const response = await fetch(API + PREFIX + path, {
      method, credentials: 'include', cache: 'no-store', signal: controller.signal,
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    })
    let result: any
    try { result = await response.json() } catch {
      throw new CustomerApiError('The shop could not be reached. Please try again.', response.status >= 400 ? response.status : 502)
    }
    if (!response.ok || result.error || result.detail) {
      const detail = result.detail || result
      const code = typeof detail === 'string' ? detail : detail.error || result.error || 'request_failed'
      const message = typeof detail === 'string' ? detail : detail.message || detail.error || result.error || 'Please check your information.'
      throw new CustomerApiError(message, response.status, String(code), detail)
    }
    return result.data as T
  } catch (error) {
    if (error instanceof CustomerApiError) throw error
    throw new CustomerApiError('Connection interrupted. Please try again.')
  } finally { clearTimeout(timer) }
}

export const customerApi = {
  me: () => request<Customer>('/me'),
  invitation: (invite: string) => request<CustomerMerchant | { merchant: CustomerMerchant }>('/invites/' + encodeURIComponent(invite)),
  register: (body: { phone: string; password: string; password_confirm: string; name?: string; invite: string }) => request<Customer>('/register', 'POST', body),
  login: (body: { phone: string; password: string; invite?: string }) => request<Customer>('/login', 'POST', body),
  logout: () => request<{ ok: boolean }>('/logout', 'POST', {}),
  link: (invite: string) => request<CustomerMerchant>('/links', 'POST', { invite }),
  merchants: () => request<CustomerMerchant[]>('/merchants'),
  catalog: (ref: string) => request<CustomerCatalog>('/merchants/' + encodeURIComponent(ref) + '/catalog'),
  orders: () => request<CustomerOrder[]>('/orders'),
  order: (body: CustomerOrderRequest) => request<CustomerOrder>('/orders', 'POST', body),
}

export function customerImage(product: Pick<CustomerProduct, 'image' | 'images'>): string {
  const first = product.images?.[0]
  const src = product.image || (product as CustomerProduct).image_url || (typeof first === 'string' ? first : first?.src) || ''
  return /^https?:\/\//i.test(src) ? src : src.startsWith('/') ? API + src : ''
}

export function customerPriceCents(value: unknown): number {
  const text = String(value ?? '0')
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return 0
  const [whole, fraction = ''] = text.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(cents) ? cents : 0
}

export function customerMoney(cents: number, lang: 'en' | 'ar' = 'en', currency = 'MAD'): string {
  const locale = lang === 'ar' ? 'ar-MA' : 'en-GB'
  if (currency !== 'MAD') {
    try { return (cents / 100).toLocaleString(locale, { style: 'currency', currency }) } catch {}
  }
  return `${(cents / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === 'MAD' ? lang === 'ar' ? 'درهم' : 'DH' : currency}`
}

export function customerWeight(product: CustomerProduct, variant?: CustomerVariant): boolean {
  return (variant?.unit_type || product.unit_type) === 'weight'
}

export function customerStock(product: CustomerProduct, variant: CustomerVariant): number {
  const available = customerWeight(product, variant)
    ? (variant.stock_grams ?? product.stock_grams ?? Math.round(Number(variant.available || 0) * 1000))
    : Number(variant.available || 0)
  return Number.isSafeInteger(available) && available > 0 ? available : 0
}

export function gramsFromInput(value: string, unit: 'g' | 'kg'): number | null {
  if (unit === 'g') return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : null
  if (!/^\d+(?:\.\d{1,3})?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  const grams = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'))
  return Number.isSafeInteger(grams) ? grams : null
}

export function customerLineCents(price: unknown, quantity: number, weight: boolean): number {
  if (!Number.isSafeInteger(quantity) || quantity < 0) return 0
  const amount = BigInt(customerPriceCents(price)) * BigInt(quantity)
  const cents = Number(weight ? (amount + 500n) / 1000n : amount)
  return Number.isSafeInteger(cents) ? cents : 0
}

export function customerOrderQuantity(line: CustomerOrderLine, lang: 'en' | 'ar'): string {
  return line.unit_type === 'weight' || (line.grams || 0) > 0
    ? `${((line.grams || 0) / 1000).toLocaleString(lang === 'ar' ? 'ar-MA' : 'en-GB')} kg`
    : `${line.quantity || 0} ×`
}

export function customerError(error: unknown, lang: 'en' | 'ar'): string {
  const code = error instanceof CustomerApiError ? error.code : ''
  const ar = lang === 'ar'
  if (/unauthorized|invalid_session|not_authenticated/.test(code)) return ar ? 'يرجى تسجيل الدخول مجدداً.' : 'Please sign in again.'
  if (/invalid_credentials/.test(code)) return ar ? 'رقم الهاتف أو كلمة المرور غير صحيحة.' : 'The phone number or password is incorrect.'
  if (/phone.*exists|already_registered|customer_exists/.test(code)) return ar ? 'هذا الرقم مسجل بالفعل. اختر تسجيل الدخول.' : 'This phone is already registered. Choose Sign in.'
  if (/price_changed/.test(code)) return ar ? 'تغيرت الأسعار وتم تحديث سلتك. راجع المجموع ثم أكد طلبك مجدداً.' : 'Prices changed and your basket has been refreshed. Review the total, then place your order again.'
  if (/stock|inventory/.test(code)) return ar ? 'تغير المخزون. راجع الكميات ثم حاول مجدداً.' : 'Stock has changed. Review your quantities and try again.'
  if (/invite|invitation/.test(code)) return ar ? 'رابط المتجر غير متاح. اطلب رابطاً جديداً من التاجر.' : 'This shop invitation is unavailable. Ask the merchant for a new link.'
  if (/checkout_unavailable|merchant_not_ready|unsupported_merchant/.test(code)) return ar ? 'الطلب غير متاح لهذا المتجر حالياً. يمكنك التواصل معه عبر الدردشة.' : 'Ordering is unavailable for this shop. You can contact the merchant in chat.'
  if (error instanceof CustomerApiError && error.status === 0) return ar ? 'انقطع الاتصال. تحقق من الإنترنت ثم حاول مجدداً.' : 'Connection interrupted. Check your internet and try again.'
  if (/review|uncertain|pending|processing|in_progress|request_conflict/.test(code)) return ar ? 'طلبك قيد التحقق. أعد محاولة نفس الطلب أو راجع سجل الطلبات.' : 'Your order needs confirmation. Retry the same order or check your order history.'
  return ar ? 'تعذر إتمام العملية. تحقق من المعلومات وحاول مجدداً.' : (error instanceof Error ? error.message : 'Please try again.')
}
