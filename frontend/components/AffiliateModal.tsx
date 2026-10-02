"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
let modalCount = 0;
let originalOverflow = "";

export default function AffiliateModal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    if (!modalCount) originalOverflow = document.body.style.overflow;
    modalCount += 1;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    function key(event: KeyboardEvent) {
      const dialogs = document.querySelectorAll('[aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== ref.current) return;
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        closeRef.current();
      }
      if (event.key === "Tab") {
        const controls = Array.from(
          ref.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]",
          ) || [],
        );
        const first = controls[0],
          last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      modalCount -= 1;
      if (!modalCount) document.body.style.overflow = originalOverflow;
      previous?.focus();
    };
  }, []);
  return createPortal(
    <div
      className="fixed inset-0 z-[60] overflow-y-auto overflow-x-hidden bg-slate-900/40 sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="mx-auto min-h-full w-full min-w-0 max-w-3xl bg-white pb-[calc(1rem+env(safe-area-inset-bottom))] text-slate-900 sm:min-h-0 sm:rounded-2xl"
        style={{ colorScheme: "light" }}
      >
        <header className="sticky top-0 z-10 flex min-w-0 items-center justify-between gap-2 border-b bg-white px-4 py-2 sm:rounded-t-2xl">
          <h2 className="min-w-0 break-words font-bold">{title}</h2>
          <button
            aria-label={`Close ${title.toLowerCase()}`}
            onClick={close}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg hover:bg-slate-50"
          >
            <X size={20} />
          </button>
        </header>
        <div className="min-w-0 p-4 sm:p-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
