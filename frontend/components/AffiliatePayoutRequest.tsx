"use client";
import { useEffect, useState } from "react";
import {
  affiliateApi,
  button,
  field,
  money,
  secondary,
} from "@/lib/affiliates";
import { useAffiliateLocale } from "@/lib/affiliate-locale";

type Account = { id: string; bank: "cih" | "attijari"; rib: string };
export default function AffiliatePayoutRequest({
  available,
  currency,
  requested,
}: {
  available: number;
  currency: string;
  requested: () => Promise<void>;
}) {
  const { t, language } = useAffiliateLocale();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [ribs, setRibs] = useState({ cih: "", attijari: "" });
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [amount, setAmount] = useState(""),
    [method, setMethod] = useState("bank"),
    [accountId, setAccountId] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    affiliateApi("/bank-accounts")
      .then((rows: Account[]) => {
        if (!active) return;
        setAccounts(rows);
        setRibs({
          cih: rows.find((a) => a.bank === "cih")?.rib || "",
          attijari: rows.find((a) => a.bank === "attijari")?.rib || "",
        });
        setAccountId(rows[0]?.id || "");
        setLoaded(true);
        setError("");
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const rows: Account[] = await affiliateApi(
        "/bank-accounts",
        {
          accounts: Object.entries(ribs)
            .filter(([, rib]) => rib.trim())
            .map(([bank, rib]) => ({ bank, rib })),
        },
        "PUT",
      );
      setAccounts(rows);
      setRibs({
        cih: rows.find((a) => a.bank === "cih")?.rib || "",
        attijari: rows.find((a) => a.bank === "attijari")?.rib || "",
      });
      if (!rows.some((a) => a.id === accountId))
        setAccountId(rows[0]?.id || "");
      setNotice("Bank accounts saved.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      !Number.isFinite(Number(amount)) ||
      Number(amount) <= 0 ||
      Number(amount) > available
    ) {
      setError("Amount exceeds available delivered-order earnings");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await affiliateApi("/payouts", {
        amount,
        currency,
        method,
        account_id: method === "bank" ? accountId : undefined,
      });
      setAmount("");
      setNotice("Payout requested. Your administrator will review it.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      await requested();
      setBusy(false);
    }
  }
  const amountValid =
    Number.isFinite(Number(amount)) &&
    Number(amount) > 0 &&
    Number(amount) <= available;
  const ribsValid = Object.values(ribs).every(
    (rib) => !rib.trim() || /^[0-9]{24}$/.test(rib.replace(/[\s-]/g, "")),
  );
  return (
    <div className="mb-6 min-w-0 space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-red-50 p-3 text-sm text-red-700"
        >
          {t(error)}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"
        >
          {t(notice)}
        </p>
      )}
      <form onSubmit={save} className="rounded-2xl border bg-white p-4 sm:p-6">
        <h2 className="font-bold">{t("Bank accounts")}</h2>
        <p className="mt-1 text-sm text-slate-500">
          {t(
            "Save a CIH account, an Attijari account, or both. Leave a field empty to remove that account.",
          )}
        </p>
        {!loaded ? (
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className={`${secondary} mt-3`}
          >
            {t("Reload bank accounts")}
          </button>
        ) : (
          <>
            <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
              {(["cih", "attijari"] as const).map((bank) => (
                <label key={bank} className="min-w-0 text-sm font-medium">
                  {bank === "cih" ? "CIH" : "Attijariwafa bank"} {t("RIB")}
                  <input
                    dir="ltr"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    disabled={busy}
                    value={ribs[bank]}
                    onChange={(e) =>
                      setRibs({ ...ribs, [bank]: e.target.value })
                    }
                    maxLength={60}
                    placeholder={t("24 digits")}
                    className={`${field} mt-1 font-mono`}
                  />
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {t(
                "Check your RIB carefully. Saving validates the format, not ownership of the bank account.",
              )}
            </p>
            <button
              disabled={busy || !ribsValid}
              className={`${secondary} mt-4`}
            >
              {t("Save bank accounts")}
            </button>
          </>
        )}
      </form>
      <form
        onSubmit={submit}
        className="rounded-2xl border bg-white p-4 sm:p-6"
      >
        <h2 className="font-bold">{t("Request a payout")}</h2>
        <p className="mt-1 text-sm text-slate-500">
          {t(
            "Only available earnings from delivered, collected orders can be requested. Pending earnings and reserved payouts are excluded.",
          )}
        </p>
        <p className="mt-3 rounded-xl bg-emerald-50 p-3 font-bold text-emerald-800">
          {t("Available")}: {money(Math.max(0, available), currency, language)}
        </p>
        <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="min-w-0 text-sm">
            {t("Amount")} ({currency})
            <input
              disabled={busy}
              required
              type="number"
              inputMode="decimal"
              min="0.01"
              max={Math.max(0, available)}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`${field} mt-1`}
            />
          </label>
          <label className="min-w-0 text-sm">
            {t("Payout method")}
            <select
            aria-label={t("Payout method")}
              disabled={busy}
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className={`${field} mt-1`}
            >
              <option value="bank">{t("Bank transfer")}</option>
              <option value="cash">{t("Cash")}</option>
            </select>
          </label>
          {method === "bank" && (
            <label className="min-w-0 text-sm sm:col-span-2">
              {t("Bank account")}
              <select
              aria-label={t("Bank account")}
                disabled={busy || !accounts.length}
                required
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className={`${field} mt-1`}
              >
                <option value="">{t("Choose a saved bank account")}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.bank === "cih" ? "CIH" : "Attijariwafa bank"} · ••••{" "}
                    {a.rib.slice(-4)}
                  </option>
                ))}
              </select>
              {!accounts.length && (
                <p className="mt-2 text-xs text-amber-700">
                  {t("Save a bank account above or choose cash.")}
                </p>
              )}
            </label>
          )}
        </div>
        <button
          disabled={
            busy ||
            !amountValid ||
            (method === "bank" && !accounts.some((a) => a.id === accountId))
          }
          className={`${button} mt-4 w-full sm:w-auto`}
        >
          {t(busy ? "Please wait…" : "Request payout")}
        </button>
      </form>
    </div>
  );
}
