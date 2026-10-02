"use client";
import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Package, Share2 } from "lucide-react";
import {
  Receipt,
  money,
  productImage,
  secondary,
  button,
} from "@/lib/affiliates";
import { useAffiliateLocale } from "@/lib/affiliate-locale";

export const CUSTOMER_NOTICE = `تنبيه مهم ⚠️
عند استلام طلبك، يرجى فحص المنتج وتجربته قبل دفع المبلغ للموزع. 📦✅
إذا كان المقاس غير مناسب أو وُجدت أي مشكلة في المنتج، يُرجى إرجاع الطلب فورًا مع الموزع، وسنتكفل بإرسال بديل دون أي رسوم إضافية. 🙏⭐
رضاكم أولويتنا دائمًا مع  شكرًا لثقتكم بنا ❤️`;

export default function AffiliateReceipt({
  receipt,
  canShare = true,
}: {
  receipt: Receipt;
  canShare?: boolean;
}) {
  const { t, language, dir } = useAffiliateLocale();
  const card = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!canShare || !receipt.items.length) return;
    let active = true,
      version = 0,
      timer: ReturnType<typeof setTimeout>;
    async function prepare() {
      const current = ++version;
      setPreparing(true);
      setFile(null);
      setNotice("");
      try {
        const node = card.current;
        if (!node) return;
        await Promise.race([
          document.fonts.ready,
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
        const photos = Array.from(node.querySelectorAll("img"));
        await Promise.all(
          photos.map((img) =>
            Promise.race([
              img.decode(),
              new Promise((_, reject) =>
                setTimeout(
                  () => reject(new Error("Photo load timed out")),
                  10000,
                ),
              ),
            ]),
          ),
        );
        // Rasterize loaded photos before cloning. This also preserves contain
        // sizing for SVGs and tall images in canvas renderers without object-fit.
        const photoSources = photos.map((img) => {
          const photo = document.createElement("canvas");
          photo.width = photo.height = 480;
          const context = photo.getContext("2d")!;
          const scale = Math.min(
            480 / img.naturalWidth,
            480 / img.naturalHeight,
          );
          const width = img.naturalWidth * scale,
            height = img.naturalHeight * scale;
          context.drawImage(
            img,
            (480 - width) / 2,
            (480 - height) / 2,
            width,
            height,
          );
          return photo.toDataURL("image/png");
        });
        const { default: html2canvas } = await import("html2canvas");
        const canvas = await html2canvas(node, {
          scale: 2,
          backgroundColor: "#ffffff",
          useCORS: true,
          logging: false,
          imageTimeout: 10000,
          onclone: async (clone) => {
            const images = Array.from(
              clone.querySelectorAll<HTMLImageElement>(
                "[data-receipt-image] img",
              ),
            );
            await Promise.all(
              images.map((img, index) => {
                img.src = photoSources[index];
                return img.decode();
              }),
            );
          },
        });
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (blob) =>
              blob ? resolve(blob) : reject(new Error("PNG export failed")),
            "image/png",
          ),
        );
        if (active && current === version)
          setFile(
            new File(
              [blob],
              `receipt-${(receipt.name || "order").replace(/[^a-zA-Z0-9_-]/g, "")}-${language}.png`,
              { type: "image/png" },
            ),
          );
      } catch {
        if (active && current === version)
          setNotice(
            "The receipt image could not be prepared. Please try again.",
          );
      } finally {
        if (active && current === version) setPreparing(false);
      }
    }
    void prepare();
    let width = card.current?.clientWidth;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next && width && Math.abs(next - width) > 1) {
        clearTimeout(timer);
        timer = setTimeout(() => void prepare(), 250);
      }
      width = next;
    });
    if (card.current) observer.observe(card.current);
    return () => {
      active = false;
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [receipt, language, canShare, attempt]);
  function download() {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setNotice("Receipt image downloaded. Share it with your customer.");
  }
  async function share() {
    if (!file) return;
    setNotice("");
    try {
      // Preparing before the click preserves native sharing's user activation.
      if (navigator.share && navigator.canShare?.({ files: [file] }))
        await navigator.share({
          files: [file],
          title: `${t("Receipt")} ${receipt.name || ""}`,
        });
      else download();
    } catch (error: any) {
      if (error.name !== "AbortError")
        setNotice(
          "Sharing could not open. Download the receipt image instead.",
        );
    }
  }
  return (
    <section
      aria-label={t("Customer receipt")}
      className="mx-auto w-full min-w-0 max-w-xl"
    >
      <div
        ref={card}
        dir={dir}
        lang={language}
        data-receipt-image
        className="overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900"
        style={{ fontFamily: "Arial, sans-serif" }}
      >
        <header className="bg-emerald-800 px-5 py-5 text-white">
          <p
            className={`text-xs font-medium opacity-80 ${language === "ar" ? "" : "uppercase tracking-wider"}`}
          >
            {t("Customer copy")}
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xl font-bold">{t("Receipt")}</h3>
            <bdi className="rounded-lg bg-white/15 px-3 py-1 text-sm font-bold">
              {receipt.name}
            </bdi>
          </div>
        </header>
        <div className="px-5 py-5">
          <div className="grid min-w-0 gap-1 rounded-xl bg-slate-50 p-3 text-sm">
            <p className="break-words font-bold">{receipt.customer_name}</p>
            <p>
              <bdi dir="ltr">{receipt.customer_phone}</bdi>
            </p>
            <p className="break-words text-slate-600">
              {receipt.city} · {receipt.address}
            </p>
          </div>
          <div className="my-4 space-y-4">
            {receipt.items.map((item, index) => (
              <div
                key={index}
                className="flex min-w-0 items-start gap-3 border-b border-dashed border-slate-200 pb-4"
              >
                <div className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl bg-slate-50">
                  {item.image ? (
                    <img
                      crossOrigin="anonymous"
                      src={productImage(item.image, 240)}
                      alt=""
                      className="absolute inset-0 h-full w-full object-contain"
                    />
                  ) : (
                    <Package className="m-5 text-slate-300" size={32} />
                  )}
                </div>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="break-words font-semibold">{item.title}</p>
                  {item.size || item.color ? (
                    <p className="mt-1 break-words text-xs text-slate-500">
                      {item.color && (
                        <>
                          {t("Color")}: {t(item.color)} ·{" "}
                        </>
                      )}
                      {item.size && (
                        <>
                          {t("Size")}: <bdi>{item.size}</bdi>
                        </>
                      )}
                    </p>
                  ) : (
                    <p className="mt-1 break-words text-xs text-slate-500">
                      {item.variant}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-slate-500">
                    <bdi>
                      {item.quantity} ×{" "}
                      {money(item.unit_price, receipt.currency, language)}
                    </bdi>
                  </p>
                  <p className="mt-2 font-bold">
                    <bdi>{money(item.total, receipt.currency, language)}</bdi>
                  </p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap justify-between gap-2 text-sm text-slate-600">
            <span>{t("Delivery (included)")}</span>
            <bdi>
              {money(receipt.delivery_fee || 0, receipt.currency, language)}
            </bdi>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-50 p-3 font-bold text-emerald-900">
            <span>{t("Total to pay")}</span>
            <bdi>{money(receipt.total, receipt.currency, language)}</bdi>
          </div>
          {receipt.note && (
            <p className="mt-4 break-words text-sm text-slate-600">
              {t("Note")}: {receipt.note}
            </p>
          )}
          <div
            dir="rtl"
            lang="ar"
            className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-right text-[13px] leading-6 text-slate-800"
          >
            <p className="whitespace-pre-line break-words">{CUSTOMER_NOTICE}</p>
          </div>
        </div>
        <footer className="border-t border-dashed border-slate-200 px-5 py-3 text-center text-xs text-slate-500">
          {t("Thank you for your trust")} ♥
        </footer>
      </div>
      {canShare && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={share}
            disabled={!file || preparing}
            className={`${button} w-full`}
          >
            {preparing ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Share2 size={16} />
            )}{" "}
            {t(preparing ? "Preparing receipt…" : "Share receipt image")}
          </button>
          <button
            type="button"
            onClick={download}
            disabled={!file || preparing}
            className={`${secondary} w-full`}
          >
            <Download size={16} /> {t("Download receipt")}
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm text-emerald-800">
          {t(notice)}
        </p>
      )}
      {canShare && !file && !preparing && (
        <button
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
          className={`${secondary} mt-2`}
        >
          {t("Retry image")}
        </button>
      )}
    </section>
  );
}
