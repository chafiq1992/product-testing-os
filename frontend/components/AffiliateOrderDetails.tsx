"use client";
import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import AffiliateModal from "@/components/AffiliateModal";
import AffiliateReceipt from "@/components/AffiliateReceipt";
import AffiliateConfetti from "@/components/AffiliateConfetti";
import AffiliateOrderTracking from "@/components/AffiliateOrderTracking";
import AffiliateOrderCancellation from "@/components/AffiliateOrderCancellation";
import { affiliateApi, money, secondary } from "@/lib/affiliates";
import { useAffiliateLocale } from "@/lib/affiliate-locale";

export default function AffiliateOrderDetails({
  id,
  close,
  celebrate = false,
  changed,
}: {
  id: string;
  close: () => void;
  celebrate?: boolean;
  changed?: () => Promise<void>;
}) {
  const { t, language } = useAffiliateLocale();
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    const load = (refresh = false) =>
      affiliateApi(
        `/order-details?order_id=${encodeURIComponent(id)}&refresh=${refresh}`,
      )
        .then((value) => {
          if (active) setData(value);
        })
        .catch((error) => {
          if (active) setError(error.message);
        });
    load(attempt > 0);
    const timer = setInterval(() => {
      if (!document.hidden) load(true);
    }, 60000);
    return () => {
      active = false;
      clearInterval(timer);
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
            <>
              <AffiliateOrderTracking order={data.order} />
              <button
                className={`${secondary} w-full`}
                onClick={() => setAttempt((value) => value + 1)}
              >
                {t("Refresh tracking")}
              </button>
              {data.warnings?.length > 0 && (
                <p role="status" className="text-sm text-amber-800">
                  {t(
                    "Tracking could not be fully refreshed. The last known status is shown.",
                  )}
                </p>
              )}
            </>
          )}
          <AffiliateReceipt
            receipt={data.receipt}
            canShare={data.order.state === "created"}
          />
          {!celebrate && (
            <section className="rounded-xl bg-emerald-50 p-4 text-sm">
              <h3 className="font-bold">{t("Your earnings")}</h3>
              <p className="mt-2">
                {t("Product cost")}:{" "}
                {money(data.order.cost, data.order.currency, language)}
              </p>
              <p>
                {t("Delivery deducted:")}{" "}
                {money(data.order.delivery_fee, data.order.currency, language)}
              </p>
              <p className="mt-3 rounded-lg bg-white p-3 text-lg font-bold text-emerald-800">
                {t(
                  data.order.profit_earned ||
                    ["cancelled", "returned", "failed"].includes(
                      data.order.status,
                    )
                    ? "Profit"
                    : "Expected profit",
                )}
                :{" "}
                {money(
                  data.order.profit_earned
                    ? data.order.profit
                    : data.order.pending_profit,
                  data.order.currency,
                  language,
                )}
              </p>
            </section>
          )}
          {!celebrate && (
            <AffiliateOrderCancellation
              order={data.order}
              changed={async () => {
                const value = await affiliateApi(
                  `/order-details?order_id=${encodeURIComponent(id)}&refresh=true`,
                );
                setData(value);
                if (changed) await changed();
              }}
            />
          )}
        </div>
      )}
    </AffiliateModal>
  );
}
