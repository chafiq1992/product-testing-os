"use client";
import { useState } from "react";
import { affiliateApi, field, secondary } from "@/lib/affiliates";
import { useAffiliateLocale } from "@/lib/affiliate-locale";

export default function AffiliateOrderCancellation({
  order,
  changed,
}: {
  order: any;
  changed: () => Promise<void>;
}) {
  const { t } = useAffiliateLocale();
  const [open, setOpen] = useState(false),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const cancellation = order.cancellation;
  async function cancel(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !note.trim()) return;
    setBusy(true);
    setError("");
    try {
      await affiliateApi("/order-cancellation", {
        order_id: order.id,
        note: note.trim(),
      });
      setOpen(false);
    } catch (error: any) {
      setError(error.message);
    } finally {
      try {
        await changed();
      } catch (error: any) {
        setError(error.message);
      } finally {
        setBusy(false);
      }
    }
  }
  if (cancellation)
    return (
      <section className="min-w-0 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
        <h3 className="font-bold">{t("Cancelled by affiliate")}</h3>
        <p>
          {t(
            cancellation.state === "cancelled"
              ? "The order was cancelled in Shopify."
              : cancellation.state === "marked"
                ? "This fulfilled order stays active. Your cancellation note is recorded in Shopify."
                : "Cancellation needs administrator reconciliation; do not resubmit",
          )}
        </p>
        <p className="whitespace-pre-wrap break-words">
          {t("Cancellation note")}: {cancellation.note}
        </p>
        <p className="text-xs text-slate-600">
          {t(
            cancellation.note_synced
              ? "Note saved in Shopify"
              : "Shopify note awaiting confirmation",
          )}
        </p>
      </section>
    );
  if (order.state !== "created" || order.status === "cancelled") return null;
  return (
    <section className="min-w-0 rounded-xl border p-4 text-sm">
      {error && (
        <p role="alert" className="mb-3 break-words text-red-700">
          {t(error)}
        </p>
      )}
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className={`${secondary} w-full text-red-700`}
        >
          {t("Cancel order")}
        </button>
      ) : (
        <form onSubmit={cancel} className="space-y-3">
          <h3 className="font-bold">{t("Cancel order")}</h3>
          <p className="text-slate-600">
            {t(
              order.can_cancel_in_shopify
                ? "Orders that have not been fulfilled can be cancelled. A cancellation note is required."
                : "This order has been fulfilled. It will stay active and be marked Cancelled by affiliate.",
            )}
          </p>
          <label className="block">
            {t("Cancellation note")}
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              required
              maxLength={1000}
              className={`${field} mt-2 min-h-24 w-full resize-y`}
            />
          </label>
          <button
            type="submit"
            disabled={busy || !note.trim()}
            className={`${secondary} w-full border-red-200 text-red-700 disabled:opacity-50`}
          >
            {t(busy ? "Saving…" : "Confirm cancellation")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setOpen(false)}
            className={`${secondary} w-full`}
          >
            {t("Keep order")}
          </button>
        </form>
      )}
    </section>
  );
}
