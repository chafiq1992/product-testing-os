"use client";
import { useAffiliateLocale } from "@/lib/affiliate-locale";

export default function AffiliateOrderTracking({
  order,
  compact = false,
}: {
  order: any;
  compact?: boolean;
}) {
  const { t, language } = useAffiliateLocale();
  const fulfillment =
    order.fulfillment_status === "partial"
      ? "partially fulfilled"
      : (order.fulfillment_status || "unfulfilled").replaceAll("_", " ");
  const delivery =
    order.status === "cancelled"
      ? "cancelled"
      : order.delivery_status || order.status.replaceAll("_", " ");
  return (
    <div
      className={`min-w-0 whitespace-normal break-words text-xs ${compact ? "space-y-1 text-slate-500" : "space-y-3 rounded-xl border bg-slate-50 p-4"}`}
    >
      {!compact && (
        <h3 className="text-sm font-bold text-slate-900">
          {t("Order tracking")}
        </h3>
      )}
      <p>
        {t("Shopify fulfillment")}:{" "}
        <span className="font-semibold">{t(fulfillment)}</span>
      </p>
      <p>
        {t("Delivery status")}:{" "}
        <span className="font-semibold">{t(delivery)}</span>
      </p>
      {order.status_source !== "delivery_app" &&
        !["cancelled", "delivered", "returned", "failed"].includes(
          order.status,
        ) && (
          <p>
            {t(
              order.fulfillment_status === "unfulfilled"
                ? "Awaiting Shopify fulfillment"
                : "Awaiting delivery app handoff",
            )}
          </p>
        )}
      <p>
        {t("Tracking number")}:{" "}
        <span dir="auto" className="font-medium">
          {order.tracking_number || t("Tracking pending")}
        </span>
      </p>
      {order.affiliate_cancelled && (
        <p className="font-semibold text-amber-800">
          {t("Cancelled by affiliate")}
        </p>
      )}
      {!compact && (
        <>
          <p>
            {t("Status source")}:{" "}
            {t(
              order.status_source === "delivery_app"
                ? "Delivery app"
                : "Shopify",
            )}
          </p>
          {order.delivery_updated_at && (
            <p>
              {t("Delivery update")}:{" "}
              {new Date(
                /[zZ]|[+-]\d{2}:\d{2}$/.test(order.delivery_updated_at)
                  ? order.delivery_updated_at
                  : order.delivery_updated_at + "Z",
              ).toLocaleString(language)}
            </p>
          )}
          <p className="text-slate-500">
            {t("Live statuses refresh every minute while this page is open.")}
          </p>
        </>
      )}
    </div>
  );
}
