"use client";
import { useAffiliateLocale } from "@/lib/affiliate-locale";
import { useEffect, useState } from "react";
import AffiliateModal from "@/components/AffiliateModal";
import { Bookmark, Package, Search } from "lucide-react";
import {
  AffiliateProduct,
  Variant,
  button,
  field,
  money,
  secondary,
  productImage,
} from "@/lib/affiliates";
export const productTypes: Record<string, string> = {
  men: "Men",
  women: "Women",
  kids: "Kids",
  boys: "Boys",
  girls: "Girls",
  unisex_kids: "Unisex kids",
  unisex_adult: "Unisex adult",
  other: "Other",
};
function colorPaint(value: string) {
  const colors: Record<string, string> = {
    black: "#1e293b",
    noir: "#1e293b",
    white: "#ffffff",
    blanc: "#ffffff",
    red: "#dc2626",
    rouge: "#dc2626",
    blue: "#2563eb",
    bleu: "#2563eb",
    navy: "#172554",
    marine: "#172554",
    green: "#16a34a",
    vert: "#16a34a",
    pink: "#ec4899",
    rose: "#ec4899",
    yellow: "#facc15",
    jaune: "#facc15",
    beige: "#d6c4a2",
    sand: "#d6c4a2",
    grey: "#94a3b8",
    gray: "#94a3b8",
    gris: "#94a3b8",
    brown: "#92400e",
    marron: "#92400e",
    orange: "#f97316",
    purple: "#9333ea",
    violet: "#9333ea",
  };
  return colors[value.toLowerCase().trim()];
}
function ColorDot({
  color,
  available = true,
}: {
  color: string;
  available?: boolean;
}) {
  const paint = colorPaint(color);
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-300 text-[8px] ${available ? "" : "opacity-30"}`}
      style={{ backgroundColor: paint || "#f1f5f9" }}
    >
      {!paint && color.slice(0, 2)}
      {!available && (
        <span className="absolute h-px w-7 rotate-45 bg-slate-700" />
      )}
    </span>
  );
}
function minimumPrice(product: AffiliateProduct) {
  const prices = product.variants
    .map((v) => Number(v.price))
    .filter((p) => p > 0);
  return prices.length ? Math.min(...prices) : 0;
}
export default function AffiliateMarketplace({
  products,
  mark,
  add,
  selecting = false,
}: {
  products: AffiliateProduct[];
  mark: (product: AffiliateProduct) => Promise<void>;
  add: (product: AffiliateProduct, variant: string, price: string) => void;
  selecting?: boolean;
}) {
  const { t, language } = useAffiliateLocale();
  const [search, setSearch] = useState("");
  const [size, setSize] = useState("");
  const [category, setCategory] = useState("");
  const [marked, setMarked] = useState(false);
  const [sort, setSort] = useState(selecting ? "marked_first" : "newest");
  const [opened, setOpened] = useState("");
  const [marking, setMarking] = useState("");
  const [limit, setLimit] = useState(40);
  useEffect(() => setLimit(40), [search, size, category, marked, sort]);
  const sizes = Array.from(
    new Set(
      products
        .flatMap((p) =>
          p.variants.filter((v) => v.available).map((v) => v.size),
        )
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const shown = products
    .filter(
      (p) =>
        (!category || p.category === category) &&
        (!marked || p.marked) &&
        (!size || p.variants.some((v) => v.size === size && v.available)) &&
        p.title.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => {
      if (sort === "marked_first" && !!a.marked !== !!b.marked)
        return Number(!!b.marked) - Number(!!a.marked);
      if (sort === "quantity")
        return b.inventory_quantity - a.inventory_quantity;
      if (sort === "price_low")
        return (
          a.currency.localeCompare(b.currency) ||
          minimumPrice(a) - minimumPrice(b)
        );
      if (sort === "price_high")
        return (
          a.currency.localeCompare(b.currency) ||
          minimumPrice(b) - minimumPrice(a)
        );
      return (
        b.created_at.localeCompare(a.created_at) ||
        b.id.localeCompare(a.id, undefined, { numeric: true })
      );
    });
  const openedProduct = products.find((p) => `${p.store}:${p.id}` === opened);
  async function toggleMark(product: AffiliateProduct) {
    setMarking(`${product.store}:${product.id}`);
    try {
      await mark(product);
    } finally {
      setMarking("");
    }
  }
  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="relative col-span-2">
          <Search
            size={18}
            className="absolute start-3 top-3.5 text-slate-400"
          />
          <input
            aria-label={t("Search Marketplace")}
            placeholder={t("Search products")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${field} ps-10`}
          />
        </div>
        <select
          aria-label={t("Filter product type")}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={field}
        >
          <option value="">{t("All types")}</option>
          {Object.entries(productTypes).map(([id, label]) => (
            <option key={id} value={id}>
              {t(String(label))}
            </option>
          ))}
        </select>
        <select
          aria-label={t("Filter size")}
          value={size}
          onChange={(e) => setSize(e.target.value)}
          className={field}
        >
          <option value="">{t("All sizes")}</option>
          {sizes.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <button
          aria-pressed={marked}
          onClick={() => setMarked(!marked)}
          className={`${marked ? button : secondary} min-w-0 px-2 text-xs`}
        >
          <Bookmark size={15} fill={marked ? "currentColor" : "none"} />
          {t("Marked (")}
          {products.filter((p) => p.marked).length})
        </button>
        <select
          aria-label={t("Sort Marketplace")}
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className={`${field} px-2`}
        >
          {selecting && (
            <option value="marked_first">{t("Marked first")}</option>
          )}
          <option value="newest">{t("New to old")}</option>
          <option value="quantity">{t("Most stock first")}</option>
          <option value="price_low">{t("Price: low to high")}</option>
          <option value="price_high">{t("Price: high to low")}</option>
        </select>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        {shown.length}
        {t(" products \u00B7")}{" "}
        {selecting
          ? t("Choose a product and its size to build your order.")
          : t("Tap a product for photos, details and sizes.")}
      </p>
      {!shown.length ? (
        <div className="rounded-xl border border-dashed bg-white p-6 text-center text-sm text-slate-500">
          {t("No products match these filters.")}
        </div>
      ) : (
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
          aria-label={t("Marketplace products")}
        >
          {shown.slice(0, limit).map((product) => {
            const key = `${product.store}:${product.id}`;
            const colors = Array.from(
              new Set(product.variants.map((v) => v.color).filter(Boolean)),
            );
            const sizes = Array.from(
              new Set(product.variants.map((v) => v.size).filter(Boolean)),
            );
            const cost = Math.min(
              ...product.variants
                .filter((v) => v.unit_cost !== null)
                .map((v) => Number(v.unit_cost)),
            );
            return (
              <article
                key={key}
                className="min-w-0 overflow-hidden rounded-xl border bg-white"
                aria-label={product.title}
              >
                <div className="relative">
                  <button
                    onClick={() => setOpened(key)}
                    aria-label={t(`View ${product.title}`)}
                    className="relative flex aspect-square w-full items-center justify-center overflow-hidden bg-slate-100"
                    title={product.title}
                  >
                    {product.image ? (
                      <img
                        src={productImage(product.image)}
                        alt={product.title}
                        className="absolute inset-0 h-full w-full max-w-full object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <Package size={34} className="text-slate-300" />
                    )}
                  </button>
                  <button
                    aria-label={t(
                      `${product.marked ? "Unmark" : "Mark"} ${product.title}`,
                    )}
                    aria-pressed={!!product.marked}
                    disabled={!!marking}
                    onClick={() => void toggleMark(product)}
                    className="absolute end-0 top-0 flex h-11 w-11 items-center justify-center rounded-es-xl bg-white/95 text-emerald-800 disabled:opacity-40"
                  >
                    <Bookmark
                      size={18}
                      fill={product.marked ? "currentColor" : "none"}
                    />
                  </button>
                </div>
                <div className="space-y-1.5 p-2">
                  {!!colors.length && (
                    <div
                      className="flex flex-wrap gap-1"
                      aria-label={t(`Colors for ${product.title}`)}
                    >
                      {colors.slice(0, 7).map((color) => {
                        const available = product.variants.some(
                          (v) => v.color === color && v.available,
                        );
                        return (
                          <span
                            key={color}
                            title={`${t(color)}${available ? "" : ` — ${t("Out of stock")}`}`}
                            aria-label={`${t(color)}${available ? "" : ` — ${t("Out of stock")}`}`}
                          >
                            <ColorDot color={color} available={available} />
                          </span>
                        );
                      })}
                      {colors.length > 7 && (
                        <span className="text-[10px] text-slate-500">
                          +{colors.length - 7}
                        </span>
                      )}
                    </div>
                  )}
                  {!!sizes.length && (
                    <div
                      className="flex flex-wrap gap-1"
                      aria-label={t(`Sizes for ${product.title}`)}
                    >
                      {sizes.slice(0, 8).map((s) => {
                        const available = product.variants.some(
                          (v) => v.size === s && v.available,
                        );
                        return (
                          <span
                            key={s}
                            title={`${s}${available ? "" : ` — ${t("Out of stock")}`}`}
                            className={`rounded border px-1.5 py-0.5 text-[10px] ${available ? "border-slate-200 text-slate-700" : "border-slate-100 text-slate-300 line-through"}`}
                          >
                            {s}
                          </span>
                        );
                      })}
                      {sizes.length > 8 && (
                        <span className="text-[10px] text-slate-500">
                          +{sizes.length - 8}
                        </span>
                      )}
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] text-slate-500">
                      {t("Recommended selling price")}
                    </p>
                    <p className="break-words text-sm font-bold">
                      {money(minimumPrice(product), product.currency, language)}
                    </p>
                  </div>
                  <p className="break-words text-[11px] text-emerald-800">
                    {t("Your cost")}{" "}
                    {Number.isFinite(cost)
                      ? money(cost, product.currency, language)
                      : t("unavailable")}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {product.inventory_tracked
                      ? t(`${product.inventory_quantity} available`)
                      : t("Stock available")}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {shown.length > limit && (
        <button
          onClick={() => setLimit(limit + 40)}
          className={`${secondary} mt-4 w-full`}
        >
          {t("Show more products (")}
          {shown.length - limit}
          {t(" remaining)")}
        </button>
      )}
      {openedProduct && (
        <ProductDetails
          key={opened}
          product={openedProduct}
          selecting={selecting}
          close={() => setOpened("")}
          add={(variant, price) => {
            add(openedProduct, variant, price);
            setOpened("");
          }}
        />
      )}
    </>
  );
}
function ProductDetails({
  product,
  close,
  add,
  selecting = false,
}: {
  product: AffiliateProduct;
  close: () => void;
  add: (variant: string, price: string) => void;
  selecting?: boolean;
}) {
  const { t, language } = useAffiliateLocale();
  const first =
    product.variants.find((v) => v.available) || product.variants[0];
  const [variantId, setVariantId] = useState(first?.id || "");
  const [price, setPrice] = useState(first?.price || "");
  const [image, setImage] = useState(first?.image || product.image);
  const variant = product.variants.find((v) => v.id === variantId);
  const colors = Array.from(
    new Set(product.variants.map((v) => v.color).filter(Boolean)),
  );
  const sizes = Array.from(
    new Set(product.variants.map((v) => v.size).filter(Boolean)),
  );
  function select(v: Variant | undefined) {
    if (v) {
      setVariantId(v.id);
      setPrice(v.price);
      setImage(v.image || product.image);
    }
  }
  const choices = product.variants.filter(
    (v) => v.color === variant?.color && v.size === variant?.size,
  );
  return (
    <AffiliateModal title={t("Product details")} close={close}>
      {selecting && (
        <button onClick={close} className={`${secondary} mb-4`}>
          {t("Back to products")}
        </button>
      )}
      <div className="grid min-w-0 gap-5 sm:grid-cols-2">
        <div className="min-w-0">
          <div className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl bg-slate-100">
            {image ? (
              <img
                src={productImage(image, 800)}
                alt={product.title}
                className="absolute inset-0 h-full w-full max-w-full object-contain"
              />
            ) : (
              <Package size={45} className="text-slate-300" />
            )}
          </div>
          {product.images.length > 1 && (
            <div className="mt-2 flex gap-2 overflow-auto">
              {product.images.map((src, i) => (
                <button
                  key={src}
                  onClick={() => setImage(src)}
                  aria-label={t(`Product image ${i + 1}`)}
                  aria-pressed={image === src}
                  className={`h-14 w-14 shrink-0 overflow-hidden rounded-lg border-2 ${image === src ? "border-emerald-700" : "border-transparent"}`}
                >
                  <img
                    src={productImage(src, 120)}
                    alt=""
                    className="h-full w-full object-contain"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="text-xs text-slate-500">
            {t(productTypes[product.category] || "Product")}
          </p>
          <h2
            id="product-details-title"
            className="mt-1 break-words text-xl font-bold"
          >
            {product.title}
          </h2>
          <p className="mt-4 text-xs text-slate-500">
            {t("Recommended selling price")}
          </p>
          <p className="text-2xl font-bold">
            {money(variant?.price || 0, product.currency, language)}
          </p>
          <p className="mt-1 text-sm text-emerald-800">
            {t("Your cost ")}
            {money(variant?.unit_cost || 0, product.currency, language)} ·{" "}
            {product.discount_percent}
            {t("% off")}
          </p>
          {!!colors.length && (
            <fieldset className="mt-5">
              <legend className="text-sm font-semibold">
                {t("Color ")}
                {variant?.color && `· ${variant.color}`}
              </legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {colors.map((color) => {
                  const variants = product.variants.filter(
                    (v) => v.color === color && v.available,
                  );
                  return (
                    <button
                      key={color}
                      disabled={!variants.length}
                      onClick={() =>
                        select(
                          variants.find((v) => v.size === variant?.size) ||
                            variants[0],
                        )
                      }
                      aria-label={t(`Color ${color}`)}
                      aria-pressed={variant?.color === color}
                      className={`flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border px-2 text-xs ${variant?.color === color ? "border-emerald-700 bg-emerald-50" : "border-slate-200"} disabled:opacity-30 disabled:line-through`}
                    >
                      <ColorDot color={color} available={!!variants.length} />
                      {t(color)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
          {!!sizes.length && (
            <fieldset className="mt-4">
              <legend className="text-sm font-semibold">{t("Size")}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {sizes.map((size) => {
                  const candidate = product.variants.find(
                    (v) =>
                      v.size === size &&
                      v.color === variant?.color &&
                      v.available,
                  );
                  return (
                    <button
                      key={size}
                      disabled={!candidate}
                      aria-label={t(`Size ${size}`)}
                      aria-pressed={variant?.size === size}
                      onClick={() => select(candidate)}
                      className={`min-h-11 min-w-11 rounded-lg border px-3 text-sm ${variant?.size === size ? "border-emerald-700 bg-emerald-50" : "border-slate-200"} disabled:text-slate-300 disabled:line-through`}
                    >
                      {size}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
          {((!colors.length && !sizes.length) || choices.length > 1) && (
            <fieldset className="mt-4">
              <legend className="text-sm font-semibold">{t("Option")}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {(!colors.length && !sizes.length
                  ? product.variants
                  : choices
                ).map((v) => (
                  <button
                    key={v.id}
                    disabled={!v.available}
                    aria-pressed={v.id === variantId}
                    onClick={() => select(v)}
                    className={`min-h-11 rounded-lg border px-3 text-sm ${v.id === variantId ? "border-emerald-700 bg-emerald-50" : "border-slate-200"} disabled:text-slate-300 disabled:line-through`}
                  >
                    {v.title}
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <p className="mt-4 text-sm text-slate-500">
            {variant?.available
              ? variant.inventory_quantity === null
                ? t("In stock")
                : t(
                    `${variant.inventory_quantity} available in this size and color`,
                  )
              : t("This option is out of stock")}
          </p>
          <label className="mt-4 block text-sm font-medium">
            {t("Your selling price (")}
            {product.currency})
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min={Number(variant?.unit_cost) + 0.01}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className={`${field} mt-1`}
            />
          </label>
          <p className="mt-2 text-xs text-slate-500">
            {t("Margin before delivery:")}{" "}
            {money(
              Math.max(0, Number(price) - Number(variant?.unit_cost)),
              product.currency,
              language,
            )}{" "}
            {t("per item. Delivery is deducted once per order.")}
          </p>
          <button
            disabled={
              !variant?.available || Number(price) <= Number(variant?.unit_cost)
            }
            onClick={() => add(variantId, price)}
            className={`${button} mt-4 w-full`}
          >
            {t("Add to order")}
          </button>
        </div>
      </div>
      <section className="mt-6 border-t pt-4">
        <h3 className="font-semibold">{t("About this product")}</h3>
        <p className="mt-2 whitespace-pre-line break-words text-sm leading-6 text-slate-600">
          {product.description || t("No description available.")}
        </p>
      </section>
    </AffiliateModal>
  );
}
