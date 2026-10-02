"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { Languages } from "lucide-react";
import { translate, AffiliateLanguage } from "@/lib/affiliate-translations";

const LocaleContext = createContext({
  language: "en" as AffiliateLanguage,
  dir: "ltr" as "ltr" | "rtl",
  setLanguage: (_: AffiliateLanguage) => {},
  t: (text: string) => text,
});

export function AffiliateLocaleProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [language, setLanguage] = useState<AffiliateLanguage>("en");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("ptos_affiliate_language");
      if (saved === "en" || saved === "fr" || saved === "ar")
        setLanguage(saved);
    } catch {}
  }, []);
  function change(value: AffiliateLanguage) {
    setLanguage(value);
    try {
      localStorage.setItem("ptos_affiliate_language", value);
    } catch {}
  }
  return (
    <LocaleContext.Provider
      value={{
        language,
        dir: language === "ar" ? "rtl" : "ltr",
        setLanguage: change,
        t: (text) => translate(text, language),
      }}
    >
      {children}
    </LocaleContext.Provider>
  );
}
export const useAffiliateLocale = () => useContext(LocaleContext);

export function AffiliateLanguageSwitch() {
  const { language, setLanguage, t } = useAffiliateLocale();
  return (
    <label className="inline-flex min-h-11 shrink-0 items-center gap-1.5 text-slate-600">
      <Languages size={16} aria-hidden="true" />
      <select
        aria-label={t("Language")}
        value={language}
        onChange={(e) => setLanguage(e.target.value as AffiliateLanguage)}
        className="min-h-11 max-w-[125px] rounded-lg bg-transparent pe-1 text-sm outline-none focus:ring-2 focus:ring-emerald-600"
      >
        <option value="en" lang="en">
          English
        </option>
        <option value="fr" lang="fr">
          Français
        </option>
        <option value="ar" lang="ar">
          العربية
        </option>
      </select>
    </label>
  );
}
