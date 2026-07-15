"use client"

import { useCallback, useEffect, useState } from "react"

export type ShopifyStore = {
  label: string
  shop?: string | null
  connected?: boolean
  credentials_configured?: boolean
  required_env?: string[]
  missing_env?: string[]
  warnings?: string[]
}

export const FALLBACK_SHOPIFY_STORES: ShopifyStore[] = [
  { label: "irrakids" },
  { label: "irranova" },
  { label: "mmd" },
]

type StoreRegistryData = {
  stores?: ShopifyStore[]
  callback_url?: string | null
  persistent_token_storage?: boolean
}

function withCurrentStore(stores: ShopifyStore[], currentStore?: string): ShopifyStore[] {
  const current = String(currentStore || "").trim().toLowerCase()
  const seen = new Set<string>()
  const result: ShopifyStore[] = []
  for (const item of [...stores, ...(current ? [{ label: current }] : [])]) {
    const label = String(item?.label || "").trim().toLowerCase()
    if (!label || seen.has(label)) continue
    seen.add(label)
    result.push({ ...item, label })
  }
  return result
}

export function useShopifyStores(currentStore?: string) {
  const [stores, setStores] = useState<ShopifyStore[]>(() => withCurrentStore(FALLBACK_SHOPIFY_STORES, currentStore))
  const [registry, setRegistry] = useState<StoreRegistryData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || ""

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await fetch(`${apiBase}/api/shopify/stores`, { cache: "no-store" })
      const payload = await response.json()
      if (!response.ok || payload?.error) throw new Error(payload?.error || `Request failed (${response.status})`)
      const data = (payload?.data || {}) as StoreRegistryData
      const configured = Array.isArray(data.stores) ? data.stores : []
      setStores(withCurrentStore(configured.length ? configured : FALLBACK_SHOPIFY_STORES, currentStore))
      setRegistry(data)
    } catch (err: any) {
      setStores(previous => withCurrentStore(previous.length ? previous : FALLBACK_SHOPIFY_STORES, currentStore))
      setError(String(err?.message || err || "Unable to load Shopify stores"))
    } finally {
      setLoading(false)
    }
  }, [apiBase, currentStore])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { stores, registry, loading, error, refresh }
}
