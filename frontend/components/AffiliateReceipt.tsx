"use client";
import { useState } from "react";
import { Share2 } from "lucide-react";
import { Receipt, money, productImage, secondary } from "@/lib/affiliates";

export function receiptText(receipt: Receipt, draft = false) {
  return [
    draft ? "Order estimate" : `Receipt ${receipt.name || ""}`,
    receipt.customer_name,
    receipt.customer_phone,
    `${receipt.city} — ${receipt.address}`,
    ...receipt.items.map(
      (i) =>
        `${i.quantity} × ${i.title}${i.variant ? ` (${i.variant})` : ""} · ${money(i.unit_price, receipt.currency)} each · ${money(i.total, receipt.currency)}`,
    ),
    `Total: ${money(receipt.total, receipt.currency)}`,
    receipt.note ? `Note: ${receipt.note}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export default function AffiliateReceipt({
  receipt,
  draft = false,
  canShare = true,
}: {
  receipt: Receipt;
  draft?: boolean;
  canShare?: boolean;
}) {
  const [notice, setNotice] = useState("");
  async function share() {
    setNotice("");
    const text = receiptText(receipt, draft);
    try {
      if (navigator.share)
        await navigator.share({
          title: draft ? "Order estimate" : `Receipt ${receipt.name || ""}`,
          text,
        });
      else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setNotice("Receipt copied. Paste it into your customer conversation.");
      } else {
        const url = URL.createObjectURL(
          new Blob([text], { type: "text/plain;charset=utf-8" }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = "receipt.txt";
        link.click();
        URL.revokeObjectURL(url);
        setNotice("Receipt downloaded.");
      }
    } catch (err: any) {
      if (err.name !== "AbortError")
        setNotice(
          "Sharing could not open. Try again or copy the receipt details.",
        );
    }
  }
  return (
    <section
      aria-label="Customer receipt"
      className="min-w-0 rounded-xl border bg-white p-4"
    >
      <h3 className="font-bold">
        {draft ? "Order estimate" : `Receipt ${receipt.name || ""}`}
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        {draft ? "Preview before submission" : "Customer copy"}
      </p>
      <div className="mt-4 min-w-0 break-words text-sm">
        <p className="font-semibold">
          {receipt.customer_name || "Customer name"}
        </p>
        <p>{receipt.customer_phone}</p>
        <p>
          {receipt.city} {receipt.address && `· ${receipt.address}`}
        </p>
      </div>
      <div className="my-4 space-y-3 border-y py-4">
        {receipt.items.map((i, index) => (
          <div key={index} className="flex min-w-0 gap-3">
            {i.image && (
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-slate-50">
                <img
                  src={productImage(i.image, 120)}
                  alt=""
                  className="absolute inset-0 h-full w-full object-contain"
                />
              </div>
            )}
            <div className="min-w-0 flex-1 break-words text-sm">
              <p className="font-medium">{i.title}</p>
              <p className="text-xs text-slate-500">{i.variant}</p>
              <p className="mt-1 text-xs">
                {i.quantity} × {money(i.unit_price, receipt.currency)}
              </p>
            </div>
            <p className="min-w-0 max-w-[35%] break-words text-right text-sm font-semibold">
              {money(i.total, receipt.currency)}
            </p>
          </div>
        ))}
      </div>
      <div className="flex min-w-0 justify-between gap-3 font-bold">
        <span>Total</span>
        <span className="break-words text-right">
          {money(receipt.total, receipt.currency)}
        </span>
      </div>
      {receipt.note && (
        <p className="mt-3 break-words text-sm text-slate-500">
          {receipt.note}
        </p>
      )}
      <button
        type="button"
        onClick={share}
        disabled={!canShare || !receipt.items.length}
        className={`${secondary} mt-4 w-full`}
      >
        <Share2 size={16} />
        Share receipt
      </button>
      {notice && (
        <p role="status" className="mt-2 text-xs text-emerald-800">
          {notice}
        </p>
      )}
    </section>
  );
}
