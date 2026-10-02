"use client";
import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import AffiliateModal from "@/components/AffiliateModal";
import AffiliateReceipt from "@/components/AffiliateReceipt";
import AffiliateConfetti from "@/components/AffiliateConfetti";
import { affiliateApi, money, secondary } from "@/lib/affiliates";
import { useAffiliateLocale } from "@/lib/affiliate-locale";

export default function AffiliateOrderDetails({
  id,
  close,
  celebrate = false,
}: {
  id: string;
  close: () => void;
  celebrate?: boolean;
}) {
  const { t, language } = useAffiliateLocale();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    affiliateApi(`/order-details?order_id=${encodeURIComponent(id)}`)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, [id, attempt]);
  return (
    <AffiliateModal
      title={celebrate ? "Order created" : "Order details"}
      close={close}
    >
      {celebrate && (
        <>
          <AffiliateConfetti />
          <div className="mb-5 flex items-center gap-3 rounded-xl bg-emerald-50 p-3 text-emerald-900">
            <CheckCircle2 size={28} className="shrink-0" />
            <p className="text-sm font-medium">
              {t(
                "Your order is confirmed. Share the receipt with your customer.",
              )}
            </p>
          </div>
        </>
      )}
      {error && (
        <div role="alert" className="text-sm text-red-700">
          <p>{t(error)}</p>
          <button
            onClick={() => setAttempt((value) => value + 1)}
            className={`${secondary} mt-3`}
          >
            {t("Retry receipt")}
          </button>
        </div>
      )}
      {!data && !error && (
        <p className="text-sm text-slate-500">{t("Loading order…")}</p>
      )}
      {data && (
        <div className="min-w-0 space-y-4">
          {!celebrate && (
            <div className="min-w-0 break-words">
              <p className="font-semibold">
                {t(
                  data.order.delivery_status ||
                    data.order.status.replaceAll("_", " "),
                )}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {data.order.tracking_number || t("Tracking pending")}
              </p>
            </div>
          )}
          <AffiliateReceipt
            receipt={data.receipt}
            canShare={data.order.state === "created"}
          />
          {!celebrate && (
            <section className="rounded-xl bg-emerald-50 p-4 text-sm">
              <h3 className="font-bold">{t("Your earnings")}</h3>
              <p className="mt-2">
                {t("Product costs:")}{" "}
                {money(data.order.cost, data.order.currency, language)}
              </p>
              <p>
                {t("Delivery deducted:")}{" "}
                {money(data.order.delivery_fee, data.order.currency, language)}
              </p>
              <p className="mt-2 font-semibold">
                {t(
                  data.order.profit > 0
                    ? "Earned profit"
                    : "Your expected profit",
                )}
                :{" "}
                {money(
                  data.order.profit || data.order.pending_profit,
                  data.order.currency,
                  language,
                )}
              </p>
            </section>
          )}
        </div>
      )}
    </AffiliateModal>
  );
}
