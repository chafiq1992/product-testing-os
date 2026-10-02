"use client";
import { useEffect, useState } from "react";
import { affiliateApi, button, field } from "@/lib/affiliates";

export default function AffiliateDeliveryConnection() {
  const [connection, setConnection] = useState({
    base_url: "",
    configured: false,
  });
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    affiliateApi("/admin/delivery-connection", undefined, "GET", true)
      .then(setConnection)
      .catch((err) => setError(err.message));
  }, []);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      setConnection(
        await affiliateApi(
          "/admin/delivery-connection",
          { base_url: connection.base_url, api_key: key },
          "PUT",
          true,
        ),
      );
      setKey("");
      setNotice("Connection tested and saved.");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold">Delivery app</h2>
      <p className="mt-1 text-sm text-slate-600">
        Connect delivery tracking for seller orders across your Shopify stores.
      </p>
      <p className="mt-4 text-sm font-semibold">
        {connection.configured ? "Connected" : "Not connected"}
      </p>
      <form onSubmit={save} className="mt-4 space-y-3">
        <label className="block text-sm">
          Delivery app URL
          <input
            required
            type="url"
            placeholder="https://apex-maroc.com"
            value={connection.base_url}
            onChange={(e) =>
              setConnection({ ...connection, base_url: e.target.value })
            }
            className={`${field} mt-1`}
          />
        </label>
        <label className="block text-sm">
          Tracking API key
          <input
            type="password"
            autoComplete="off"
            required={!connection.configured}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={
              connection.configured
                ? "Leave blank to keep the current key"
                : "API key from your delivery administrator"
            }
            className={`${field} mt-1`}
          />
        </label>
        <button disabled={busy} className={button}>
          {busy ? "Testing…" : "Test and save connection"}
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm text-emerald-700">
          {notice}
        </p>
      )}
    </section>
  );
}
