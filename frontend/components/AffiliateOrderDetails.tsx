"use client";
import { useEffect, useState } from "react";
import AffiliateModal from "@/components/AffiliateModal";
import AffiliateReceipt from "@/components/AffiliateReceipt";
import { affiliateApi, money } from "@/lib/affiliates";

export default function AffiliateOrderDetails({
  id,
  close,
}: {
  id: string;
  close: () => void;
}) {
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    affiliateApi(`/order-details?order_id=${encodeURIComponent(id)}`)
      .then((r) => {
        if (active) setData(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  return (
    <AffiliateModal title="Order details" close={close}>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {!data && !error && (
        <p className="text-sm text-slate-500">Loading order…</p>
      )}
      {data && (
        <div className="min-w-0 space-y-4">
          <div className="min-w-0 break-words">
            <p className="font-semibold capitalize">
              {data.order.delivery_status ||
                data.order.status.replaceAll("_", " ")}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {data.order.tracking_number || "Tracking pending"}
            </p>
          </div>
          <AffiliateReceipt
            receipt={data.receipt}
            canShare={data.order.state === "created"}
          />
          <section className="rounded-xl bg-emerald-50 p-4 text-sm">
            <h3 className="font-bold">Your earnings</h3>
            <p className="mt-2">
              Product costs: {money(data.order.cost, data.order.currency)}
            </p>
            <p>
              Delivery deducted:{" "}
              {money(data.order.delivery_fee, data.order.currency)}
            </p>
            <p className="mt-2 font-semibold">
              {data.order.profit > 0 ? "Earned" : "Expected"} profit:{" "}
              {money(
                data.order.profit || data.order.pending_profit,
                data.order.currency,
              )}
            </p>
          </section>
        </div>
      )}
    </AffiliateModal>
  );
}
