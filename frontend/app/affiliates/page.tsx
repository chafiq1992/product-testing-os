"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AffiliateLocaleProvider,
  AffiliateLanguageSwitch,
  useAffiliateLocale,
} from "@/lib/affiliate-locale";
import AffiliatePayoutRequest from "@/components/AffiliatePayoutRequest";
import AffiliateMarketplace from "@/components/AffiliateMarketplace";
import AffiliateModal from "@/components/AffiliateModal";
import AffiliateOrderEditor from "@/components/AffiliateOrderEditor";
import AffiliateOrderDetails from "@/components/AffiliateOrderDetails";
import AffiliateOrderTracking from "@/components/AffiliateOrderTracking";
import AffiliateCustomers from "@/components/AffiliateCustomers";
import {
  BarChart3,
  Package,
  ShoppingBag,
  Wallet,
  LogOut,
  RefreshCw,
  ArrowUpRight,
  Plus,
  X,
  CheckCircle2,
  Store,
  Loader2,
} from "lucide-react";
import {
  affiliateApi,
  money,
  field,
  button,
  secondary,
  AffiliateProduct,
  CartLine,
  AffiliateCustomer,
  RoutingCity,
} from "@/lib/affiliates";
type Tab = "overview" | "products" | "orders" | "payouts";
const tabs = [
  { id: "overview", label: "Overview", icon: BarChart3 },
  { id: "products", label: "Marketplace", icon: Package },
  { id: "orders", label: "My orders", icon: ShoppingBag },
  { id: "payouts", label: "Payouts", icon: Wallet },
] as const;
const empty = { orders: [], payouts: [], analytics: {}, warnings: [] } as any;
export default function AffiliatePage() {
  return (
    <AffiliateLocaleProvider>
      <AffiliateWorkspace />
    </AffiliateLocaleProvider>
  );
}
function AffiliateWorkspace() {
  const { t, language, dir } = useAffiliateLocale();
  const [seller, setSeller] = useState<any>(null);
  const [ready, setReady] = useState(false);
  const [apply, setApply] = useState(false);
  const [credentials, setCredentials] = useState({
    name: "",
    username: "",
    password: "",
    phone: "",
  });
  const [tab, setTab] = useState<Tab>("overview");
  const [products, setProducts] = useState<AffiliateProduct[]>([]);
  const [catalogWarnings, setCatalogWarnings] = useState<string[]>([]);
  const [data, setData] = useState<any>(empty);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [currency, setCurrency] = useState("MAD");
  const [orderStatus, setOrderStatus] = useState("");
  const [orderGroup, setOrderGroup] = useState("all");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customers, setCustomers] = useState<AffiliateCustomer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [choosingProducts, setChoosingProducts] = useState(false);
  const [editingOrder, setEditingOrder] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState("");
  const [createdOrder, setCreatedOrder] = useState("");
  const [cities, setCities] = useState<RoutingCity[]>([]);
  const [citiesError, setCitiesError] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const sellerId = useRef("");
  const productsRunning = useRef(false);
  const productsUpdatedAt = useRef(0);
  const [showCustomers, setShowCustomers] = useState(false);
  const [pricing, setPricing] = useState<{
    delivery_fees: Record<string, number | string>;
  }>({ delivery_fees: { MAD: 33 } });
  const [customer, setCustomer] = useState({
    customer_name: "",
    customer_phone: "",
    address: "",
    city: "",
    country: "MA",
    note: "",
  });
  const requestId = useRef<string>("");
  const refreshRunning = useRef(false);
  const status = data.analytics[currency] || {
    orders: 0,
    delivered: 0,
    sales: 0,
    profit: 0,
    pending_profit: 0,
    available: 0,
    reserved: 0,
    paid: 0,
  };
  const loadProducts = useCallback(async (force = false) => {
    if (
      productsRunning.current ||
      (!force && Date.now() - productsUpdatedAt.current < 30000)
    )
      return;
    productsRunning.current = true;
    setCatalogLoading(true);
    try {
      const key = `ptos_marketplace:${sellerId.current}`;
      if (!productsUpdatedAt.current) {
        try {
          const saved = JSON.parse(sessionStorage.getItem(key) || "null");
          if (saved && Date.now() - saved.timestamp < 900000) {
            setProducts(saved.data.products);
            setPricing(saved.data.pricing);
          }
        } catch {}
      }
      const catalog = await affiliateApi("/products");
      setProducts(catalog.products);
      setCatalogWarnings(catalog.warnings);
      setPricing(catalog.pricing);
      setCatalogRefreshing(!!catalog.refreshing);
      productsUpdatedAt.current = Date.now();
      try {
        sessionStorage.setItem(
          key,
          JSON.stringify({ timestamp: Date.now(), data: catalog }),
        );
      } catch {}
      setCart((previous) =>
        previous.map((line) => {
          const product = catalog.products.find(
            (p: AffiliateProduct) =>
              p.id === line.product.id && p.store === line.product.store,
          );
          const variant = product?.variants.find(
            (v: any) => v.id === line.variant.id,
          );
          return product && variant
            ? { ...line, product, variant }
            : {
                ...line,
                variant: {
                  ...line.variant,
                  available: false,
                  inventory_quantity: 0,
                },
              };
        }),
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCatalogLoading(false);
      productsRunning.current = false;
    }
  }, []);
  const loadCities = useCallback(async () => {
    setCitiesError("");
    try {
      const result = await affiliateApi("/cities");
      setCities(result.cities);
      if (!result.cities.length)
        setCitiesError(
          "The delivery app has no active routing cities. Ask your administrator to add a route.",
        );
    } catch (err: any) {
      setCitiesError(err.message);
    }
  }, []);
  const refresh = useCallback(
    async (withProducts = false) => {
      // Catalog requests have their own lifecycle; slow order tracking must not
      // hold up product browsing or the picker.
      if (withProducts && sellerId.current) void loadProducts(true);
      if (refreshRunning.current) return;
      refreshRunning.current = true;
      setLoading(true);
      try {
        const current = await affiliateApi("/me");
        sellerId.current = current.id;
        setSeller(current);
        if (current.status === "approved") {
          const tasks = [
            affiliateApi("/dashboard").then(setData),
            affiliateApi("/customers").then(setCustomers),
          ];
          if (withProducts) tasks.push(loadProducts());
          const results = await Promise.allSettled(tasks);
          results.forEach((result) => {
            if (result.status === "rejected") setError(result.reason.message);
          });
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
        refreshRunning.current = false;
      }
    },
    [loadProducts],
  );
  useEffect(() => {
    if (!localStorage.getItem("ptos_affiliate_token")) {
      setReady(true);
      return;
    }
    affiliateApi("/me")
      .then((current) => {
        sellerId.current = current.id;
        setSeller(current);
        if (current.status === "approved") void refresh(true);
      })
      .catch(() => localStorage.removeItem("ptos_affiliate_token"))
      .finally(() => setReady(true));
  }, [refresh]);
  useEffect(() => {
    if (!seller) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible")
        void refresh(tab === "products" || choosingProducts || cart.length > 0);
    }, 60000);
    return () => clearInterval(interval);
  }, [seller?.id, tab, choosingProducts, cart.length, refresh]);
  useEffect(() => {
    if (
      seller?.status === "approved" &&
      (tab === "products" || choosingProducts)
    )
      void loadProducts();
  }, [tab, choosingProducts, seller?.id, loadProducts]);
  useEffect(() => {
    if (!catalogRefreshing || !seller?.id) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void loadProducts(true);
    }, 5000);
    return () => clearInterval(interval);
  }, [catalogRefreshing, seller?.id, loadProducts]);
  useEffect(() => {
    if (editingOrder && !cities.length) void loadCities();
  }, [editingOrder, loadCities]);
  const submissionKey = JSON.stringify({
    customer,
    customerId,
    items: cart.map((line) => [
      line.product.store,
      line.product.id,
      line.variant.id,
      line.quantity,
      line.sale_price,
    ]),
  });
  useEffect(() => {
    requestId.current = crypto.randomUUID();
  }, [submissionKey]);
  async function markProduct(product: AffiliateProduct) {
    try {
      const result = await affiliateApi(
        "/marks",
        {
          store: product.store,
          product_id: product.id,
          marked: !product.marked,
        },
        "PUT",
      );
      setProducts((previous) =>
        previous.map((p) =>
          p.id === product.id && p.store === product.store
            ? { ...p, marked: result.marked }
            : p,
        ),
      );
    } catch (err: any) {
      setError(err.message);
    }
  }
  function startOrder(saved?: AffiliateCustomer) {
    setTab("orders");
    setShowCustomers(false);
    setEditingOrder(true);
    setChoosingProducts(false);
    setNotice("");
    if (saved) {
      setCustomerId(saved.id);
      setCustomer({
        customer_name: saved.customer_name,
        customer_phone: saved.customer_phone,
        address: saved.address,
        city: saved.city,
        country: "MA",
        note: "",
      });
    }
  }
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [tab]);
  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (apply) {
        await affiliateApi("/apply", credentials);
        setApply(false);
        setNotice(
          "Application submitted. Sign in to check your approval status.",
        );
      } else {
        const result = await affiliateApi("/login", {
          username: credentials.username,
          password: credentials.password,
        });
        localStorage.setItem("ptos_affiliate_token", result.token);
        sellerId.current = result.seller.id;
        setSeller(result.seller);
        if (result.seller.status === "approved") await refresh(true);
      }
      setCredentials((previous) => ({ ...previous, password: "" }));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    try {
      await affiliateApi("/logout", {});
    } catch {}
    sessionStorage.removeItem(`ptos_marketplace:${sellerId.current}`);
    sellerId.current = "";
    productsUpdatedAt.current = 0;
    setEditingOrder(false);
    setSelectedOrder("");
    setOrderGroup("all");
    setOrderStatus("");
    setCreatedOrder("");
    setCities([]);
    localStorage.removeItem("ptos_affiliate_token");
    setSeller(null);
    setData(empty);
    setProducts([]);
    setCart([]);
    setCustomers([]);
    setCustomerId("");
    setCustomer({
      customer_name: "",
      customer_phone: "",
      address: "",
      city: "",
      country: "MA",
      note: "",
    });
    setTab("overview");
    setCurrency("MAD");
    setChoosingProducts(false);
    setShowCustomers(false);
    setError("");
    setNotice("");
  }
  function addLine(
    product: AffiliateProduct,
    variantId: string,
    price: string,
  ) {
    const variant = product.variants.find((v) => v.id === variantId);
    if (!variant || variant.unit_cost === null || !variant.available) return;
    if (!Number.isFinite(Number(price)) || Number(price) <= variant.unit_cost) {
      setError("Choose a sale price above the product cost.");
      return;
    }
    if (cart.length && cart[0].product.store !== product.store) {
      setError(
        "These products need separate orders. Submit your current order first.",
      );
      return;
    }
    const existing = cart.find(
      (line) =>
        line.product.store === product.store && line.variant.id === variant.id,
    );
    if (
      variant.inventory_quantity !== null &&
      (existing?.quantity || 0) + 1 > variant.inventory_quantity
    ) {
      setError("There is not enough stock to add another item.");
      return;
    }
    setCart((previous) => {
      const existing = previous.find(
        (line) =>
          line.variant.id === variant.id &&
          line.product.store === product.store,
      );
      return existing
        ? previous.map((line) =>
            line === existing
              ? { ...line, quantity: line.quantity + 1, sale_price: price }
              : line,
          )
        : [...previous, { product, variant, quantity: 1, sale_price: price }];
    });
    setError("");
    setNotice("");
    setEditingOrder(true);
    setChoosingProducts(false);
    setShowCustomers(false);
    setCurrency(product.currency);
    setTab("orders");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  async function submitOrder(event: React.FormEvent) {
    event.preventDefault();
    if (!cart.length) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const created = await affiliateApi("/orders", {
        ...customer,
        customer_id: customerId || undefined,
        store: cart[0].product.store,
        request_id: requestId.current,
        items: cart.map((line) => ({
          product_id: line.product.id,
          variant_id: line.variant.id,
          quantity: line.quantity,
          sale_price: line.sale_price,
        })),
      });
      setCreatedOrder(created.id);
      setCart([]);
      setEditingOrder(false);
      setCustomerId("");
      setCustomer({
        customer_name: "",
        customer_phone: "",
        address: "",
        city: "",
        country: "MA",
        note: "",
      });
      setNotice(
        "Order created. Your customer was saved and delivery status will update here.",
      );
      await refresh(true);
    } catch (err: any) {
      setError(err.message);
      await refresh(true);
    } finally {
      setBusy(false);
    }
  }
  const alerts = (
    <>
      {error && (
        <div
          role="alert"
          className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {t(String(error))}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="mb-5 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
        >
          <CheckCircle2 size={18} />
          {t(String(notice))}
        </div>
      )}
    </>
  );
  if (!ready)
    return (
      <main
        dir={dir}
        lang={language}
        className="grid min-h-screen place-items-center bg-slate-50"
      >
        <Loader2 className="animate-spin text-emerald-700" />
      </main>
    );
  if (!seller)
    return (
      <main
        dir={dir}
        lang={language}
        className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-6"
      >
        <div className="mx-auto max-w-5xl">
          <header className="mb-6 flex flex-wrap items-center justify-between gap-3 md:mb-12">
            <Link
              href="/"
              className="flex min-h-11 items-center gap-2 font-bold"
            >
              <Store className="text-emerald-700" />
              {t(" Seller hub")}
            </Link>
            <Link
              href="/wholesale"
              className="flex min-h-11 items-center text-sm text-slate-500"
            >
              {t("Wholesale dashboard")}
            </Link>
            <AffiliateLanguageSwitch />
          </header>
          <div className="grid gap-10 md:grid-cols-2">
            <section className="order-2 md:order-1 md:pt-8">
              <p className="text-xs font-bold uppercase tracking-[.2em] text-emerald-700">
                {t("Your next business starts here")}
              </p>
              <h1 className="mt-4 text-3xl font-bold leading-tight sm:text-4xl">
                {t("Find a product.")}
                <br />
                {t("Make your first sale.")}
              </h1>
              <p className="mt-5 max-w-md text-slate-600">
                {t(
                  "Discover products in the Marketplace. Set your selling price, submit customer orders, and follow your earnings from delivery to payout.",
                )}
              </p>
              <div className="mt-8 space-y-4 text-sm text-slate-600">
                {[
                  "Products, sizes and stock in one Marketplace",
                  "Your sale price, your margin",
                  "Delivery tracking and reviewed payouts",
                ].map((text) => (
                  <p key={text} className="flex gap-3">
                    <CheckCircle2 className="text-emerald-700" size={19} />
                    {t(String(text))}
                  </p>
                ))}
              </div>
            </section>
            <form
              onSubmit={signIn}
              className="order-1 rounded-3xl border bg-white p-5 shadow-sm sm:p-7 md:order-2"
            >
              <h2 className="text-xl font-bold">
                {apply ? t("Apply to become a seller") : t("Welcome back")}
              </h2>
              <p className="mb-6 mt-2 text-sm text-slate-500">
                {apply
                  ? t(
                      "Access is granted after an administrator reviews your application.",
                    )
                  : t("Sign in to your seller workspace.")}
              </p>
              {alerts}
              {(apply
                ? ["name", "phone", "username", "password"]
                : ["username", "password"]
              ).map((key) => (
                <label
                  key={key}
                  className="mb-4 block text-sm font-medium capitalize"
                >
                  {t(String(key))}
                  <input
                    required
                    type={
                      key === "password"
                        ? "password"
                        : key === "phone"
                          ? "tel"
                          : "text"
                    }
                    autoComplete={
                      key === "password"
                        ? apply
                          ? "new-password"
                          : "current-password"
                        : key === "username"
                          ? "username"
                          : undefined
                    }
                    minLength={key === "password" && apply ? 8 : undefined}
                    value={(credentials as any)[key]}
                    onChange={(e) =>
                      setCredentials({ ...credentials, [key]: e.target.value })
                    }
                    className={`${field} mt-1`}
                  />
                </label>
              ))}
              <button disabled={busy} className={`${button} mt-2 w-full`}>
                {busy
                  ? t("Please wait…")
                  : apply
                    ? t("Submit application")
                    : t("Sign in")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setApply(!apply);
                  setError("");
                }}
                className="mt-5 min-h-11 w-full text-sm font-semibold text-emerald-700"
              >
                {apply
                  ? t("Already registered? Sign in")
                  : t("New here? Apply to sell")}
              </button>
            </form>
          </div>
        </div>
      </main>
    );
  if (seller.status !== "approved")
    return (
      <main
        dir={dir}
        lang={language}
        className="grid min-h-screen place-items-center bg-slate-50 p-6 text-slate-900"
      >
        <section className="max-w-lg rounded-3xl border bg-white p-8 text-center">
          <div className="mb-4 flex justify-center">
            <AffiliateLanguageSwitch />
          </div>
          <Store className="mx-auto mb-5 text-emerald-700" size={36} />
          <h1 className="text-2xl font-bold">
            {seller.status === "pending"
              ? t("Your application is under review")
              : t(`Account ${t(seller.status)}`)}
          </h1>
          <p className="my-4 text-sm text-slate-600">
            {seller.name}
            {t(
              ", an administrator must approve your account and vendor access before you can browse products or submit orders.",
            )}
          </p>
          {alerts}
          <div className="flex flex-wrap justify-center gap-3">
            <button
              disabled={loading}
              onClick={() => refresh(true)}
              className={button}
            >
              {t("Check status")}
            </button>
            <button onClick={logout} className={secondary}>
              {t("Sign out")}
            </button>
          </div>
        </section>
      </main>
    );
  const currencies = Array.from(
    new Set([
      "MAD",
      ...products.map((p) => p.currency),
      ...Object.keys(data.analytics),
    ]),
  );
  const orders = data.orders.filter(
    (o: any) =>
      o.currency === currency &&
      (!orderStatus || o.status === orderStatus) &&
      (orderGroup !== "affiliate_cancelled" || o.affiliate_cancelled),
  );
  const cartCurrency = cart[0]?.product.currency || currency;
  const deliveryFee = Number(pricing.delivery_fees[cartCurrency] ?? NaN);
  const grossMargin = cart.reduce(
    (sum, line) =>
      sum +
      (Number(line.sale_price) - Number(line.variant.unit_cost)) *
        line.quantity,
    0,
  );
  const today = new Date();
  const trend = Array.from({ length: 14 }, (_, i) => {
    const date = new Date(today);
    date.setDate(today.getDate() - 13 + i);
    const key = date.toISOString().slice(0, 10);
    return {
      date: key,
      total: data.orders
        .filter(
          (o: any) =>
            o.currency === currency && o.created_at.slice(0, 10) === key,
        )
        .reduce((sum: number, o: any) => sum + o.profit, 0),
    };
  });
  const maxProfit = Math.max(1, ...trend.map((day) => day.total));
  return (
    <main
      dir={dir}
      lang={language}
      className="min-h-screen min-w-0 max-w-full overflow-x-clip bg-slate-50 text-slate-900"
    >
      <aside className="hidden bg-slate-950 text-white lg:fixed lg:inset-y-0 lg:start-0 lg:block lg:w-64">
        <Link
          href="/affiliates"
          className="flex items-center gap-3 px-6 py-7 text-lg font-bold"
        >
          <span className="rounded-xl bg-emerald-600 p-2">
            <Store size={22} />
          </span>{" "}
          {t("Seller hub")}
        </Link>
        <div className="px-4 pb-4">
          <p className="mb-5 hidden px-3 text-xs text-slate-400 lg:block">
            {t("YOUR WORKSPACE")}
          </p>
          <nav className="flex gap-2 overflow-auto lg:block lg:space-y-2">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                aria-current={tab === id ? "page" : undefined}
                onClick={() => {
                  setTab(id);
                  setNotice("");
                }}
                className={`flex shrink-0 items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium lg:w-full ${tab === id ? "bg-emerald-600 text-white" : "text-slate-400 hover:bg-slate-900 hover:text-white"}`}
              >
                <Icon size={19} />
                {t(String(label))}
                {id === "orders" && cart.length > 0 && (
                  <span className="ms-auto rounded bg-white/20 px-1.5">
                    {cart.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
        <div className="hidden lg:absolute lg:bottom-0 lg:block lg:w-full lg:border-t lg:border-slate-800 lg:p-6">
          <p className="font-semibold">{seller.name}</p>
          <p className="mt-1 text-xs text-slate-400">{t("Approved seller")}</p>
          <button
            onClick={logout}
            className="mt-4 flex items-center gap-2 text-sm text-slate-400"
          >
            <LogOut size={16} />
            {t(" Sign out")}
          </button>
        </div>
      </aside>
      <div className="lg:ms-64">
        <header className="border-b bg-white px-4 py-3 sm:px-6 md:px-10">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <h1 className="min-w-0 truncate text-base font-bold sm:text-xl">
              {t(`Welcome, ${seller.name.split(" ")[0]}`)}
            </h1>
            <div className="flex shrink-0 items-center gap-1">
              <button
                disabled={loading}
                aria-label={t("Refresh")}
                title={t("Refresh")}
                onClick={() => {
                  setError("");
                  void refresh(
                    tab === "products" || choosingProducts || cart.length > 0,
                  );
                }}
                className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-50"
              >
                <RefreshCw
                  size={18}
                  className={loading ? "animate-spin" : ""}
                />
              </button>
              <button
                onClick={logout}
                aria-label={t("Sign out")}
                title={t("Sign out")}
                className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-50"
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>
          <div className="mt-1 flex min-w-0 items-center justify-between gap-2">
            <p className="min-w-0 truncate text-xs text-slate-500">
              {t(tabs.find((item) => item.id === tab)?.label || "Overview")}
            </p>
            <AffiliateLanguageSwitch />
          </div>
        </header>
        <div className="mx-auto max-w-7xl px-4 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 lg:pb-10 md:px-10 md:pt-10">
          {alerts}
          {data.warnings?.map((warning: string) => (
            <p
              key={warning}
              className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"
            >
              {t(String(warning))}
            </p>
          ))}
          {currencies.length > 1 && !editingOrder && (
            <label className="mb-4 flex items-center gap-2 text-sm">
              {t("Analytics currency")}
              <select
                aria-label={t("Analytics currency")}
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="min-h-11 rounded-xl border bg-white px-3"
              >
                {currencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          )}
          {tab === "overview" && (
            <>
              <section className="mb-6 flex flex-wrap items-center justify-between gap-5 rounded-3xl bg-emerald-900 p-5 text-white sm:p-7">
                <div>
                  <p className="text-xs uppercase tracking-[.15em] text-emerald-200">
                    {t("Make your next sale")}
                  </p>
                  <h2 className="mt-2 text-xl font-semibold">
                    {t("Your products. Your price. Your progress.")}
                  </h2>
                  <p className="mt-2 text-sm text-emerald-100">
                    {t(
                      "Explore the Marketplace and turn a customer conversation into an order.",
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => startOrder()}
                    className="flex min-h-11 items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-white"
                  >
                    <Plus size={18} />
                    {t("Create order")}
                  </button>
                  <button
                    onClick={() => setTab("products")}
                    className="flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-emerald-900"
                  >
                    {t("Explore Marketplace ")}
                    <ArrowUpRight size={18} />
                  </button>
                </div>
              </section>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
                {[
                  {
                    label: "Settled sales",
                    value: money(status.sales, currency, language),
                    note: `${status.delivered} delivered orders`,
                  },
                  {
                    label: "Earned profit",
                    value: money(status.profit, currency, language),
                    note: "After product cost and delivery; before marketing expenses",
                  },
                  {
                    label: "Available for payout",
                    value: money(status.available, currency, language),
                    note: `${money(status.reserved, currency, language)} reserved`,
                  },
                  {
                    label: "Total orders",
                    value: status.orders,
                    note: `${money(status.pending_profit, currency, language)} expected profit`,
                  },
                ].map((card) => (
                  <section
                    key={card.label}
                    className="min-w-0 rounded-2xl border bg-white p-4 sm:p-5"
                  >
                    <p className="text-sm text-slate-500">{t(card.label)}</p>
                    <p className="mt-3 break-words text-lg font-bold sm:text-2xl">
                      {card.value}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {t(card.note)}
                    </p>
                  </section>
                ))}
              </div>
              <div className="mt-6 grid gap-6 xl:grid-cols-3">
                <section className="rounded-2xl border bg-white p-6 xl:col-span-2">
                  <h2 className="font-bold">{t("Profit by order date")}</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {t(
                      "Delivered and collected orders placed in the last 14 days \u00B7",
                    )}{" "}
                    {currency}
                  </p>
                  <div
                    className="mt-6 flex h-44 items-end gap-1 sm:gap-2"
                    role="img"
                    aria-label={t(
                      `Last 14 days earned profit: ${trend.map((day) => `${day.date}: ${money(day.total, currency)}`).join(", ")}`,
                    )}
                  >
                    {trend.map((day) => (
                      <div
                        key={day.date}
                        className="flex h-full min-w-0 flex-1 flex-col justify-end items-center gap-2"
                        title={`${day.date}: ${money(day.total, currency)}`}
                      >
                        <div
                          className="w-full rounded-t bg-emerald-600"
                          style={{
                            height: `${Math.max(2, (day.total / maxProfit) * 100)}%`,
                            opacity: day.total ? 1 : 0.15,
                          }}
                        />
                        <span className="text-[9px] text-slate-400">
                          {day.date.slice(8)}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="rounded-2xl border bg-white p-6">
                  <h2 className="font-bold">{t("Order progress")}</h2>
                  <div className="mt-5 space-y-4">
                    {[
                      "pending",
                      "confirmed",
                      "in_transit",
                      "out_for_delivery",
                      "delivered",
                      "returned",
                      "cancelled",
                      "failed",
                    ].map((s) => (
                      <div key={s} className="flex justify-between text-sm">
                        <span className="capitalize text-slate-500">
                          {t(s.replaceAll("_", " "))}
                        </span>
                        <span className="font-semibold">
                          {
                            data.orders.filter(
                              (o: any) =>
                                o.currency === currency && o.status === s,
                            ).length
                          }
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
              <p className="mt-5 text-xs text-slate-500">
                {t("Totals cover your full order history in ")}
                {currency}
                {t(
                  ". Earnings use the product cost saved when the order was submitted. Returned, cancelled, and refunded amounts reduce earnings.",
                )}
              </p>
            </>
          )}
          {tab === "products" && (
            <>
              {catalogWarnings.map((w) => (
                <p
                  key={w}
                  className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"
                >
                  {t(String(w))}
                </p>
              ))}
              {catalogLoading && !products.length ? (
                <p>{t("Loading Marketplace\u2026")}</p>
              ) : (
                <AffiliateMarketplace
                  products={products}
                  mark={markProduct}
                  add={addLine}
                />
              )}
            </>
          )}
          {tab === "orders" && (
            <>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-slate-500">
                  {t("Create an order or reuse a customer from your list.")}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => startOrder()} className={button}>
                    <Plus size={16} />
                    {t("Create order")}
                  </button>
                  <button
                    onClick={() => {
                      setShowCustomers(!showCustomers);
                      setChoosingProducts(false);
                    }}
                    aria-pressed={showCustomers}
                    className={secondary}
                  >
                    {t("Customers (")}
                    {customers.length})
                  </button>
                </div>
              </div>
              {showCustomers ? (
                <AffiliateCustomers
                  customers={customers}
                  useCustomer={startOrder}
                />
              ) : (
                <>
                  {editingOrder && (
                    <AffiliateOrderEditor
                      cart={cart}
                      setCart={setCart}
                      customer={customer}
                      setCustomer={setCustomer}
                      customerId={customerId}
                      customers={customers}
                      clearCustomerId={() => setCustomerId("")}
                      selectCustomer={(saved) => {
                        setCustomerId(saved?.id || "");
                        if (saved)
                          setCustomer({
                            customer_name: saved.customer_name,
                            customer_phone: saved.customer_phone,
                            address: saved.address,
                            city: saved.city,
                            country: "MA",
                            note: "",
                          });
                        else
                          setCustomer({
                            customer_name: "",
                            customer_phone: "",
                            address: "",
                            city: "",
                            country: "MA",
                            note: "",
                          });
                      }}
                      cities={cities}
                      citiesError={citiesError}
                      retryCities={loadCities}
                      busy={busy}
                      addProduct={() => setChoosingProducts(true)}
                      close={() => {
                        setEditingOrder(false);
                        setCart([]);
                      }}
                      submit={submitOrder}
                      deliveryFee={deliveryFee}
                    />
                  )}
                  {choosingProducts && (
                    <AffiliateModal
                      title={t("Choose products")}
                      close={() => setChoosingProducts(false)}
                    >
                      {catalogLoading && !products.length ? (
                        <p>{t("Loading Marketplace\u2026")}</p>
                      ) : (
                        <AffiliateMarketplace
                          products={
                            cart.length
                              ? products.filter(
                                  (p) => p.store === cart[0].product.store,
                                )
                              : products
                          }
                          mark={markProduct}
                          add={addLine}
                          selecting
                        />
                      )}
                      {catalogRefreshing && (
                        <p className="mt-3 text-xs text-slate-500">
                          {t(
                            "More products are loading in the background\u2026",
                          )}
                        </p>
                      )}
                    </AffiliateModal>
                  )}
                  {!editingOrder && (
                    <>
                      <div
                        role="group"
                        aria-label={t("Order groups")}
                        className="mb-4 grid grid-cols-2 gap-2"
                      >
                        {[
                          ["all", "All orders"],
                          ["affiliate_cancelled", "Cancelled by affiliate"],
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            aria-pressed={orderGroup === value}
                            onClick={() => {
                              setOrderGroup(value);
                              setOrderStatus("");
                            }}
                            className={`${secondary} min-w-0 whitespace-normal text-sm ${orderGroup === value ? "border-emerald-600 bg-emerald-50 text-emerald-800" : ""}`}
                          >
                            {t(label)}
                          </button>
                        ))}
                      </div>
                      <div className="mb-5 flex flex-wrap justify-between gap-3">
                        <p className="text-sm text-slate-500">
                          {t(
                            "Live statuses refresh every minute while this page is open.",
                          )}
                        </p>
                        <div className="flex w-full flex-wrap gap-3 sm:w-auto">
                          <select
                            aria-label={t("Filter order status")}
                            value={orderStatus}
                            onChange={(e) => setOrderStatus(e.target.value)}
                            className={`${field} flex-1 sm:w-auto`}
                          >
                            <option value="">{t("All statuses")}</option>
                            {Array.from(
                              new Set(data.orders.map((o: any) => o.status)),
                            ).map((s) => (
                              <option key={String(s)} value={String(s)}>
                                {t(String(s).replaceAll("_", " "))}
                              </option>
                            ))}
                          </select>
                          <button
                            onClick={() => {
                              setEditingOrder(true);
                              setChoosingProducts(true);
                            }}
                            className={button}
                          >
                            <Plus size={16} />
                            {t(" Add products")}
                          </button>
                        </div>
                      </div>
                      <OrderTable orders={orders} open={setSelectedOrder} />
                    </>
                  )}
                </>
              )}
            </>
          )}
          {tab === "payouts" && (
            <>
              <div className="mb-6 grid gap-4 sm:grid-cols-3">
                {[
                  ["Available", status.available],
                  ["In review / approved", status.reserved],
                  ["Paid out", status.paid],
                ].map(([label, amount]) => (
                  <section
                    key={String(label)}
                    className="rounded-2xl border bg-white p-5"
                  >
                    <p className="text-sm text-slate-500">{t(String(label))}</p>
                    <p className="mt-3 text-2xl font-bold">
                      {money(Number(amount), currency, language)}
                    </p>
                  </section>
                ))}
              </div>
              <AffiliatePayoutRequest
                available={Number(status.available)}
                currency={currency}
                requested={() => refresh()}
              />
              <h2 className="mb-3 font-bold">{t("Payout history")}</h2>
              <PayoutTable
                payouts={data.payouts.filter(
                  (p: any) => p.currency === currency,
                )}
              />
            </>
          )}
        </div>
      </div>
      {createdOrder && (
        <AffiliateOrderDetails
          id={createdOrder}
          celebrate
          close={() => setCreatedOrder("")}
        />
      )}
      {selectedOrder && (
        <AffiliateOrderDetails
          id={selectedOrder}
          changed={() => refresh()}
          close={() => setSelectedOrder("")}
        />
      )}
      <nav
        aria-label={t("Seller navigation")}
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-slate-200 bg-white px-2 pt-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] shadow-[0_-4px_20px_rgba(15,23,42,.06)] lg:hidden"
      >
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            aria-label={t(label)}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => {
              setTab(id);
              setNotice("");
            }}
            className={`relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl text-xs font-semibold ${tab === id ? "bg-emerald-50 text-emerald-800" : "text-slate-500 hover:bg-slate-50"}`}
          >
            <Icon size={21} />
            {id === "products"
              ? t("Marketplace")
              : id === "orders"
                ? t("Orders")
                : t(label)}
            {id === "orders" && cart.length > 0 && (
              <span
                className="absolute end-2 top-0 rounded-full bg-emerald-700 px-1.5 text-[10px] text-white"
                aria-label={t(`${cart.length} products in order`)}
              >
                {cart.length}
              </span>
            )}
          </button>
        ))}
      </nav>
    </main>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  const { t, language } = useAffiliateLocale();
  return (
    <div className="rounded-2xl border border-dashed bg-white p-6 text-center sm:p-12">
      <Package className="mx-auto mb-4 text-slate-300" size={34} />
      <h2 className="font-semibold">{t(String(title))}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
        {t(String(text))}
      </p>
    </div>
  );
}
function OrderTable({
  orders,
  open,
}: {
  orders: any[];
  open: (id: string) => void;
}) {
  const { t, language } = useAffiliateLocale();
  return !orders.length ? (
    <Empty
      title={t("No orders yet")}
      text={t(
        "Choose a product from the Marketplace to create a customer order.",
      )}
    />
  ) : (
    <>
      <div className="space-y-3 sm:hidden" aria-label={t("Your orders")}>
        {orders.map((o) => (
          <article
            key={o.id}
            className="min-w-0 rounded-2xl border bg-white p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <button
                  onClick={() => open(o.id)}
                  className="min-h-11 break-words text-start font-bold text-emerald-800"
                  aria-label={t(`View order ${o.name}`)}
                >
                  {o.name}
                </button>
                <p className="mt-1 break-words text-xs text-slate-500">
                  {new Date(o.created_at).toLocaleDateString(language)}
                </p>
              </div>
              <OrderStatus order={o} />
            </div>
            <p className="mt-4 break-words text-sm font-medium">
              {o.customer || "—"}
            </p>
            {o.items?.map((item: any, i: number) => (
              <p key={i} className="mt-1 break-words text-sm text-slate-500">
                {item.quantity} × {item.title}
              </p>
            ))}
            <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-3 text-sm">
              <div className="min-w-0">
                <dt className="text-xs text-slate-500">{t("Sale")}</dt>
                <dd className="mt-1 break-words font-semibold">
                  {money(o.total, o.currency, language)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-slate-500">
                  {t(
                    o.profit_earned ||
                      ["cancelled", "returned", "failed"].includes(o.status)
                      ? "Profit"
                      : "Expected profit",
                  )}
                </dt>
                <dd className="mt-1 break-words text-lg font-bold text-emerald-700">
                  {money(
                    o.profit_earned ? o.profit : o.pending_profit,
                    o.currency,
                    language,
                  )}
                </dd>
              </div>
            </dl>
            <button
              onClick={() => open(o.id)}
              className={`${secondary} mt-3 w-full`}
            >
              {t("View details & receipt")}
            </button>
            <div className="mt-4">
              <AffiliateOrderTracking order={o} compact />
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {t("Updated: ")}
              {t(lastSync(o.synced_at, language))}
            </p>
          </article>
        ))}
      </div>
      <div className="hidden overflow-auto rounded-2xl border bg-white sm:block">
        <table className="w-full whitespace-nowrap text-start text-sm">
          <thead className="border-b bg-slate-50 text-xs text-slate-500">
            <tr>
              {[
                "Order",
                "Customer / products",
                "Delivery status",
                "Sale",
                "Profit",
                "Last update",
              ].map((h) => (
                <th key={h} className="p-4 font-medium">
                  {t(String(h))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b last:border-0">
                <td className="p-4">
                  <button
                    onClick={() => open(o.id)}
                    className="min-h-11 font-semibold text-emerald-800"
                    aria-label={t(`View order ${o.name}`)}
                  >
                    {o.name}
                  </button>
                  <p className="mt-1 text-xs text-slate-500">
                    {new Date(o.created_at).toLocaleDateString(language)}
                  </p>
                </td>
                <td className="p-4">
                  <p>{o.customer || "—"}</p>
                  {o.items?.map((item: any, i: number) => (
                    <p
                      key={i}
                      className="max-w-60 truncate text-xs text-slate-500"
                    >
                      {item.quantity} × {item.title}
                    </p>
                  ))}
                </td>
                <td className="p-4">
                  <OrderStatus order={o} />
                  <div className="mt-2 max-w-72">
                    <AffiliateOrderTracking order={o} compact />
                  </div>
                </td>
                <td className="p-4">{money(o.total, o.currency, language)}</td>
                <td className="p-4 font-bold text-emerald-700">
                  {money(
                    o.profit_earned ? o.profit : o.pending_profit,
                    o.currency,
                    language,
                  )}
                  <p className="mt-1 text-xs font-normal text-slate-500">
                    {t(
                      o.profit_earned ||
                        ["cancelled", "returned", "failed"].includes(o.status)
                        ? "Profit"
                        : "Expected profit",
                    )}
                  </p>
                </td>
                <td className="p-4 text-xs text-slate-500">
                  {t(lastSync(o.synced_at, language))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
function OrderStatus({ order: o }: { order: any }) {
  const { t, language } = useAffiliateLocale();
  return (
    <span
      className={`inline-block max-w-full break-words rounded-full px-3 py-1 text-xs font-semibold ${o.state === "needs_review" ? "bg-red-50 text-red-700" : o.status === "delivered" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700"}`}
    >
      {t(
        o.state === "created"
          ? o.status === "cancelled"
            ? "cancelled"
            : o.delivery_status || o.status.replaceAll("_", " ")
          : o.state.replaceAll("_", " "),
      )}
    </span>
  );
}
function lastSync(value?: string, language = "en") {
  return value
    ? new Date(
        /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : value + "Z",
      ).toLocaleString(language)
    : "Awaiting sync";
}
function PayoutTable({ payouts }: { payouts: any[] }) {
  const { t, language } = useAffiliateLocale();
  return !payouts.length ? (
    <Empty
      title={t("No payout requests")}
      text={t("Your payout requests and transfer references will appear here.")}
    />
  ) : (
    <>
      <div
        className="space-y-3 sm:hidden"
        aria-label={t("Your payout requests")}
      >
        {payouts.map((p) => (
          <article
            key={p.id}
            className="min-w-0 rounded-2xl border bg-white p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="break-words font-bold">
                {money(p.amount, p.currency, language)}
              </h2>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${p.status === "paid" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700"}`}
              >
                {t(p.status)}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {t("Requested ")}
              {new Date(p.created_at).toLocaleDateString(language)}
            </p>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-xs text-slate-500">{t("Destination")}</dt>
                <dd className="mt-1 break-words [overflow-wrap:anywhere]">
                  {p.method === "cash" ? t("Cash") : p.destination}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">
                  {t("Transfer reference")}
                </dt>
                <dd className="mt-1 break-words [overflow-wrap:anywhere]">
                  {p.reference || t("Awaiting transfer")}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
      <div className="hidden overflow-auto rounded-2xl border bg-white sm:block">
        <table className="w-full text-start text-sm">
          <thead className="border-b bg-slate-50 text-xs text-slate-500">
            <tr>
              {[
                "Requested",
                "Amount",
                "Status",
                "Destination",
                "Transfer reference",
              ].map((h) => (
                <th key={h} className="p-4 font-medium">
                  {t(String(h))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {payouts.map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="p-4">
                  {new Date(p.created_at).toLocaleDateString(language)}
                </td>
                <td className="p-4 font-semibold">
                  {money(p.amount, p.currency, language)}
                </td>
                <td className="p-4 capitalize">{t(p.status)}</td>
                <td className="max-w-xs break-words p-4 text-xs">
                  {p.method === "cash" ? t("Cash") : p.destination}
                </td>
                <td className="p-4 text-xs">{p.reference || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
