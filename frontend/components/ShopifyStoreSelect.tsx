"use client"

import { useShopifyStores } from "@/lib/shopifyStores"

export default function ShopifyStoreSelect({
  value,
  onChange,
  className = "",
  disabled = false,
}: {
  value: string
  onChange: (value: string) => void
  className?: string
  disabled?: boolean
}) {
  const { stores, loading } = useShopifyStores(value)
  return (
    <select
      value={value}
      onChange={event => onChange(event.target.value)}
      className={className}
      disabled={disabled || loading}
      aria-label="Shopify store"
    >
      {stores.map(store => (
        <option key={store.label} value={store.label}>{store.label}</option>
      ))}
    </select>
  )
}
