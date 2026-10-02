"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import AffiliateMarketplace from "@/components/AffiliateMarketplace";
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
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customers, setCustomers] = useState<AffiliateCustomer[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [choosingProducts, setChoosingProducts] = useState(false);
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
  const [payout, setPayout] = useState({ amount: "", destination: "" });
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

  const refresh = useCallback(async (withProducts = false) => {
    if (refreshRunning.current) return;
    refreshRunning.current = true;
    setLoading(true);
    try {
      const current = await affiliateApi("/me");
      setSeller(current);
      if (current.status === "approved") {
        const result = await affiliateApi("/dashboard");
        setData(result);
        setCustomers(await affiliateApi("/customers"));
        if (withProducts) {
          const catalog = await affiliateApi("/products");
          setProducts(catalog.products);
          setCatalogWarnings(catalog.warnings);
          setPricing(catalog.pricing);
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
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
      refreshRunning.current = false;
    }
  }, []);

  useEffect(() => {
    if (!localStorage.getItem("ptos_affiliate_token")) {
      setReady(true);
      return;
    }
    affiliateApi("/me")
      .then((current) => {
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
      void refresh(true);
  }, [tab, choosingProducts, seller?.id, refresh]);
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
    setChoosingProducts(!cart.length);
    setNotice("");
    if (saved) {
      setCustomerId(saved.id);
      setCustomer({
        customer_name: saved.customer_name,
        customer_phone: saved.customer_phone,
        address: saved.address,
        city: saved.city,
        country: saved.country,
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
    setPayout({ amount: "", destination: "" });
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
    setNotice("Product added. Enter customer details to create the order.");
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
      await affiliateApi("/orders", {
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
      setCart([]);
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

  async function requestPayout(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await affiliateApi("/payouts", { ...payout, currency });
      setPayout({ amount: "", destination: "" });
      setNotice("Payout requested. Your administrator will review it.");
      await refresh();
    } catch (err: any) {
      setError(err.message);
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
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="mb-5 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
        >
          <CheckCircle2 size={18} />
          {notice}
        </div>
      )}
    </>
  );
  if (!ready)
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50">
        <Loader2 className="animate-spin text-emerald-700" />
      </main>
    );
  if (!seller)
    return (
      <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-6">
        <div className="mx-auto max-w-5xl">
          <header className="mb-6 flex flex-wrap items-center justify-between gap-3 md:mb-12">
            <Link
              href="/"
              className="flex min-h-11 items-center gap-2 font-bold"
            >
              <Store className="text-emerald-700" /> Seller hub
            </Link>
            <Link
              href="/wholesale"
              className="flex min-h-11 items-center text-sm text-slate-500"
            >
              Wholesale dashboard
            </Link>
          </header>
          <div className="grid gap-10 md:grid-cols-2">
            <section className="order-2 md:order-1 md:pt-8">
              <p className="text-xs font-bold uppercase tracking-[.2em] text-emerald-700">
                Your next business starts here
              </p>
              <h1 className="mt-4 text-3xl font-bold leading-tight sm:text-4xl">
                Find a product.
                <br />
                Make your first sale.
              </h1>
              <p className="mt-5 max-w-md text-slate-600">
                Discover products in the Marketplace. Set your selling price,
                submit customer orders, and follow your earnings from delivery
                to payout.
              </p>
              <div className="mt-8 space-y-4 text-sm text-slate-600">
                {[
                  "Products, sizes and stock in one Marketplace",
                  "Your sale price, your margin",
                  "Delivery tracking and reviewed payouts",
                ].map((text) => (
                  <p key={text} className="flex gap-3">
                    <CheckCircle2 className="text-emerald-700" size={19} />
                    {text}
                  </p>
                ))}
              </div>
            </section>
            <form
              onSubmit={signIn}
              className="order-1 rounded-3xl border bg-white p-5 shadow-sm sm:p-7 md:order-2"
            >
              <h2 className="text-xl font-bold">
                {apply ? "Apply to become a seller" : "Welcome back"}
              </h2>
              <p className="mb-6 mt-2 text-sm text-slate-500">
                {apply
                  ? "Access is granted after an administrator reviews your application."
                  : "Sign in to your seller workspace."}
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
                  {key}
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
                  ? "Please wait…"
                  : apply
                    ? "Submit application"
                    : "Sign in"}
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
                  ? "Already registered? Sign in"
                  : "New here? Apply to sell"}
              </button>
            </form>
          </div>
        </div>
      </main>
    );
  if (seller.status !== "approved")
    return (
      <main className="grid min-h-screen place-items-center bg-slate-50 p-6">
        <section className="max-w-lg rounded-3xl border bg-white p-8 text-center">
          <Store className="mx-auto mb-5 text-emerald-700" size={36} />
          <h1 className="text-2xl font-bold">
            {seller.status === "pending"
              ? "Your application is under review"
              : `Account ${seller.status}`}
          </h1>
          <p className="my-4 text-sm text-slate-600">
            {seller.name}, an administrator must approve your account and vendor
            access before you can browse products or submit orders.
          </p>
          {alerts}
          <div className="flex flex-wrap justify-center gap-3">
            <button
              disabled={loading}
              onClick={() => refresh(true)}
              className={button}
            >
              Check status
            </button>
            <button onClick={logout} className={secondary}>
              Sign out
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
      o.currency === currency && (!orderStatus || o.status === orderStatus),
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
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <aside className="hidden bg-slate-950 text-white lg:fixed lg:inset-y-0 lg:left-0 lg:block lg:w-64">
        <Link
          href="/affiliates"
          className="flex items-center gap-3 px-6 py-7 text-lg font-bold"
        >
          <span className="rounded-xl bg-emerald-600 p-2">
            <Store size={22} />
          </span>{" "}
          Seller hub
        </Link>
        <div className="px-4 pb-4">
          <p className="mb-5 hidden px-3 text-xs text-slate-400 lg:block">
            YOUR WORKSPACE
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
                {label}
                {id === "orders" && cart.length > 0 && (
                  <span className="ml-auto rounded bg-white/20 px-1.5">
                    {cart.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
        <div className="hidden lg:absolute lg:bottom-0 lg:block lg:w-full lg:border-t lg:border-slate-800 lg:p-6">
          <p className="font-semibold">{seller.name}</p>
          <p className="mt-1 text-xs text-slate-400">Approved seller</p>
          <button
            onClick={logout}
            className="mt-4 flex items-center gap-2 text-sm text-slate-400"
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>
      <div className="lg:ml-64">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-white px-4 py-4 sm:px-6 md:px-10">
          <div className="min-w-0">
            <p className="text-xs text-slate-500">
              Seller workspace / {tabs.find((t) => t.id === tab)?.label}
            </p>
            <h1 className="mt-1 break-words text-xl font-bold sm:text-2xl">
              {tab === "overview"
                ? `Welcome, ${seller.name.split(" ")[0]}`
                : tabs.find((t) => t.id === tab)?.label}
            </h1>
          </div>
          <div className="flex max-w-full gap-2">
            <select
              aria-label="Analytics currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="min-h-11 min-w-0 rounded-xl border px-3 text-base md:text-sm"
            >
              {currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <button
              disabled={loading}
              onClick={() => {
                setError("");
                void refresh(
                  tab === "products" || choosingProducts || cart.length > 0,
                );
              }}
              className={secondary}
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              Refresh
            </button>
            <button
              onClick={logout}
              className="rounded-xl border p-3 lg:hidden"
              aria-label="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>
        <div className="mx-auto max-w-7xl px-4 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 lg:pb-10 md:px-10 md:pt-10">
          {alerts}
          {data.warnings?.map((warning: string) => (
            <p
              key={warning}
              className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"
            >
              {warning}
            </p>
          ))}
          {tab === "overview" && (
            <>
              <section className="mb-6 flex flex-wrap items-center justify-between gap-5 rounded-3xl bg-emerald-900 p-5 text-white sm:p-7">
                <div>
                  <p className="text-xs uppercase tracking-[.15em] text-emerald-200">
                    Make your next sale
                  </p>
                  <h2 className="mt-2 text-xl font-semibold">
                    Your products. Your price. Your progress.
                  </h2>
                  <p className="mt-2 text-sm text-emerald-100">
                    Explore the Marketplace and turn a customer conversation
                    into an order.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => startOrder()}
                    className="flex min-h-11 items-center gap-2 rounded-xl bg-emerald-500 px-5 py-3 text-sm font-semibold text-white"
                  >
                    <Plus size={18} />
                    Create order
                  </button>
                  <button
                    onClick={() => setTab("products")}
                    className="flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-emerald-900"
                  >
                    Explore Marketplace <ArrowUpRight size={18} />
                  </button>
                </div>
              </section>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
                {[
                  {
                    label: "Settled sales",
                    value: money(status.sales, currency),
                    note: `${status.delivered} delivered orders`,
                  },
                  {
                    label: "Earned profit",
                    value: money(status.profit, currency),
                    note: "After product cost and delivery; before marketing expenses",
                  },
                  {
                    label: "Available for payout",
                    value: money(status.available, currency),
                    note: `${money(status.reserved, currency)} reserved`,
                  },
                  {
                    label: "Total orders",
                    value: status.orders,
                    note: `${money(status.pending_profit, currency)} expected profit`,
                  },
                ].map((card) => (
                  <section
                    key={card.label}
                    className="min-w-0 rounded-2xl border bg-white p-4 sm:p-5"
                  >
                    <p className="text-sm text-slate-500">{card.label}</p>
                    <p className="mt-3 break-words text-lg font-bold sm:text-2xl">
                      {card.value}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">{card.note}</p>
                  </section>
                ))}
              </div>
              <div className="mt-6 grid gap-6 xl:grid-cols-3">
                <section className="rounded-2xl border bg-white p-6 xl:col-span-2">
                  <h2 className="font-bold">Profit by order date</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Delivered and collected orders placed in the last 14 days ·{" "}
                    {currency}
                  </p>
                  <div
                    className="mt-6 flex h-44 items-end gap-1 sm:gap-2"
                    role="img"
                    aria-label={`Last 14 days earned profit: ${trend.map((day) => `${day.date}: ${money(day.total, currency)}`).join(", ")}`}
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
                  <h2 className="font-bold">Order progress</h2>
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
                          {s.replaceAll("_", " ")}
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
                Totals cover your full order history in {currency}. Earnings use
                the product cost saved when the order was submitted. Returned,
                cancelled, and refunded amounts reduce earnings.
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
                  {w}
                </p>
              ))}
              {loading && !products.length ? (
                <p>Loading Marketplace…</p>
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
                  Create an order or reuse a customer from your list.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => startOrder()} className={button}>
                    <Plus size={16} />
                    Create order
                  </button>
                  <button
                    onClick={() => {
                      setShowCustomers(!showCustomers);
                      setChoosingProducts(false);
                    }}
                    aria-pressed={showCustomers}
                    className={secondary}
                  >
                    Customers ({customers.length})
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
                  {choosingProducts && (
                    <section className="mb-6 rounded-2xl border bg-white p-3 sm:p-4">
                      <div className="mb-3 flex flex-wrap justify-between gap-2">
                        <h2 className="font-bold">
                          Choose products for your order
                        </h2>
                        <button
                          onClick={() => setChoosingProducts(false)}
                          className={secondary}
                        >
                          Back to orders
                        </button>
                      </div>
                      <AffiliateMarketplace
                        products={products}
                        mark={markProduct}
                        add={addLine}
                        selecting
                      />
                    </section>
                  )}
                  {cart.length > 0 && (
                    <form
                      onSubmit={submitOrder}
                      className="mb-7 rounded-2xl border bg-white p-4 sm:p-6"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="min-w-0 break-words text-lg font-bold">
                          Create customer order
                        </h2>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setCart([])}
                          aria-label="Clear order"
                          className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl hover:bg-slate-50"
                        >
                          <X size={18} />
                        </button>
                      </div>
                      <div className="my-5 space-y-3">
                        {cart.map((line, i) => (
                          <div
                            key={`${line.product.id}:${line.variant.id}`}
                            className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 p-4"
                          >
                            <div className="min-w-0 basis-full sm:min-w-48 sm:flex-1">
                              <p className="text-sm font-semibold">
                                {line.product.title}
                              </p>
                              <p className="text-xs text-slate-500">
                                {line.variant.title} · Cost{" "}
                                {money(
                                  line.variant.unit_cost || 0,
                                  line.product.currency,
                                )}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                Recommended selling price{" "}
                                {money(
                                  line.variant.price,
                                  line.product.currency,
                                )}
                              </p>
                            </div>
                            <label className="text-xs">
                              Quantity
                              <input
                                disabled={busy}
                                type="number"
                                inputMode="numeric"
                                min="1"
                                max={Math.min(
                                  100,
                                  line.variant.inventory_quantity ?? 100,
                                )}
                                required
                                value={line.quantity}
                                onChange={(e) =>
                                  setCart(
                                    cart.map((l, j) =>
                                      j === i
                                        ? {
                                            ...l,
                                            quantity: Number(e.target.value),
                                          }
                                        : l,
                                    ),
                                  )
                                }
                                className={`${field} mt-1 max-w-24`}
                              />
                            </label>
                            <label className="text-xs">
                              Sale price ({line.product.currency})
                              <input
                                disabled={busy}
                                required
                                type="number"
                                inputMode="decimal"
                                step="0.01"
                                min={Number(line.variant.unit_cost) + 0.01}
                                value={line.sale_price}
                                onChange={(e) =>
                                  setCart(
                                    cart.map((l, j) =>
                                      j === i
                                        ? { ...l, sale_price: e.target.value }
                                        : l,
                                    ),
                                  )
                                }
                                className={`${field} mt-1 max-w-32`}
                              />
                            </label>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                setCart(cart.filter((_, j) => j !== i))
                              }
                              aria-label={`Remove ${line.product.title}`}
                              className="flex min-h-11 min-w-11 items-center justify-center rounded-xl hover:bg-slate-200"
                            >
                              <X size={17} />
                            </button>
                          </div>
                        ))}
                      </div>
                      <label className="mb-4 block text-sm font-medium">
                        Saved customer
                        <select
                          aria-label="Use saved customer"
                          value={customerId}
                          onChange={(e) => {
                            const saved = customers.find(
                              (c) => c.id === e.target.value,
                            );
                            if (saved) startOrder(saved);
                            else setCustomerId("");
                          }}
                          className={`${field} mt-1`}
                        >
                          <option value="">New customer</option>
                          {customers.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.customer_name} · {c.customer_phone}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="grid gap-4 sm:grid-cols-2">
                        {(
                          [
                            "customer_name",
                            "customer_phone",
                            "address",
                            "city",
                          ] as const
                        ).map((key) => (
                          <label
                            key={key}
                            className="text-sm font-medium capitalize"
                          >
                            {key.replace("customer_", "").replaceAll("_", " ")}
                            <input
                              disabled={busy}
                              required
                              type={key === "customer_phone" ? "tel" : "text"}
                              autoComplete={
                                {
                                  customer_name: "name",
                                  customer_phone: "tel",
                                  address: "street-address",
                                  city: "address-level2",
                                }[key]
                              }
                              value={customer[key]}
                              onChange={(e) => {
                                setCustomer({
                                  ...customer,
                                  [key]: e.target.value,
                                });
                                if (key === "customer_phone") setCustomerId("");
                              }}
                              className={`${field} mt-1`}
                            />
                          </label>
                        ))}
                        <label className="text-sm font-medium">
                          Country code
                          <input
                            disabled={busy}
                            pattern="[A-Z]{2}"
                            maxLength={2}
                            autoComplete="country"
                            required
                            value={customer.country}
                            onChange={(e) =>
                              setCustomer({
                                ...customer,
                                country: e.target.value.toUpperCase(),
                              })
                            }
                            className={`${field} mt-1`}
                          />
                        </label>
                        <label className="text-sm font-medium">
                          Order note
                          <input
                            disabled={busy}
                            value={customer.note}
                            onChange={(e) =>
                              setCustomer({ ...customer, note: e.target.value })
                            }
                            className={`${field} mt-1`}
                          />
                        </label>
                      </div>
                      <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
                        <div>
                          <p className="font-bold">
                            Order total{" "}
                            {money(
                              cart.reduce(
                                (sum, l) =>
                                  sum + Number(l.sale_price) * l.quantity,
                                0,
                              ),
                              cart[0].product.currency,
                            )}
                          </p>
                          <p className="mt-1 text-sm text-slate-500">
                            Product costs{" "}
                            {money(
                              cart.reduce(
                                (sum, l) =>
                                  sum +
                                  Number(l.variant.unit_cost) * l.quantity,
                                0,
                              ),
                              cartCurrency,
                            )}
                          </p>
                          <p className="text-sm text-slate-500">
                            Delivery deducted{" "}
                            {Number.isFinite(deliveryFee)
                              ? money(deliveryFee, cartCurrency)
                              : "not configured"}
                          </p>
                          <p className="mt-1 text-sm text-emerald-700">
                            Expected profit{" "}
                            {money(
                              Math.max(0, grossMargin - (deliveryFee || 0)),
                              cart[0].product.currency,
                            )}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            Available for payout after delivery and collection.
                          </p>
                          {(!Number.isFinite(deliveryFee) ||
                            grossMargin <= deliveryFee) && (
                            <p className="mt-2 text-xs text-amber-800">
                              {Number.isFinite(deliveryFee)
                                ? "Increase the selling price or quantity to cover the delivery fee."
                                : "Ask your administrator to configure this currency’s delivery fee."}
                            </p>
                          )}
                        </div>
                        <button
                          disabled={
                            busy ||
                            !Number.isFinite(deliveryFee) ||
                            grossMargin <= deliveryFee ||
                            cart.some(
                              (line) =>
                                !line.variant.available ||
                                (line.variant.inventory_quantity !== null &&
                                  line.quantity >
                                    line.variant.inventory_quantity),
                            )
                          }
                          className={`${button} w-full sm:w-auto`}
                        >
                          {busy ? "Submitting…" : "Submit order"}
                        </button>
                      </div>
                    </form>
                  )}
                  <div className="mb-5 flex flex-wrap justify-between gap-3">
                    <p className="text-sm text-slate-500">
                      Live statuses refresh every minute while this page is
                      open.
                    </p>
                    <div className="flex w-full flex-wrap gap-3 sm:w-auto">
                      <select
                        aria-label="Filter order status"
                        value={orderStatus}
                        onChange={(e) => setOrderStatus(e.target.value)}
                        className={`${field} flex-1 sm:w-auto`}
                      >
                        <option value="">All statuses</option>
                        {Array.from(
                          new Set(data.orders.map((o: any) => o.status)),
                        ).map((s) => (
                          <option key={String(s)} value={String(s)}>
                            {String(s).replaceAll("_", " ")}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => setChoosingProducts(true)}
                        className={button}
                      >
                        <Plus size={16} /> Add products
                      </button>
                    </div>
                  </div>
                  <OrderTable orders={orders} />
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
                    <p className="text-sm text-slate-500">{label}</p>
                    <p className="mt-3 text-2xl font-bold">
                      {money(Number(amount), currency)}
                    </p>
                  </section>
                ))}
              </div>
              <form
                onSubmit={requestPayout}
                className="mb-6 rounded-2xl border bg-white p-4 sm:p-6"
              >
                <h2 className="font-bold">Request a payout</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Available earnings come from delivered, collected orders.
                  Approval reserves the amount; paid payouts include an
                  administrator's transfer reference.
                </p>
                <div className="mt-5 grid items-end gap-4 md:grid-cols-[1fr_2fr_auto]">
                  <label className="text-sm">
                    Amount ({currency})
                    <input
                      required
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      max={Math.max(0, status.available)}
                      step="0.01"
                      value={payout.amount}
                      onChange={(e) =>
                        setPayout({ ...payout, amount: e.target.value })
                      }
                      className={`${field} mt-1`}
                    />
                  </label>
                  <label className="text-sm">
                    Bank account / payout details
                    <input
                      required
                      minLength={5}
                      value={payout.destination}
                      onChange={(e) =>
                        setPayout({ ...payout, destination: e.target.value })
                      }
                      className={`${field} mt-1`}
                    />
                  </label>
                  <button
                    disabled={busy || status.available <= 0}
                    className={button}
                  >
                    Request payout
                  </button>
                </div>
              </form>
              <PayoutTable
                payouts={data.payouts.filter(
                  (p: any) => p.currency === currency,
                )}
              />
            </>
          )}
        </div>
      </div>
      <nav
        aria-label="Seller navigation"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-slate-200 bg-white px-2 pt-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] shadow-[0_-4px_20px_rgba(15,23,42,.06)] lg:hidden"
      >
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            aria-label={label}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => {
              setTab(id);
              setNotice("");
            }}
            className={`relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl text-xs font-semibold ${tab === id ? "bg-emerald-50 text-emerald-800" : "text-slate-500 hover:bg-slate-50"}`}
          >
            <Icon size={21} />
            {id === "products"
              ? "Marketplace"
              : id === "orders"
                ? "Orders"
                : label}
            {id === "orders" && cart.length > 0 && (
              <span
                className="absolute right-2 top-0 rounded-full bg-emerald-700 px-1.5 text-[10px] text-white"
                aria-label={`${cart.length} products in order`}
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
  return (
    <div className="rounded-2xl border border-dashed bg-white p-6 text-center sm:p-12">
      <Package className="mx-auto mb-4 text-slate-300" size={34} />
      <h2 className="font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">{text}</p>
    </div>
  );
}
function OrderTable({ orders }: { orders: any[] }) {
  return !orders.length ? (
    <Empty
      title="No orders yet"
      text="Choose a product from the Marketplace to create a customer order."
    />
  ) : (
    <>
      <div className="space-y-3 sm:hidden" aria-label="Your orders">
        {orders.map((o) => (
          <article
            key={o.id}
            className="min-w-0 rounded-2xl border bg-white p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="break-words font-bold">{o.name}</h2>
                <p className="mt-1 break-words text-xs text-slate-500">
                  {new Date(o.created_at).toLocaleDateString()}
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
                <dt className="text-xs text-slate-500">Sale</dt>
                <dd className="mt-1 break-words font-semibold">
                  {money(o.total, o.currency)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-xs text-slate-500">Earned profit</dt>
                <dd className="mt-1 break-words font-semibold text-emerald-700">
                  {money(o.profit, o.currency)}
                </dd>
                {o.pending_profit > 0 && (
                  <dd className="mt-1 break-words text-xs text-slate-500">
                    {money(o.pending_profit, o.currency)} expected
                  </dd>
                )}
              </div>
            </dl>
            <p className="mt-4 break-words text-xs text-slate-500">
              {o.status_source === "delivery_app" ? "Delivery app" : "Shopify"}
              {o.tracking_number ? ` · ${o.tracking_number}` : ""}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Updated: {lastSync(o.synced_at)}
            </p>
          </article>
        ))}
      </div>
      <div className="hidden overflow-auto rounded-2xl border bg-white sm:block">
        <table className="w-full whitespace-nowrap text-left text-sm">
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
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b last:border-0">
                <td className="p-4">
                  <p className="font-semibold">{o.name}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {new Date(o.created_at).toLocaleDateString()}
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
                  <p className="mt-2 text-xs text-slate-500">
                    {o.status_source === "delivery_app"
                      ? "Delivery app"
                      : "Shopify"}
                    {o.tracking_number ? ` · ${o.tracking_number}` : ""}
                  </p>
                </td>
                <td className="p-4">{money(o.total, o.currency)}</td>
                <td className="p-4 font-semibold text-emerald-700">
                  {money(o.profit, o.currency)}
                  {o.pending_profit > 0 && (
                    <p className="mt-1 text-xs font-normal text-slate-400">
                      {money(o.pending_profit, o.currency)} expected
                    </p>
                  )}
                </td>
                <td className="p-4 text-xs text-slate-500">
                  {lastSync(o.synced_at)}
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
  return (
    <span
      className={`inline-block max-w-full break-words rounded-full px-3 py-1 text-xs font-semibold ${o.state === "needs_review" ? "bg-red-50 text-red-700" : o.status === "delivered" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700"}`}
    >
      {o.state === "created"
        ? o.delivery_status || o.status.replaceAll("_", " ")
        : o.state.replaceAll("_", " ")}
    </span>
  );
}
function lastSync(value?: string) {
  return value
    ? new Date(
        /[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : value + "Z",
      ).toLocaleString()
    : "Awaiting sync";
}
function PayoutTable({ payouts }: { payouts: any[] }) {
  return !payouts.length ? (
    <Empty
      title="No payout requests"
      text="Your payout requests and transfer references will appear here."
    />
  ) : (
    <>
      <div className="space-y-3 sm:hidden" aria-label="Your payout requests">
        {payouts.map((p) => (
          <article
            key={p.id}
            className="min-w-0 rounded-2xl border bg-white p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="break-words font-bold">
                {money(p.amount, p.currency)}
              </h2>
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${p.status === "paid" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-700"}`}
              >
                {p.status}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Requested {new Date(p.created_at).toLocaleDateString()}
            </p>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-xs text-slate-500">Destination</dt>
                <dd className="mt-1 break-words [overflow-wrap:anywhere]">
                  {p.destination}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Transfer reference</dt>
                <dd className="mt-1 break-words [overflow-wrap:anywhere]">
                  {p.reference || "Awaiting transfer"}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
      <div className="hidden overflow-auto rounded-2xl border bg-white sm:block">
        <table className="w-full text-left text-sm">
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
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {payouts.map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="p-4">
                  {new Date(p.created_at).toLocaleDateString()}
                </td>
                <td className="p-4 font-semibold">
                  {money(p.amount, p.currency)}
                </td>
                <td className="p-4 capitalize">{p.status}</td>
                <td className="max-w-xs break-words p-4 text-xs">
                  {p.destination}
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
