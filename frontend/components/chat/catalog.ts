// Catalog data layer — the vendor's in-stock Shopify products, surfaced in chat.
// Images are Shopify CDN links used directly (never uploaded/downloaded).

const API = process.env.NEXT_PUBLIC_API_BASE_URL || ''

export type CatalogVariant = {
  id: string
  title: string
  price?: string | null
  compare_at_price?: string | null
  available: number
  sku?: string
  image?: string
  pcs_per_crate?: number
  unit_price?: number
}

export type CatalogProduct = {
  id: string
  handle: string
  title: string
  description_html: string
  image: string
  images: string[]
  price_min: number
  price_max: number
  unit_price_min?: number
  unit_price_max?: number
  pcs_options?: number[]
  compare_at_price?: string | null
  available: number
  created_at?: string
  variants: CatalogVariant[]
}

export type CatalogSort = 'newest' | 'oldest' | 'stock'

export type CatalogVendor = { id: string; name: string; store_type?: string }
export type Catalog = { vendor: CatalogVendor; products: CatalogProduct[]; count: number }

// Compact card embedded in a chat message (keeps messages small).
export type ProductCard = {
  vendor: string
  id: string
  title: string
  image: string
  price_min: number
  price_max: number
  unit_price_min?: number
  unit_price_max?: number
  pcs_options?: number[]
  available: number
  handle?: string
}
export type CatalogCard = { vendor: string; title: string; count: number; products: ProductCard[] }

export function toProductCard(vendor: string, p: CatalogProduct): ProductCard {
  return {
    vendor,
    id: p.id,
    title: p.title,
    image: p.image,
    price_min: p.price_min,
    price_max: p.price_max,
    unit_price_min: p.unit_price_min,
    unit_price_max: p.unit_price_max,
    pcs_options: p.pcs_options,
    available: p.available,
    handle: p.handle,
  }
}

export function sortProducts(products: CatalogProduct[], sort: CatalogSort): CatalogProduct[] {
  const out = [...products]
  if (sort === 'stock') out.sort((a, b) => b.available - a.available)
  else if (sort === 'oldest') out.sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
  else out.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')) // newest
  return out
}

function dh(n: number) {
  return `${Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`
}

export function priceLabel(min: number, max: number) {
  if (!max || min === max) return dh(min)
  return `${dh(min)} – ${dh(max)}`
}

export function unitPriceLabel(min?: number, max?: number) {
  const lo = min || 0, hi = max || 0
  if (!lo && !hi) return ''
  if (!hi || lo === hi) return dh(lo)
  return `${dh(lo)} – ${dh(hi)}`
}

export function pcsLabel(pcs?: number[]) {
  const list = (pcs || []).filter(Boolean)
  if (!list.length) return ''
  if (list.length === 1) return `${list[0]} pcs/crate`
  return `${list[0]}–${list[list.length - 1]} pcs/crate`
}

export async function fetchCatalog(vendor: string, refresh = false): Promise<Catalog> {
  const res = await fetch(`${API}/api/chat/catalog?vendor=${encodeURIComponent(vendor)}${refresh ? '&refresh=1' : ''}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const { data, error } = await res.json()
  if (error) throw new Error(error)
  return data
}

export async function fetchCatalogProduct(vendor: string, id: string): Promise<CatalogProduct | null> {
  try {
    const res = await fetch(`${API}/api/chat/catalog/product?vendor=${encodeURIComponent(vendor)}&id=${encodeURIComponent(id)}`)
    if (!res.ok) return null
    const { data, error } = await res.json()
    if (error) return null
    return data
  } catch { return null }
}
