import { normalizeBarcode } from './scanner'

export type GroceryProduct = {
  id: number; title: string; barcode?: string | null; short_code: string; section: string
  unit_type: 'unit' | 'weight'; price: string; stock: number; stock_grams: number
  pack_count?: number; pack_weight_kg?: string; image_url?: string | null; images?: { src: string }[]; variants?: any[]
}
export type CartLine = { variant_id: number; quantity?: number; grams?: number }

export function shortCode(value: string) {
  const clean = value.trim().toUpperCase().replace(/\s+/g, '')
  const match = /^([A-Z]{1,8})-?(\d+)$/.exec(clean)
  return match ? `${match[1]}-${String(Number(match[2])).padStart(2, '0')}` : clean
}
export function productImage(product?: Partial<GroceryProduct>) {
  return product?.image_url || product?.images?.[0]?.src || ''
}
export function kgToGrams(value: string): number | null {
  if (!/^\d+(\.\d{1,3})?$/.test(value.trim())) return null
  const [whole, fraction = ''] = value.trim().split('.')
  const grams = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'))
  return Number.isSafeInteger(grams) ? grams : null
}
export function priceCents(value: string | number) {
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(String(value))
  return match ? Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0')) : 0
}
export function lineCents(product: GroceryProduct, line: CartLine) {
  const price = priceCents(product.price)
  return product.unit_type === 'weight' ? Math.floor((price * (line.grams || 0) + 500) / 1000) : price * (line.quantity || 0)
}
export function available(product: GroceryProduct) {
  return product.unit_type === 'weight' ? product.stock_grams : Number(product.stock ?? product.variants?.[0]?.inventory_available ?? 0)
}
export function quantityLabel(product: GroceryProduct, lang: 'en' | 'ar') {
  return product.unit_type === 'weight' ? `${(product.stock_grams / 1000).toLocaleString('en-GB', { maximumFractionDigits: 3 })} ${lang === 'ar' ? 'كغ' : 'kg'}` : `${available(product)} ${lang === 'ar' ? 'وحدة' : 'units'}`
}
export function searchProducts(products: GroceryProduct[], query: string, limit = 8) {
  const text = query.trim().toLowerCase()
  if (!text) return []
  const code = shortCode(query).toLowerCase()
  return products.map(product => {
    const id = product.short_code.toLowerCase(), name = product.title.toLowerCase()
    const barcode = String(product.barcode || '').toLowerCase()
    const rank = id === code || barcode === text || name === text ? 0 : id.startsWith(code) ? 1 : name.startsWith(text) ? 2 : name.includes(text) || barcode.startsWith(text) ? 3 : 9
    return { product, rank }
  }).filter(row => row.rank < 9).sort((a, b) => a.rank - b.rank || a.product.short_code.localeCompare(b.product.short_code, undefined, { numeric: true })).slice(0, limit).map(row => row.product)
}
export function exactProduct(products: GroceryProduct[], query: string) {
  const barcode = normalizeBarcode(query), code = shortCode(query)
  const matches = products.filter(p => p.short_code.toUpperCase() === code || !!p.barcode && normalizeBarcode(p.barcode) === barcode || p.title.toLowerCase() === query.trim().toLowerCase())
  return matches.length === 1 ? matches[0] : undefined
}
