"use client";
export default function AffiliateConfetti() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[70] overflow-hidden"
    >
      {Array.from({ length: 38 }, (_, index) => (
        <i
          key={index}
          className="affiliate-confetti"
          style={{
            left: `${(index * 37) % 100}%`,
            background: ["#10b981", "#fbbf24", "#38bdf8", "#fb7185", "#a78bfa"][
              index % 5
            ],
            animationDelay: `${(index % 8) * 0.08}s`,
            transform: `rotate(${index * 19}deg)`,
          }}
        />
      ))}
      <style>{`@keyframes affiliate-confetti-fall{0%{translate:0 -20px;opacity:1;rotate:0deg}85%{opacity:1}100%{translate:35px 100dvh;opacity:0;rotate:720deg}}.affiliate-confetti{position:absolute;top:-15px;width:8px;height:13px;border-radius:2px;animation:affiliate-confetti-fall 2.7s ease-out both}@media(prefers-reduced-motion:reduce){.affiliate-confetti{display:none}}`}</style>
    </div>
  );
}
