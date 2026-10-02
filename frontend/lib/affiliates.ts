export const affiliateBase = process.env.NEXT_PUBLIC_API_BASE_URL || "";

export async function affiliateApi(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  admin = false,
) {
  const token =
    typeof window === "undefined"
      ? ""
      : localStorage.getItem(
          admin ? "ptos_system_admin_token" : "ptos_affiliate_token",
        ) || "";
  const response = await fetch(`${affiliateBase}/api/affiliates${path}`, {
    method,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let result: any;
  try {
    result = JSON.parse(await response.text());
  } catch {
    throw new Error(
      path === "/orders" && method === "POST"
        ? `The order response could not be confirmed (${response.status}). Check your orders before submitting again; an administrator may need to reconcile it.`
        : `The server could not complete this request (${response.status}). Please refresh and try again.`,
    );
  }
  if (!response.ok || result.error)
    throw new Error(
      typeof result.detail === "string"
        ? result.detail
        : result.error || `Request failed (${response.status})`,
    );
  return result.data;
}

export function productImage(src: string | undefined, width = 400) {
  if (!src) return undefined;
  try {
    const url = new URL(src);
    if (
      url.hostname === "cdn.shopify.com" ||
      url.hostname.endsWith(".shopifycdn.com")
    )
      url.searchParams.set("width", String(width));
    return url.toString();
  } catch {
    return src;
  }
}

export type RoutingCity = { id: string; name: string; country: string };
export type Receipt = {
  name?: string;
  customer_name: string;
  customer_phone: string;
  city: string;
  address: string;
  note?: string;
  currency: string;
  total: number;
  delivery_fee?: number;
  delivery_included?: boolean;
  items: {
    title: string;
    variant: string;
    color?: string;
    size?: string;
    image?: string;
    quantity: number;
    unit_price: number;
    total: number;
  }[];
};

export function money(
  value: number | string,
  currency = "MAD",
  language = "en",
) {
  return new Intl.NumberFormat(language === "ar" ? "ar-MA" : language, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

export type Variant = {
  id: string;
  title: string;
  price: string;
  unit_cost: number | null;
  available: boolean;
  inventory_quantity: number | null;
  color: string;
  size: string;
  image?: string;
  options: string[];
};
export type AffiliateProduct = {
  id: string;
  store: string;
  currency: string;
  title: string;
  vendor?: string;
  image?: string;
  images: string[];
  description: string;
  category: string;
  created_at: string;
  discount_percent: number;
  marked?: boolean;
  inventory_quantity: number;
  inventory_tracked: boolean;
  variants: Variant[];
};
export type AffiliateCustomer = {
  id: string;
  customer_name: string;
  customer_phone: string;
  address: string;
  city: string;
  country: string;
  orders_count: number;
  orders: any[];
};
export type CartLine = {
  product: AffiliateProduct;
  variant: Variant;
  quantity: number;
  sale_price: string;
};
export const field =
  "min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 md:text-sm";
export const button =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-40";
export const secondary =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold hover:bg-slate-50 disabled:opacity-40";
