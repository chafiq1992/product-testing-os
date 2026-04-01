"""Rich HTML/CSS section templates for the AI Page Builder.

Each render_*() function returns a self-contained HTML string with embedded CSS
and optional JS. These are used inside Shopify `custom-liquid` sections.

All CSS is scoped with `.ai-pb-{section}` class prefixes to avoid conflicts
with the theme or other sections.

Design system:
  - Font: Inter from Google Fonts (loaded once in hero)
  - Color: CSS custom properties --ai-accent, --ai-accent-light
  - Animations: scroll-reveal via IntersectionObserver, pulsing CTA buttons
  - Responsive: mobile-first, works down to 320px
"""

import html as _html
from typing import Any


# ─────────────────────────── Shared ───────────────────────────

_GOOGLE_FONT_LINK = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">'

_SCROLL_REVEAL_JS = """
<script>
(function(){
  var obs = new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(e.isIntersecting){e.target.classList.add('ai-pb-visible');obs.unobserve(e.target);}
    });
  },{threshold:0.15});
  document.querySelectorAll('.ai-pb-animate').forEach(function(el){obs.observe(el);});
})();
</script>
"""

_BASE_VARS = """
  --ai-accent: {accent};
  --ai-accent-light: {accent_light};
  --ai-accent-rgb: {accent_rgb};
  --ai-text: #1a1a2e;
  --ai-text-light: #555;
  --ai-bg: #ffffff;
  --ai-bg-soft: #f8f9fc;
  --ai-radius: 1rem;
  --ai-radius-lg: 1.5rem;
  --ai-shadow: 0 4px 20px rgba(0,0,0,0.08);
  --ai-shadow-lg: 0 8px 30px rgba(0,0,0,0.12);
  --ai-font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
"""


def _esc(text: str) -> str:
    """HTML-escape user text."""
    return _html.escape(str(text or ""), quote=True)


def _hex_to_rgb(hex_color: str) -> str:
    """Convert #RRGGBB to 'R,G,B'."""
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = h[0]*2 + h[1]*2 + h[2]*2
    try:
        return f"{int(h[0:2],16)},{int(h[2:4],16)},{int(h[4:6],16)}"
    except Exception:
        return "99,39,120"


def _get_vars(accent: str = "#6C27B0", accent_light: str = "#9C4DCC") -> str:
    return _BASE_VARS.format(
        accent=accent,
        accent_light=accent_light,
        accent_rgb=_hex_to_rgb(accent),
    )


# ─────────────────────────── Hero ───────────────────────────

def render_hero(
    *,
    heading: str = "",
    subheading: str = "",
    button_label: str = "Shop Now",
    button_link: str = "/collections/all",
    product_title: str = "",
    accent: str = "#6C27B0",
    accent_light: str = "#9C4DCC",
    include_font: bool = True,
) -> str:
    h = _esc(heading or product_title or "Discover Something Special")
    sub = _esc(subheading or "Premium quality, thoughtful design, exceptional value.")
    btn = _esc(button_label or "Shop Now")
    link = _esc(button_link)
    font = _GOOGLE_FONT_LINK if include_font else ""

    return f"""{font}
<style>
  :root {{ {_get_vars(accent, accent_light)} }}
  .ai-pb-hero {{
    font-family: var(--ai-font);
    background: linear-gradient(135deg, var(--ai-accent) 0%, var(--ai-accent-light) 50%, #1a1a2e 100%);
    color: #fff;
    text-align: center;
    padding: 4rem 1.5rem;
    position: relative;
    overflow: hidden;
  }}
  .ai-pb-hero::before {{
    content: '';
    position: absolute;
    top: -50%;
    left: -50%;
    width: 200%;
    height: 200%;
    background: radial-gradient(circle, rgba(255,255,255,0.05) 0%, transparent 70%);
    animation: ai-hero-shimmer 8s ease-in-out infinite;
  }}
  @keyframes ai-hero-shimmer {{
    0%,100% {{ transform: translate(0,0); }}
    50% {{ transform: translate(5%,5%); }}
  }}
  .ai-pb-hero-inner {{
    position: relative;
    z-index: 1;
    max-width: 800px;
    margin: 0 auto;
  }}
  .ai-pb-hero h1 {{
    font-size: clamp(2rem, 5vw, 3.2rem);
    font-weight: 900;
    margin: 0 0 1rem;
    line-height: 1.2;
    text-shadow: 0 2px 20px rgba(0,0,0,0.3);
  }}
  .ai-pb-hero p {{
    font-size: clamp(1rem, 2.5vw, 1.3rem);
    margin: 0 0 2rem;
    opacity: 0.9;
    line-height: 1.6;
    max-width: 600px;
    margin-left: auto;
    margin-right: auto;
  }}
  .ai-pb-hero-btn {{
    display: inline-block;
    background: #fff;
    color: var(--ai-accent);
    padding: 1rem 3rem;
    font-size: 1.2rem;
    font-weight: 800;
    border: none;
    border-radius: 60px;
    text-decoration: none;
    cursor: pointer;
    box-shadow: 0 8px 30px rgba(0,0,0,0.2);
    transition: transform 0.3s, box-shadow 0.3s;
    animation: ai-btn-pulse 2s infinite ease-in-out;
  }}
  .ai-pb-hero-btn:hover {{
    transform: scale(1.05);
    box-shadow: 0 12px 40px rgba(0,0,0,0.3);
  }}
  @keyframes ai-btn-pulse {{
    0%,100% {{ transform: scale(1); }}
    50% {{ transform: scale(1.04); }}
  }}
  .ai-pb-hero-trust {{
    margin-top: 1.5rem;
    font-size: 0.95rem;
    opacity: 0.8;
  }}
</style>
<div class="ai-pb-hero">
  <div class="ai-pb-hero-inner">
    <h1>{h}</h1>
    <p>{sub}</p>
    <a href="{link}" class="ai-pb-hero-btn">🛒 {btn}</a>
    <div class="ai-pb-hero-trust">⭐⭐⭐⭐⭐ Trusted by 2,000+ Happy Customers</div>
  </div>
</div>
"""


# ─────────────────────────── Features ───────────────────────────

def render_features(
    *,
    heading: str = "",
    items: list[dict] | None = None,
    accent: str = "#6C27B0",
    accent_light: str = "#9C4DCC",
) -> str:
    h = _esc(heading or "Why Choose Us")
    feature_items = items or [
        {"title": "✨ Premium Quality", "text": "Crafted with the finest materials for lasting durability."},
        {"title": "🚚 Fast Shipping", "text": "Free express delivery on all orders. 2-3 business days."},
        {"title": "↩️ Easy Returns", "text": "30-day hassle-free return policy. Shop with confidence."},
    ]

    cards_html = ""
    for i, item in enumerate(feature_items):
        t = _esc(item.get("title", ""))
        txt = _esc(item.get("text", ""))
        cards_html += f"""
    <div class="ai-pb-feat-card ai-pb-animate" style="animation-delay:{i*0.1}s">
      <div class="ai-pb-feat-icon">{t.split(' ')[0] if ' ' in t else '✨'}</div>
      <h3>{t}</h3>
      <p>{txt}</p>
    </div>"""

    return f"""
<style>
  .ai-pb-features {{
    font-family: var(--ai-font);
    padding: 3.5rem 1.5rem;
    background: var(--ai-bg-soft);
    text-align: center;
  }}
  .ai-pb-features > h2 {{
    font-size: clamp(1.5rem, 3.5vw, 2.2rem);
    font-weight: 800;
    color: var(--ai-accent);
    margin: 0 0 2rem;
  }}
  .ai-pb-feat-grid {{
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 1.5rem;
    max-width: 1100px;
    margin: 0 auto;
  }}
  .ai-pb-feat-card {{
    background: #fff;
    border-radius: var(--ai-radius-lg);
    padding: 2rem 1.5rem;
    box-shadow: var(--ai-shadow);
    transition: transform 0.3s, box-shadow 0.3s;
    opacity: 0;
    transform: translateY(30px);
  }}
  .ai-pb-feat-card.ai-pb-visible {{
    opacity: 1;
    transform: translateY(0);
    transition: opacity 0.6s ease, transform 0.6s ease;
  }}
  .ai-pb-feat-card:hover {{
    transform: translateY(-6px);
    box-shadow: var(--ai-shadow-lg);
  }}
  .ai-pb-feat-icon {{
    font-size: 2.5rem;
    margin-bottom: 0.8rem;
  }}
  .ai-pb-feat-card h3 {{
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--ai-text);
    margin: 0 0 0.5rem;
  }}
  .ai-pb-feat-card p {{
    font-size: 0.95rem;
    color: var(--ai-text-light);
    line-height: 1.6;
    margin: 0;
  }}
</style>
<div class="ai-pb-features">
  <h2>{h}</h2>
  <div class="ai-pb-feat-grid">
    {cards_html}
  </div>
</div>
{_SCROLL_REVEAL_JS}
"""


# ─────────────────────────── Benefits ───────────────────────────

def render_benefits(
    *,
    heading: str = "",
    items: list[dict] | None = None,
    accent: str = "#6C27B0",
    accent_light: str = "#9C4DCC",
) -> str:
    h = _esc(heading or "What You'll Love")
    benefit_items = items or [
        {"text": "Premium quality materials that last"},
        {"text": "Perfectly designed for everyday use"},
        {"text": "Loved by thousands of happy customers"},
        {"text": "Free shipping and easy returns"},
        {"text": "100% satisfaction guaranteed"},
    ]

    cards_html = ""
    for i, item in enumerate(benefit_items):
        txt = _esc(item.get("text", item.get("title", "")))
        cards_html += f"""
    <div class="ai-pb-benefit-card ai-pb-animate" style="animation-delay:{i*0.12}s">
      <span class="ai-pb-benefit-check">✅</span>
      <span class="ai-pb-benefit-text">{txt}</span>
    </div>"""

    return f"""
<style>
  .ai-pb-benefits {{
    font-family: var(--ai-font);
    padding: 3.5rem 1.5rem;
    background: var(--ai-bg);
    text-align: center;
  }}
  .ai-pb-benefits > h2 {{
    font-size: clamp(1.5rem, 3.5vw, 2.2rem);
    font-weight: 800;
    color: var(--ai-accent);
    margin: 0 0 2rem;
  }}
  .ai-pb-benefit-list {{
    display: flex;
    flex-direction: column;
    gap: 1rem;
    max-width: 700px;
    margin: 0 auto;
  }}
  .ai-pb-benefit-card {{
    display: flex;
    align-items: center;
    gap: 1rem;
    background: var(--ai-bg-soft);
    border-radius: var(--ai-radius);
    padding: 1.2rem 1.5rem;
    text-align: left;
    border-left: 4px solid var(--ai-accent);
    box-shadow: 0 2px 10px rgba(0,0,0,0.04);
    transition: transform 0.3s, box-shadow 0.3s;
    opacity: 0;
    transform: translateX(-20px);
  }}
  .ai-pb-benefit-card.ai-pb-visible {{
    opacity: 1;
    transform: translateX(0);
    transition: opacity 0.5s ease, transform 0.5s ease;
  }}
  .ai-pb-benefit-card:hover {{
    transform: translateX(6px);
    box-shadow: var(--ai-shadow);
  }}
  .ai-pb-benefit-check {{
    font-size: 1.4rem;
    flex-shrink: 0;
  }}
  .ai-pb-benefit-text {{
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--ai-text);
    line-height: 1.5;
  }}
</style>
<div class="ai-pb-benefits">
  <h2>{h}</h2>
  <div class="ai-pb-benefit-list">
    {cards_html}
  </div>
</div>
{_SCROLL_REVEAL_JS}
"""


# ─────────────────────────── Testimonials ───────────────────────────

def render_testimonials(
    *,
    heading: str = "",
    items: list[dict] | None = None,
    accent: str = "#6C27B0",
    accent_light: str = "#9C4DCC",
) -> str:
    h = _esc(heading or "What Our Customers Say")
    default_items = [
        {"title": "Amazing Quality!", "text": '"Absolutely love this product! Exceeded all my expectations." — Sarah M.', "avatar": "👩‍🦰"},
        {"title": "Best Purchase Ever", "text": '"Fast shipping and incredible quality. Will buy again!" — James R.', "avatar": "👨‍🦱"},
        {"title": "Highly Recommend", "text": '"Perfect in every way. My friends are all ordering one too!" — Emily K.', "avatar": "👩"},
    ]
    test_items = items or default_items

    cards_html = ""
    avatars = ["👩‍🦰", "👨‍🦱", "👩", "👨", "👩‍🦳", "🧑"]
    for i, item in enumerate(test_items):
        title = _esc(item.get("title", ""))
        # Clean text: strip <p> tags if present
        raw_text = item.get("text", "")
        if isinstance(raw_text, str):
            raw_text = raw_text.replace("<p>", "").replace("</p>", "").replace("<br>", " ").strip()
        text = _esc(raw_text)
        avatar = item.get("avatar", avatars[i % len(avatars)])
        cards_html += f"""
    <div class="ai-pb-test-card ai-pb-animate" style="animation-delay:{i*0.15}s">
      <div class="ai-pb-test-avatar">{avatar}</div>
      <div class="ai-pb-test-stars">★★★★★</div>
      <blockquote class="ai-pb-test-quote">{text}</blockquote>
      <div class="ai-pb-test-name">{title}</div>
    </div>"""

    return f"""
<style>
  .ai-pb-testimonials {{
    font-family: var(--ai-font);
    padding: 3.5rem 1.5rem;
    background: var(--ai-bg-soft);
    text-align: center;
  }}
  .ai-pb-testimonials > h2 {{
    font-size: clamp(1.5rem, 3.5vw, 2.2rem);
    font-weight: 800;
    color: var(--ai-accent);
    margin: 0 0 2rem;
  }}
  .ai-pb-test-grid {{
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
    justify-content: center;
    max-width: 1100px;
    margin: 0 auto;
  }}
  .ai-pb-test-card {{
    background: #fff;
    border: 2px solid rgba(var(--ai-accent-rgb), 0.15);
    border-radius: var(--ai-radius-lg);
    padding: 1.5rem;
    max-width: 340px;
    min-width: 260px;
    flex: 1 1 280px;
    box-shadow: var(--ai-shadow);
    opacity: 0;
    transform: translateY(30px);
    transition: transform 0.3s, box-shadow 0.3s;
  }}
  .ai-pb-test-card.ai-pb-visible {{
    opacity: 1;
    transform: translateY(0);
    transition: opacity 0.6s ease, transform 0.6s ease;
  }}
  .ai-pb-test-card:hover {{
    transform: translateY(-4px);
    box-shadow: var(--ai-shadow-lg);
  }}
  .ai-pb-test-avatar {{
    font-size: 2.8rem;
    margin-bottom: 0.5rem;
  }}
  .ai-pb-test-stars {{
    color: #FFD700;
    font-size: 1.2rem;
    margin-bottom: 0.5rem;
    letter-spacing: 2px;
  }}
  .ai-pb-test-quote {{
    font-style: italic;
    color: var(--ai-text);
    font-size: 1.05rem;
    line-height: 1.7;
    margin: 0.5rem 0;
    padding: 0;
    border: none;
  }}
  .ai-pb-test-name {{
    color: var(--ai-accent);
    font-weight: 700;
    margin-top: 0.5rem;
    font-size: 1rem;
  }}
</style>
<div class="ai-pb-testimonials">
  <h2>{h}</h2>
  <div class="ai-pb-test-grid">
    {cards_html}
  </div>
</div>
{_SCROLL_REVEAL_JS}
"""


# ─────────────────────────── FAQ ───────────────────────────

def render_faq(
    *,
    heading: str = "",
    items: list[dict] | None = None,
    accent: str = "#6C27B0",
    accent_light: str = "#9C4DCC",
) -> str:
    h = _esc(heading or "Frequently Asked Questions")
    default_items = [
        {"heading": "What materials is this made from?", "text": "Crafted from premium, high-quality materials designed for lasting durability."},
        {"heading": "How long does shipping take?", "text": "Free express shipping on all orders. Most orders arrive within 2-3 business days."},
        {"heading": "What is your return policy?", "text": "30-day hassle-free return policy. If not satisfied, return for a full refund."},
        {"heading": "Is this suitable as a gift?", "text": "Absolutely! Makes a perfect gift. We also offer gift wrapping at checkout."},
    ]
    faq_data = items or default_items

    items_html = ""
    for i, item in enumerate(faq_data):
        question = _esc(item.get("heading", item.get("title", f"Question {i+1}")))
        # Clean answer text
        answer_raw = item.get("text", item.get("row_content", ""))
        if isinstance(answer_raw, str):
            answer_raw = answer_raw.replace("<p>", "").replace("</p>", "").replace("<br>", " ").strip()
        answer = _esc(answer_raw)
        checked = "checked" if i == 0 else ""
        items_html += f"""
    <div class="ai-pb-faq-item">
      <input type="checkbox" id="ai-faq-{i}" class="ai-pb-faq-toggle" {checked}>
      <label for="ai-faq-{i}" class="ai-pb-faq-q">
        <span>{question}</span>
        <span class="ai-pb-faq-chevron">▶</span>
      </label>
      <div class="ai-pb-faq-a">
        <p>{answer}</p>
      </div>
    </div>"""

    return f"""
<style>
  .ai-pb-faq {{
    font-family: var(--ai-font);
    padding: 3.5rem 1.5rem;
    background: var(--ai-bg);
    text-align: center;
  }}
  .ai-pb-faq > h2 {{
    font-size: clamp(1.5rem, 3.5vw, 2.2rem);
    font-weight: 800;
    color: var(--ai-accent);
    margin: 0 0 2rem;
  }}
  .ai-pb-faq-list {{
    max-width: 750px;
    margin: 0 auto;
    text-align: left;
  }}
  .ai-pb-faq-item {{
    border: 2px solid rgba(var(--ai-accent-rgb), 0.1);
    border-radius: var(--ai-radius);
    margin-bottom: 0.8rem;
    overflow: hidden;
    background: #fff;
    box-shadow: 0 2px 8px rgba(0,0,0,0.03);
    transition: box-shadow 0.3s;
  }}
  .ai-pb-faq-item:hover {{
    box-shadow: var(--ai-shadow);
  }}
  .ai-pb-faq-toggle {{
    display: none;
  }}
  .ai-pb-faq-q {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.2rem 1.5rem;
    cursor: pointer;
    font-weight: 700;
    font-size: 1.05rem;
    color: var(--ai-text);
    transition: color 0.2s;
    user-select: none;
  }}
  .ai-pb-faq-q:hover {{
    color: var(--ai-accent);
  }}
  .ai-pb-faq-chevron {{
    font-size: 0.8rem;
    transition: transform 0.3s;
    color: var(--ai-accent);
  }}
  .ai-pb-faq-toggle:checked ~ .ai-pb-faq-q .ai-pb-faq-chevron {{
    transform: rotate(90deg);
  }}
  .ai-pb-faq-a {{
    max-height: 0;
    overflow: hidden;
    transition: max-height 0.4s ease, padding 0.3s ease;
    padding: 0 1.5rem;
  }}
  .ai-pb-faq-toggle:checked ~ .ai-pb-faq-a {{
    max-height: 300px;
    padding: 0 1.5rem 1.2rem;
  }}
  .ai-pb-faq-a p {{
    margin: 0;
    font-size: 1rem;
    color: var(--ai-text-light);
    line-height: 1.7;
  }}
</style>
<div class="ai-pb-faq">
  <h2>{h}</h2>
  <div class="ai-pb-faq-list">
    {items_html}
  </div>
</div>
"""


# ─────────────────────────── CTA ───────────────────────────

def render_cta(
    *,
    heading: str = "",
    subheading: str = "",
    button_label: str = "Order Now",
    button_link: str = "",
    product_handle: str = "",
    accent: str = "#6C27B0",
    accent_light: str = "#9C4DCC",
) -> str:
    h = _esc(heading or "Ready to Make It Yours?")
    sub_raw = subheading or "Order now and experience the difference. Limited stock available!"
    if isinstance(sub_raw, str):
        sub_raw = sub_raw.replace("<p>", "").replace("</p>", "").strip()
    sub = _esc(sub_raw)
    btn = _esc(button_label or "Order Now")
    link = _esc(button_link or (f"/products/{product_handle}" if product_handle else "/collections/all"))

    return f"""
<style>
  .ai-pb-cta {{
    font-family: var(--ai-font);
    background: linear-gradient(135deg, var(--ai-accent) 0%, var(--ai-accent-light) 100%);
    padding: 4rem 1.5rem;
    text-align: center;
    color: #fff;
    position: relative;
    overflow: hidden;
  }}
  .ai-pb-cta::before {{
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0; bottom: 0;
    background: radial-gradient(ellipse at 30% 50%, rgba(255,255,255,0.1) 0%, transparent 60%);
  }}
  .ai-pb-cta-inner {{
    position: relative;
    z-index: 1;
    max-width: 700px;
    margin: 0 auto;
  }}
  .ai-pb-cta h2 {{
    font-size: clamp(1.6rem, 4vw, 2.5rem);
    font-weight: 900;
    margin: 0 0 1rem;
    text-shadow: 0 2px 15px rgba(0,0,0,0.2);
  }}
  .ai-pb-cta p {{
    font-size: 1.15rem;
    margin: 0 0 2rem;
    opacity: 0.9;
    line-height: 1.6;
  }}
  .ai-pb-cta-btn {{
    display: inline-block;
    background: #fff;
    color: var(--ai-accent);
    padding: 1.1rem 3rem;
    font-size: 1.25rem;
    font-weight: 800;
    border: none;
    border-radius: 60px;
    text-decoration: none;
    cursor: pointer;
    box-shadow: 0 8px 30px rgba(0,0,0,0.2);
    transition: transform 0.3s, box-shadow 0.3s;
    animation: ai-cta-pulse 2s infinite ease-in-out;
  }}
  .ai-pb-cta-btn:hover {{
    transform: scale(1.06);
    box-shadow: 0 12px 40px rgba(0,0,0,0.3);
  }}
  @keyframes ai-cta-pulse {{
    0%,100% {{ transform: scale(1); }}
    50% {{ transform: scale(1.04); }}
  }}
  .ai-pb-cta-urgency {{
    margin-top: 1rem;
    font-size: 0.9rem;
    opacity: 0.8;
  }}
</style>
<div class="ai-pb-cta">
  <div class="ai-pb-cta-inner">
    <h2>{h}</h2>
    <p>{sub}</p>
    <a href="{link}" class="ai-pb-cta-btn">🛒 {btn}</a>
    <div class="ai-pb-cta-urgency">⚡ Limited stock — order before it's gone!</div>
  </div>
</div>
"""


# ─────────────────────────── Countdown ───────────────────────────

def render_countdown(
    *,
    heading: str = "",
    subheading: str = "",
    button_label: str = "Grab the Deal",
    button_link: str = "",
    product_handle: str = "",
    product_title: str = "",
    accent: str = "#6C27B0",
    accent_light: str = "#9C4DCC",
) -> str:
    h = _esc(heading or "🔥 Limited Time Offer")
    sub = _esc(subheading or f"Don't miss out — this deal won't last!")
    btn = _esc(button_label or "Grab the Deal")
    link = _esc(button_link or (f"/products/{product_handle}" if product_handle else "/collections/all"))

    return f"""
<style>
  .ai-pb-countdown {{
    font-family: var(--ai-font);
    background: linear-gradient(135deg, #1a1a2e, #16213e, #0f3460);
    padding: 3.5rem 1.5rem;
    text-align: center;
    color: #fff;
    border-radius: 0;
  }}
  .ai-pb-countdown h2 {{
    font-size: clamp(1.5rem, 3.5vw, 2.2rem);
    font-weight: 800;
    margin: 0 0 0.5rem;
  }}
  .ai-pb-countdown > p {{
    font-size: 1.1rem;
    color: #ccc;
    margin: 0 0 2rem;
  }}
  .ai-pb-cd-timer {{
    display: flex;
    justify-content: center;
    gap: 1rem;
    margin-bottom: 2rem;
  }}
  .ai-pb-cd-box {{
    background: rgba(255,255,255,0.1);
    backdrop-filter: blur(10px);
    padding: 1rem 1.5rem;
    border-radius: var(--ai-radius);
    min-width: 70px;
    border: 1px solid rgba(255,255,255,0.1);
  }}
  .ai-pb-cd-num {{
    font-size: 2.5rem;
    font-weight: 900;
    display: block;
    color: #fff;
  }}
  .ai-pb-cd-label {{
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: #aaa;
    margin-top: 0.3rem;
    display: block;
  }}
  .ai-pb-cd-btn {{
    display: inline-block;
    background: linear-gradient(90deg, #e74c3c, #ff6b6b);
    color: #fff;
    padding: 1rem 2.5rem;
    font-size: 1.15rem;
    font-weight: 800;
    border: none;
    border-radius: 60px;
    text-decoration: none;
    cursor: pointer;
    box-shadow: 0 6px 20px rgba(231,76,60,0.4);
    transition: transform 0.3s;
    animation: ai-cd-pulse 1.8s infinite ease-in-out;
  }}
  .ai-pb-cd-btn:hover {{ transform: scale(1.05); }}
  @keyframes ai-cd-pulse {{
    0%,100% {{ transform: scale(1); }}
    50% {{ transform: scale(1.05); }}
  }}
  @media (max-width: 480px) {{
    .ai-pb-cd-box {{ padding: 0.8rem 1rem; min-width: 55px; }}
    .ai-pb-cd-num {{ font-size: 1.8rem; }}
  }}
</style>
<div class="ai-pb-countdown">
  <h2>{h}</h2>
  <p>{sub}</p>
  <div class="ai-pb-cd-timer">
    <div class="ai-pb-cd-box"><span class="ai-pb-cd-num" id="ai-cd-h">23</span><span class="ai-pb-cd-label">Hours</span></div>
    <div class="ai-pb-cd-box"><span class="ai-pb-cd-num" id="ai-cd-m">59</span><span class="ai-pb-cd-label">Minutes</span></div>
    <div class="ai-pb-cd-box"><span class="ai-pb-cd-num" id="ai-cd-s">59</span><span class="ai-pb-cd-label">Seconds</span></div>
  </div>
  <a href="{link}" class="ai-pb-cd-btn">⚡ {btn} →</a>
</div>
{{% raw %}}
<script>
(function(){{
  var h=document.getElementById("ai-cd-h"),m=document.getElementById("ai-cd-m"),s=document.getElementById("ai-cd-s");
  if(!h||!m||!s)return;var t=86399;
  setInterval(function(){{t--;if(t<0)t=86399;
    h.textContent=String(Math.floor(t/3600)).padStart(2,"0");
    m.textContent=String(Math.floor((t%3600)/60)).padStart(2,"0");
    s.textContent=String(t%60).padStart(2,"0");
  }},1000);
}})();
</script>
{{% endraw %}}
"""


# ─────────────────────────── Guarantee ───────────────────────────

def render_guarantee(
    *,
    heading: str = "",
    subheading: str = "",
    product_title: str = "",
    accent: str = "#6C27B0",
    accent_light: str = "#9C4DCC",
) -> str:
    h = _esc(heading or "100% Satisfaction Guaranteed")
    sub_raw = subheading or f"We stand behind every product we sell. If you're not completely satisfied, return it within 30 days for a full refund — no questions asked."
    if isinstance(sub_raw, str):
        sub_raw = sub_raw.replace("<p>", "").replace("</p>", "").strip()
    sub = _esc(sub_raw)

    return f"""
<style>
  .ai-pb-guarantee {{
    font-family: var(--ai-font);
    padding: 3.5rem 1.5rem;
    background: var(--ai-bg-soft);
    text-align: center;
  }}
  .ai-pb-guarantee-card {{
    max-width: 700px;
    margin: 0 auto;
    background: #fff;
    border-radius: var(--ai-radius-lg);
    padding: 2.5rem 2rem;
    border: 2px solid rgba(var(--ai-accent-rgb), 0.15);
    box-shadow: var(--ai-shadow);
  }}
  .ai-pb-guarantee-shield {{
    font-size: 3.5rem;
    margin-bottom: 1rem;
  }}
  .ai-pb-guarantee-card h2 {{
    font-size: clamp(1.4rem, 3vw, 1.8rem);
    font-weight: 800;
    color: var(--ai-accent);
    margin: 0 0 1rem;
  }}
  .ai-pb-guarantee-card p {{
    font-size: 1.05rem;
    color: var(--ai-text-light);
    line-height: 1.7;
    margin: 0 0 1.5rem;
  }}
  .ai-pb-guarantee-badges {{
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    justify-content: center;
  }}
  .ai-pb-guarantee-badge {{
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--ai-bg-soft);
    padding: 0.6rem 1.2rem;
    border-radius: 40px;
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--ai-text);
  }}
</style>
<div class="ai-pb-guarantee">
  <div class="ai-pb-guarantee-card ai-pb-animate">
    <div class="ai-pb-guarantee-shield">🛡️</div>
    <h2>{h}</h2>
    <p>{sub}</p>
    <div class="ai-pb-guarantee-badges">
      <span class="ai-pb-guarantee-badge">🔒 Secure Checkout</span>
      <span class="ai-pb-guarantee-badge">📦 Free Returns</span>
      <span class="ai-pb-guarantee-badge">⭐ Premium Quality</span>
      <span class="ai-pb-guarantee-badge">💬 24/7 Support</span>
    </div>
  </div>
</div>
{_SCROLL_REVEAL_JS}
"""


# ─────────────────────────── Comparison ───────────────────────────

def render_comparison(
    *,
    heading: str = "",
    items: list[dict] | None = None,
    product_title: str = "",
    accent: str = "#6C27B0",
    accent_light: str = "#9C4DCC",
) -> str:
    display_title = _esc(product_title or "Our Product")
    h = _esc(heading or "See the Difference")
    default_items = [
        {"title": f"Without {product_title or 'Us'}", "text": "❌ Ordinary quality\n❌ Slow delivery\n❌ No guarantee\n❌ Generic design"},
        {"title": f"With {product_title or 'Us'}", "text": "✅ Premium quality\n✅ Fast free shipping\n✅ 30-day guarantee\n✅ Unique, stylish design"},
    ]
    comp_items = items or default_items
    without = comp_items[0] if len(comp_items) > 0 else default_items[0]
    with_item = comp_items[1] if len(comp_items) > 1 else default_items[1]

    def _format_lines(text: str) -> str:
        raw = text.replace("<p>", "").replace("</p>", "").replace("<br>", "\n").strip()
        lines = [_esc(l.strip()) for l in raw.split("\n") if l.strip()]
        return "".join(f"<div class='ai-pb-comp-line'>{l}</div>" for l in lines)

    without_title = _esc(without.get("title", "Without"))
    with_title = _esc(with_item.get("title", "With"))
    without_lines = _format_lines(without.get("text", ""))
    with_lines = _format_lines(with_item.get("text", ""))

    return f"""
<style>
  .ai-pb-comparison {{
    font-family: var(--ai-font);
    padding: 3.5rem 1.5rem;
    background: var(--ai-bg);
    text-align: center;
  }}
  .ai-pb-comparison > h2 {{
    font-size: clamp(1.5rem, 3.5vw, 2.2rem);
    font-weight: 800;
    color: var(--ai-accent);
    margin: 0 0 2rem;
  }}
  .ai-pb-comp-grid {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
    max-width: 800px;
    margin: 0 auto;
  }}
  @media (max-width: 600px) {{
    .ai-pb-comp-grid {{ grid-template-columns: 1fr; }}
  }}
  .ai-pb-comp-col {{
    border-radius: var(--ai-radius-lg);
    padding: 2rem 1.5rem;
    text-align: left;
  }}
  .ai-pb-comp-col.without {{
    background: #fff5f5;
    border: 2px solid #ffcccc;
  }}
  .ai-pb-comp-col.with {{
    background: #f0fdf4;
    border: 2px solid #bbf7d0;
    box-shadow: var(--ai-shadow);
  }}
  .ai-pb-comp-col h3 {{
    font-size: 1.2rem;
    font-weight: 800;
    margin: 0 0 1rem;
    padding-bottom: 0.8rem;
    border-bottom: 2px solid rgba(0,0,0,0.08);
  }}
  .ai-pb-comp-col.without h3 {{ color: #dc2626; }}
  .ai-pb-comp-col.with h3 {{ color: #16a34a; }}
  .ai-pb-comp-line {{
    padding: 0.5rem 0;
    font-size: 1rem;
    font-weight: 500;
    line-height: 1.5;
    color: var(--ai-text);
  }}
</style>
<div class="ai-pb-comparison">
  <h2>{h}</h2>
  <div class="ai-pb-comp-grid">
    <div class="ai-pb-comp-col without ai-pb-animate">
      <h3>😞 {without_title}</h3>
      {without_lines}
    </div>
    <div class="ai-pb-comp-col with ai-pb-animate">
      <h3>🎉 {with_title}</h3>
      {with_lines}
    </div>
  </div>
</div>
{_SCROLL_REVEAL_JS}
"""


# ─────────────────────────── Why Us ───────────────────────────

def render_why_us(
    *,
    heading: str = "",
    items: list[dict] | None = None,
    accent: str = "#6C27B0",
    accent_light: str = "#9C4DCC",
) -> str:
    h = _esc(heading or "Why Choose Us?")
    default_items = [
        {"title": "🚚 Fast Shipping", "text": "Express delivery to all cities"},
        {"title": "🔄 Free Exchanges", "text": "Easy size exchanges at no cost"},
        {"title": "💬 24/7 Support", "text": "Instant customer service anytime"},
        {"title": "💵 Cash on Delivery", "text": "Pay when you receive your order"},
        {"title": "✅ Quality Guaranteed", "text": "100% premium quality assured"},
    ]
    why_items = items or default_items

    cards_html = ""
    for i, item in enumerate(why_items):
        title = _esc(item.get("title", ""))
        text = _esc(item.get("text", ""))
        cards_html += f"""
    <div class="ai-pb-why-card ai-pb-animate" style="animation-delay:{i*0.1}s">
      <div class="ai-pb-why-title">{title}</div>
      <div class="ai-pb-why-text">{text}</div>
    </div>"""

    return f"""
<style>
  .ai-pb-why-us {{
    font-family: var(--ai-font);
    padding: 3.5rem 1.5rem;
    background: linear-gradient(180deg, var(--ai-bg-soft), var(--ai-bg));
    text-align: center;
  }}
  .ai-pb-why-us > h2 {{
    font-size: clamp(1.5rem, 3.5vw, 2.2rem);
    font-weight: 800;
    color: var(--ai-accent);
    margin: 0 0 2rem;
  }}
  .ai-pb-why-grid {{
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    justify-content: center;
    max-width: 900px;
    margin: 0 auto;
  }}
  .ai-pb-why-card {{
    background: #fff;
    border: 2px solid rgba(var(--ai-accent-rgb), 0.12);
    border-radius: var(--ai-radius);
    padding: 1rem 1.5rem;
    min-width: 230px;
    flex: 1 1 230px;
    max-width: 280px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    transition: transform 0.3s, box-shadow 0.3s;
    opacity: 0;
    transform: translateY(20px);
  }}
  .ai-pb-why-card.ai-pb-visible {{
    opacity: 1;
    transform: translateY(0);
    transition: opacity 0.5s ease, transform 0.5s ease;
  }}
  .ai-pb-why-card:hover {{
    transform: translateY(-4px);
    box-shadow: var(--ai-shadow);
  }}
  .ai-pb-why-title {{
    font-weight: 700;
    font-size: 1.05rem;
    color: var(--ai-accent);
  }}
  .ai-pb-why-text {{
    font-size: 0.9rem;
    color: var(--ai-text-light);
  }}
</style>
<div class="ai-pb-why-us">
  <h2>{h}</h2>
  <div class="ai-pb-why-grid">
    {cards_html}
  </div>
</div>
{_SCROLL_REVEAL_JS}
"""


# ─────────────────────────── Promo Banner ───────────────────────────

def render_promo_banner(
    *,
    heading: str = "",
    subheading: str = "",
    accent: str = "#6C27B0",
    accent_light: str = "#9C4DCC",
) -> str:
    h = _esc(heading or "🎉 Special Offer — Limited Time Only!")
    sub = _esc(subheading or "Get an exclusive discount on your purchase today.")

    return f"""
<style>
  .ai-pb-promo {{
    font-family: var(--ai-font);
    background: linear-gradient(90deg, #fff3cd, #ffe8a1);
    padding: 1.2rem 1.5rem;
    text-align: center;
    border-bottom: 3px solid #ffc107;
  }}
  .ai-pb-promo h2 {{
    font-size: clamp(1.2rem, 3vw, 1.6rem);
    font-weight: 800;
    color: var(--ai-accent);
    margin: 0 0 0.3rem;
  }}
  .ai-pb-promo p {{
    font-size: 1rem;
    color: #856404;
    margin: 0;
    font-weight: 600;
  }}
</style>
<div class="ai-pb-promo">
  <h2>{h}</h2>
  <p>{sub}</p>
</div>
"""


# ─────────────────────────── Image + Text ───────────────────────────

def render_image_text(
    *,
    heading: str = "",
    subheading: str = "",
    product_title: str = "",
    accent: str = "#6C27B0",
    accent_light: str = "#9C4DCC",
) -> str:
    h = _esc(heading or f"Why {product_title or 'This Product'}?")
    sub_raw = subheading or "Experience premium quality and thoughtful design. Combining style with functionality for the perfect everyday companion."
    if isinstance(sub_raw, str):
        sub_raw = sub_raw.replace("<p>", "").replace("</p>", "").strip()
    sub = _esc(sub_raw)

    return f"""
<style>
  .ai-pb-imgtext {{
    font-family: var(--ai-font);
    padding: 3.5rem 1.5rem;
    background: var(--ai-bg);
  }}
  .ai-pb-imgtext-inner {{
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2.5rem;
    max-width: 1000px;
    margin: 0 auto;
    align-items: center;
  }}
  @media (max-width: 700px) {{
    .ai-pb-imgtext-inner {{ grid-template-columns: 1fr; text-align: center; }}
  }}
  .ai-pb-imgtext-img {{
    background: var(--ai-bg-soft);
    border-radius: var(--ai-radius-lg);
    min-height: 300px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 4rem;
    box-shadow: var(--ai-shadow);
  }}
  .ai-pb-imgtext-content h2 {{
    font-size: clamp(1.4rem, 3vw, 2rem);
    font-weight: 800;
    color: var(--ai-accent);
    margin: 0 0 1rem;
  }}
  .ai-pb-imgtext-content p {{
    font-size: 1.05rem;
    color: var(--ai-text-light);
    line-height: 1.8;
    margin: 0;
  }}
</style>
<div class="ai-pb-imgtext">
  <div class="ai-pb-imgtext-inner ai-pb-animate">
    <div class="ai-pb-imgtext-img">📸</div>
    <div class="ai-pb-imgtext-content">
      <h2>{h}</h2>
      <p>{sub}</p>
    </div>
  </div>
</div>
{_SCROLL_REVEAL_JS}
"""


# ─────────────────────────── Description ───────────────────────────

def render_description(
    *,
    heading: str = "",
    subheading: str = "",
    product_title: str = "",
    accent: str = "#6C27B0",
    accent_light: str = "#9C4DCC",
) -> str:
    h = _esc(heading or f"About {product_title or 'This Product'}")
    sub_raw = subheading or f"Discover everything you need to know. Premium quality, thoughtful design, and exceptional value — all in one product."
    if isinstance(sub_raw, str):
        sub_raw = sub_raw.replace("<p>", "").replace("</p>", "").strip()
    sub = _esc(sub_raw)

    return f"""
<style>
  .ai-pb-desc {{
    font-family: var(--ai-font);
    padding: 3.5rem 1.5rem;
    background: var(--ai-bg-soft);
    text-align: center;
  }}
  .ai-pb-desc-inner {{
    max-width: 750px;
    margin: 0 auto;
  }}
  .ai-pb-desc h2 {{
    font-size: clamp(1.4rem, 3vw, 2rem);
    font-weight: 800;
    color: var(--ai-accent);
    margin: 0 0 1.5rem;
  }}
  .ai-pb-desc p {{
    font-size: 1.1rem;
    color: var(--ai-text-light);
    line-height: 1.8;
    margin: 0;
  }}
</style>
<div class="ai-pb-desc">
  <div class="ai-pb-desc-inner ai-pb-animate">
    <h2>{h}</h2>
    <p>{sub}</p>
  </div>
</div>
{_SCROLL_REVEAL_JS}
"""


# ─────────────────────────── Product (Custom Liquid) ───────────────────────────

def render_product(
    *,
    product_handle: str = "",
    heading: str = "",
    subheading: str = "",
    accent: str = "#6C27B0",
    accent_light: str = "#9C4DCC",
    product_title: str = "",
) -> str:
    """Generate a full custom product section using Shopify Liquid.

    Uses Liquid ``all_products[handle]`` to pull real product data at render time.
    Supports color swatches, size pills, image gallery, AJAX add-to-cart, and buy-it-now.
    """
    handle = _esc(product_handle)
    accent_rgb = _hex_to_rgb(accent)

    # Use plain string with placeholder tokens — avoids f-string / Liquid brace conflicts
    template = (
        '<style>'
        ':root{--aip-accent:__ACCENT__;--aip-accent-light:__ACCENT_LIGHT__;--aip-accent-rgb:__ACCENT_RGB__;}'
        '.aip-product{font-family:var(--ai-font,"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif);padding:2rem 1rem;background:#fff}'
        '.aip-product-inner{max-width:1100px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:2.5rem;align-items:start}'
        '@media(max-width:768px){.aip-product-inner{grid-template-columns:1fr;gap:1.5rem}.aip-main-img{aspect-ratio:auto}.aip-thumb{width:56px;height:56px}}'
        '.aip-gallery{position:relative}'
        '.aip-main-img{width:100%;border-radius:1rem;overflow:hidden;background:#f8f9fc;aspect-ratio:4/5;display:flex;align-items:center;justify-content:center}'
        '.aip-main-img img{width:100%;height:100%;object-fit:contain;transition:opacity .3s}'
        '.aip-thumbs{display:flex;gap:.5rem;margin-top:.75rem;overflow-x:auto;padding-bottom:.5rem}'
        '.aip-thumbs::-webkit-scrollbar{height:4px}.aip-thumbs::-webkit-scrollbar-thumb{background:rgba(var(--aip-accent-rgb),.3);border-radius:4px}'
        '.aip-thumb{width:70px;height:70px;border-radius:.6rem;overflow:hidden;border:2px solid transparent;cursor:pointer;flex-shrink:0;transition:border-color .2s,transform .2s;background:#f8f9fc;padding:0}'
        '.aip-thumb:hover{transform:scale(1.05)}'
        '.aip-thumb.active{border-color:var(--aip-accent);box-shadow:0 0 0 2px rgba(var(--aip-accent-rgb),.2)}'
        '.aip-thumb img{width:100%;height:100%;object-fit:cover}'
        '.aip-sale-flag{position:absolute;top:12px;left:12px;background:#ef4444;color:#fff;font-size:.75rem;font-weight:700;padding:.3rem .8rem;border-radius:999px;z-index:2}'
        '.aip-info{display:flex;flex-direction:column;gap:1.2rem}'
        '.aip-title{font-size:clamp(1.4rem,3.5vw,2rem);font-weight:800;color:#1a1a2e;margin:0;line-height:1.25}'
        '.aip-price-row{display:flex;align-items:baseline;gap:.75rem;flex-wrap:wrap}'
        '.aip-price{font-size:1.6rem;font-weight:800;color:var(--aip-accent)}'
        '.aip-compare{font-size:1.1rem;color:#999;text-decoration:line-through}'
        '.aip-save-badge{font-size:.75rem;font-weight:700;background:#fef2f2;color:#dc2626;padding:.25rem .7rem;border-radius:999px}'
        '.aip-option-group{display:flex;flex-direction:column;gap:.5rem}'
        '.aip-option-label{font-size:.85rem;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:.05em}'
        '.aip-option-label span{color:#1a1a2e;font-weight:700;text-transform:none}'
        '.aip-option-values{display:flex;flex-wrap:wrap;gap:.5rem}'
        '.aip-size-btn{padding:.55rem 1.2rem;border-radius:999px;border:2px solid #e2e8f0;background:#fff;cursor:pointer;font-size:.9rem;font-weight:600;color:#333;transition:all .2s;font-family:inherit}'
        '.aip-size-btn:hover{border-color:var(--aip-accent);color:var(--aip-accent)}'
        '.aip-size-btn.active{background:var(--aip-accent);color:#fff;border-color:var(--aip-accent)}'
        '.aip-size-btn.unavailable{opacity:.35;text-decoration:line-through;cursor:not-allowed}'
        '.aip-color-btn{width:38px;height:38px;border-radius:50%;border:3px solid #e2e8f0;cursor:pointer;position:relative;transition:all .2s;padding:0;background:#ccc;font-size:0}'
        '.aip-color-btn:hover{transform:scale(1.12);box-shadow:0 2px 8px rgba(0,0,0,.15)}'
        '.aip-color-btn.active{border-color:var(--aip-accent);box-shadow:0 0 0 3px rgba(var(--aip-accent-rgb),.25)}'
        '.aip-color-btn.unavailable{opacity:.3;cursor:not-allowed}'
        '.aip-color-btn.unavailable::after{content:"";position:absolute;top:50%;left:-2px;right:-2px;height:2px;background:#666;transform:rotate(-45deg)}'
        '.aip-color-tooltip{position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%);background:#1a1a2e;color:#fff;font-size:.7rem;padding:.2rem .5rem;border-radius:4px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .2s}'
        '.aip-color-btn:hover .aip-color-tooltip{opacity:1}'
        '.aip-qty-row{display:flex;align-items:center;gap:.75rem}'
        '.aip-qty-label{font-size:.85rem;font-weight:600;color:#555;text-transform:uppercase;letter-spacing:.05em}'
        '.aip-qty-ctrl{display:inline-flex;align-items:center;border:2px solid #e2e8f0;border-radius:999px;overflow:hidden}'
        '.aip-qty-btn{width:40px;height:40px;display:flex;align-items:center;justify-content:center;background:#f8f9fc;border:none;cursor:pointer;font-size:1.1rem;font-weight:700;color:#333;transition:background .2s;font-family:inherit}'
        '.aip-qty-btn:hover{background:#e2e8f0}'
        '.aip-qty-input{width:50px;text-align:center;border:none;font-size:1rem;font-weight:600;background:transparent;outline:none;font-family:inherit;-moz-appearance:textfield}'
        '.aip-qty-input::-webkit-outer-spin-button,.aip-qty-input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}'
        '.aip-atc-btn{width:100%;padding:1rem 2rem;font-size:1.1rem;font-weight:700;color:#fff;background:linear-gradient(135deg,var(--aip-accent),var(--aip-accent-light));border:none;border-radius:999px;cursor:pointer;transition:all .3s;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:.5rem;box-shadow:0 4px 15px rgba(var(--aip-accent-rgb),.3);position:relative;overflow:hidden}'
        '.aip-atc-btn:hover{transform:translateY(-2px);box-shadow:0 6px 25px rgba(var(--aip-accent-rgb),.4)}'
        '.aip-atc-btn:active{transform:translateY(0)}'
        '.aip-atc-btn.loading{pointer-events:none;opacity:.7}'
        '.aip-atc-btn.success{background:linear-gradient(135deg,#16a34a,#22c55e)}'
        '@keyframes aip-pulse{0%,100%{box-shadow:0 4px 15px rgba(var(--aip-accent-rgb),.3)}50%{box-shadow:0 4px 25px rgba(var(--aip-accent-rgb),.5)}}'
        '.aip-atc-btn{animation:aip-pulse 2s infinite}'
        '.aip-atc-btn:disabled{opacity:.5;cursor:not-allowed;animation:none}'
        '.aip-buy-btn{width:100%;padding:.85rem 2rem;font-size:.95rem;font-weight:600;color:var(--aip-accent);background:#fff;border:2px solid var(--aip-accent);border-radius:999px;cursor:pointer;transition:all .3s;font-family:inherit}'
        '.aip-buy-btn:hover{background:rgba(var(--aip-accent-rgb),.05)}'
        '.aip-buy-btn:disabled{opacity:.5;cursor:not-allowed}'
        '.aip-trust{display:flex;flex-wrap:wrap;gap:1rem;justify-content:center;padding-top:.5rem}'
        '.aip-trust-item{display:flex;align-items:center;gap:.4rem;font-size:.8rem;font-weight:600;color:#666}'
        '.aip-trust-icon{font-size:1rem}'
        '.aip-desc-toggle{font-size:.85rem;font-weight:600;color:var(--aip-accent);cursor:pointer;background:none;border:none;padding:0;font-family:inherit}'
        '.aip-desc-content{font-size:.95rem;color:#555;line-height:1.7;max-height:0;overflow:hidden;transition:max-height .4s ease}'
        '.aip-desc-content.open{max-height:2000px}'
        '.aip-status{font-size:.85rem;font-weight:600;padding:.4rem 1rem;border-radius:999px;display:inline-flex;align-items:center;gap:.4rem}'
        '.aip-status.in-stock{background:#f0fdf4;color:#16a34a}'
        '.aip-status.out-of-stock{background:#fef2f2;color:#dc2626}'
        '</style>'
        # ── Liquid template ──
        "{% assign product = all_products['__HANDLE__'] %}"
        '{% if product %}'
        '{% assign cv = product.selected_or_first_available_variant %}'
        '<div class="aip-product" id="aip-product-section">'
        '<div class="aip-product-inner">'
        # Gallery
        '<div class="aip-gallery">'
        '{% if cv.compare_at_price > cv.price %}'
        '{% assign save_pct = cv.compare_at_price | minus: cv.price | times: 100 | divided_by: cv.compare_at_price %}'
        '<div class="aip-sale-flag">-{{ save_pct }}%</div>'
        '{% endif %}'
        '<div class="aip-main-img">'
        '<img id="aip-main-img" src="{{ product.featured_image | image_url: width: 900 }}" alt="{{ product.featured_image.alt | default: product.title }}" loading="eager">'
        '</div>'
        '{% if product.images.size > 1 %}'
        '<div class="aip-thumbs">'
        '{% for img in product.images %}'
        '<button type="button" class="aip-thumb {% if forloop.first %}active{% endif %}" data-idx="{{ forloop.index0 }}" data-src="{{ img | image_url: width: 900 }}" data-alt="{{ img.alt | default: product.title }}">'
        '<img src="{{ img | image_url: width: 150 }}" alt="{{ img.alt | default: product.title }}" loading="lazy">'
        '</button>'
        '{% endfor %}'
        '</div>'
        '{% endif %}'
        '</div>'
        # Info
        '<div class="aip-info">'
        '<h2 class="aip-title">{{ product.title }}</h2>'
        '<div class="aip-price-row">'
        '<span class="aip-price" id="aip-price">{{ cv.price | money }}</span>'
        '{% if cv.compare_at_price > cv.price %}'
        '<span class="aip-compare" id="aip-compare">{{ cv.compare_at_price | money }}</span>'
        '<span class="aip-save-badge" id="aip-save">Save {{ cv.compare_at_price | minus: cv.price | money }}</span>'
        '{% endif %}'
        '</div>'
        '<div id="aip-avail">'
        '{% if cv.available %}<span class="aip-status in-stock">\u25cf In Stock</span>'
        '{% else %}<span class="aip-status out-of-stock">\u25cf Sold Out</span>{% endif %}'
        '</div>'
        # Options
        '{% for option in product.options_with_values %}'
        '<div class="aip-option-group">'
        '<div class="aip-option-label">{{ option.name }}: <span id="aip-opt-val-{{ forloop.index0 }}">{{ option.selected_value | default: option.values[0] }}</span></div>'
        '<div class="aip-option-values" data-option-index="{{ forloop.index0 }}" data-option-name="{{ option.name | downcase }}">'
        '{% for val in option.values %}'
        '<button type="button" class="aip-opt-btn {% if forloop.first %}active{% endif %}" data-value="{{ val }}" data-option-index="{{ forloop.index0 }}">{{ val }}</button>'
        '{% endfor %}'
        '</div>'
        '</div>'
        '{% endfor %}'
        # Quantity
        '<div class="aip-qty-row">'
        '<span class="aip-qty-label">Quantity</span>'
        '<div class="aip-qty-ctrl">'
        '<button type="button" class="aip-qty-btn" id="aip-qty-minus">\u2212</button>'
        '<input type="number" class="aip-qty-input" id="aip-qty" value="1" min="1" max="99">'
        '<button type="button" class="aip-qty-btn" id="aip-qty-plus">+</button>'
        '</div>'
        '</div>'
        # Buttons
        '<button type="button" class="aip-atc-btn" id="aip-atc" {% unless cv.available %}disabled{% endunless %}>'
        '<span id="aip-atc-text">\U0001f6d2 Add to Cart</span>'
        '</button>'
        '<button type="button" class="aip-buy-btn" id="aip-buy" {% unless cv.available %}disabled{% endunless %}>'
        '\u26a1 Buy It Now'
        '</button>'
        # Trust
        '<div class="aip-trust">'
        '<span class="aip-trust-item"><span class="aip-trust-icon">\U0001f512</span> Secure Checkout</span>'
        '<span class="aip-trust-item"><span class="aip-trust-icon">\U0001f69a</span> Fast Shipping</span>'
        '<span class="aip-trust-item"><span class="aip-trust-icon">\u21a9\ufe0f</span> Easy Returns</span>'
        '<span class="aip-trust-item"><span class="aip-trust-icon">\U0001f4b3</span> Cash on Delivery</span>'
        '</div>'
        # Description
        '{% if product.description != blank %}'
        '<div>'
        '<button type="button" class="aip-desc-toggle" id="aip-desc-btn">\u25b8 Product Details</button>'
        '<div class="aip-desc-content" id="aip-desc-content">{{ product.description }}</div>'
        '</div>'
        '{% endif %}'
        '</div>'  # /aip-info
        '</div>'  # /aip-product-inner
        '</div>'  # /aip-product
        # ── JavaScript ──
        '{% raw %}'
        '<script>'
        '(function(){'
        # Color map
        'var C={'
        "'red':'#ef4444','blue':'#3b82f6','green':'#22c55e','yellow':'#eab308','orange':'#f97316',"
        "'purple':'#a855f7','pink':'#ec4899','black':'#111','white':'#fff','gray':'#6b7280',"
        "'grey':'#6b7280','brown':'#92400e','beige':'#d2b48c','navy':'#1e3a5f','burgundy':'#800020',"
        "'maroon':'#800000','teal':'#0d9488','coral':'#f87171','gold':'#d4a017','silver':'#c0c0c0',"
        "'ivory':'#fffff0','cream':'#fffdd0','khaki':'#c3b091','olive':'#808000','mint':'#98fb98',"
        "'lavender':'#e6e6fa','turquoise':'#40e0d0','cyan':'#06b6d4','magenta':'#d946ef',"
        "'peach':'#ffdab9','rose':'#f43f5e','charcoal':'#36454f','tan':'#d2b48c',"
        "'wine':'#722f37','rust':'#b7410e','plum':'#9b59b6','sage':'#bcb88a','mauve':'#e0b0ff',"
        "'indigo':'#4f46e5','lilac':'#c8a2c8','fuchsia':'#d946ef',"
        "'light blue':'#93c5fd','light green':'#86efac','light pink':'#f9a8d4','dark blue':'#1e3a5f',"
        "'dark green':'#166534','dark red':'#991b1b','baby blue':'#89cff0','baby pink':'#f4c2c2',"
        "'hot pink':'#ff69b4','royal blue':'#4169e1','forest green':'#228b22',"
        "'nude':'#e3bc9a','camel':'#c19a6b','mustard':'#e2a817','lemon':'#fff44f',"
        "'blush':'#de5d83','cappuccino':'#4b3621','chocolate':'#7b3f00','coffee':'#6f4e37',"
        "'denim':'#1560bd','emerald':'#50c878','sapphire':'#0f52ba','ruby':'#e0115f',"
        "'noir':'#111','blanc':'#fff','rouge':'#ef4444','bleu':'#3b82f6','vert':'#22c55e',"
        "'jaune':'#eab308','gris':'#6b7280','violet':'#a855f7','bordeaux':'#800020',"
        "'creme':'#fffdd0','ivoire':'#fffff0','corail':'#f87171',"
        "'\u0623\u0633\u0648\u062f':'#111','\u0623\u0628\u064a\u0636':'#fff','\u0623\u062d\u0645\u0631':'#ef4444','\u0623\u0632\u0631\u0642':'#3b82f6','\u0623\u062e\u0636\u0631':'#22c55e',"
        "'\u0623\u0635\u0641\u0631':'#eab308','\u0628\u0631\u062a\u0642\u0627\u0644\u064a':'#f97316','\u0648\u0631\u062f\u064a':'#ec4899','\u0628\u0646\u0641\u0633\u062c\u064a':'#a855f7','\u0631\u0645\u0627\u062f\u064a':'#6b7280',"
        "'\u0628\u0646\u064a':'#92400e','\u0628\u064a\u062c':'#d2b48c','\u0643\u062d\u0644\u064a':'#1e3a5f','\u0630\u0647\u0628\u064a':'#d4a017','\u0641\u0636\u064a':'#c0c0c0',"
        "'\u0632\u0647\u0631\u064a':'#f9a8d4','\u062a\u0631\u0643\u0648\u0627\u0632':'#40e0d0','\u0639\u0646\u0627\u0628\u064a':'#800020','\u0643\u0631\u064a\u0645\u064a':'#fffdd0','\u0633\u0645\u0627\u0648\u064a':'#87ceeb',"
        "'\u0632\u064a\u062a\u0648\u0646\u064a':'#808000','\u0646\u0628\u064a\u062a\u064a':'#800020','\u0641\u0648\u0634\u064a\u0627':'#d946ef','\u0645\u0648\u0641':'#e0b0ff'"
        '};'
        'function isColorOpt(n){return /colou?r|\u0644\u0648\u0646|couleur|farbe|renk/.test((n||"").toLowerCase())}'
        # Style buttons
        'document.querySelectorAll(".aip-option-values").forEach(function(g){'
        'var on=g.getAttribute("data-option-name")||"";'
        'if(isColorOpt(on)){'
        'g.querySelectorAll(".aip-opt-btn").forEach(function(b){'
        'var v=(b.getAttribute("data-value")||"").trim(),vl=v.toLowerCase(),h=C[vl];'
        'if(!h){for(var k in C){if(vl.indexOf(k)!==-1||k.indexOf(vl)!==-1){h=C[k];break;}}}'
        'b.classList.add("aip-color-btn");b.classList.remove("aip-size-btn");'
        'b.innerHTML=\'<span class="aip-color-tooltip">\'+v+"</span>";'
        'if(h){if(h.indexOf("gradient")!==-1){b.style.background=h;}else{b.style.backgroundColor=h;}}'
        'if(vl==="white"||vl==="blanc"||vl==="\u0623\u0628\u064a\u0636"||vl==="ivory"||vl==="cream"||vl==="\u0643\u0631\u064a\u0645\u064a"){b.style.borderColor="#ddd";}'
        '});'
        '}else{'
        'g.querySelectorAll(".aip-opt-btn").forEach(function(b){b.classList.add("aip-size-btn");});'
        '}'
        '});'
        # Variant map
        '{% endraw %}'
        'var variants=['
        '{% for v in product.variants %}'
        '{id:{{ v.id }},price:{{ v.price }},cp:{{ v.compare_at_price | default: 0 }},avail:{{ v.available }},img:"{{ v.image | default: product.featured_image | image_url: width: 900 }}",opts:[{% for o in v.options %}"{{ o }}"{% unless forloop.last %},{% endunless %}{% endfor %}]},'
        '{% endfor %}'
        '];'
        '{% raw %}'
        'var selOpts=[];'
        'document.querySelectorAll(".aip-option-values").forEach(function(g){'
        'var f=g.querySelector(".aip-opt-btn.active");'
        'selOpts.push(f?f.getAttribute("data-value"):"");'
        '});'
        'function findV(){for(var i=0;i<variants.length;i++){var v=variants[i],m=true;for(var j=0;j<selOpts.length;j++){if(v.opts[j]!==selOpts[j]){m=false;break;}}if(m)return v;}return null;}'
        'function fmtM(c){return(window.Shopify&&Shopify.formatMoney)?Shopify.formatMoney(c):(c/100).toFixed(2);}'
        # Update UI
        'function updateUI(){'
        'var v=findV(),pe=document.getElementById("aip-price"),ce=document.getElementById("aip-compare"),se=document.getElementById("aip-save"),'
        'ab=document.getElementById("aip-atc"),bb=document.getElementById("aip-buy"),at=document.getElementById("aip-atc-text"),'
        'av=document.getElementById("aip-avail"),mi=document.getElementById("aip-main-img");'
        'if(!v){if(ab)ab.disabled=true;if(bb)bb.disabled=true;if(at)at.textContent="Unavailable";return;}'
        'if(pe)pe.textContent=fmtM(v.price);'
        'if(ce){if(v.cp>v.price){ce.textContent=fmtM(v.cp);ce.style.display="";}else{ce.style.display="none";}}'
        'if(se){if(v.cp>v.price){se.textContent="Save "+fmtM(v.cp-v.price);se.style.display="";}else{se.style.display="none";}}'
        'if(v.avail){if(ab)ab.disabled=false;if(bb)bb.disabled=false;if(at)at.textContent="\U0001f6d2 Add to Cart";'
        'if(av)av.innerHTML=\'<span class="aip-status in-stock">\u25cf In Stock</span>\';}'
        'else{if(ab)ab.disabled=true;if(bb)bb.disabled=true;if(at)at.textContent="Sold Out";'
        'if(av)av.innerHTML=\'<span class="aip-status out-of-stock">\u25cf Sold Out</span>\';}'
        'if(mi&&v.img){mi.src=v.img;document.querySelectorAll(".aip-thumb").forEach(function(t){t.classList.toggle("active",t.getAttribute("data-src")===v.img);});}'
        '}'
        # Option click
        'document.querySelectorAll(".aip-opt-btn").forEach(function(btn){'
        'btn.addEventListener("click",function(){'
        'var idx=parseInt(this.getAttribute("data-option-index")),val=this.getAttribute("data-value");'
        'selOpts[idx]=val;'
        'this.closest(".aip-option-values").querySelectorAll(".aip-opt-btn").forEach(function(b){b.classList.remove("active");});'
        'this.classList.add("active");'
        'var lb=document.getElementById("aip-opt-val-"+idx);if(lb)lb.textContent=val;'
        'updateUI();'
        '});'
        '});'
        # Thumb click
        'document.querySelectorAll(".aip-thumb").forEach(function(t){'
        't.addEventListener("click",function(){'
        'var s=this.getAttribute("data-src"),a=this.getAttribute("data-alt")||"",mi=document.getElementById("aip-main-img");'
        'if(mi){mi.src=s;mi.alt=a;}'
        'document.querySelectorAll(".aip-thumb").forEach(function(x){x.classList.remove("active");});'
        'this.classList.add("active");'
        '});'
        '});'
        # Quantity
        'var qi=document.getElementById("aip-qty"),qm=document.getElementById("aip-qty-minus"),qp=document.getElementById("aip-qty-plus");'
        'if(qm)qm.addEventListener("click",function(){var v=parseInt(qi.value)||1;if(v>1)qi.value=v-1;});'
        'if(qp)qp.addEventListener("click",function(){var v=parseInt(qi.value)||1;if(v<99)qi.value=v+1;});'
        # Add to Cart
        'var atcBtn=document.getElementById("aip-atc");'
        'if(atcBtn)atcBtn.addEventListener("click",function(){'
        'var v=findV();if(!v||!v.avail)return;'
        'var qty=parseInt(qi.value)||1,btn=this,txt=document.getElementById("aip-atc-text");'
        'btn.classList.add("loading");if(txt)txt.textContent="Adding...";'
        'fetch("/cart/add.js",{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify({items:[{id:v.id,quantity:qty}]})})'
        '.then(function(r){return r.json()}).then(function(){'
        'btn.classList.remove("loading");btn.classList.add("success");'
        'if(txt)txt.textContent="\u2713 Added to Cart!";'
        'try{var cc=document.querySelectorAll(".cart-count-bubble span,.header__cart-count,[data-cart-count]");'
        'if(cc.length){fetch("/cart.js").then(function(r){return r.json()}).then(function(c){cc.forEach(function(el){el.textContent=c.item_count;});});}}'
        'catch(e){}'
        'setTimeout(function(){btn.classList.remove("success");if(txt)txt.textContent="\U0001f6d2 Add to Cart";},2000);'
        '}).catch(function(){'
        'btn.classList.remove("loading");if(txt)txt.textContent="Error \u2014 Try Again";'
        'setTimeout(function(){if(txt)txt.textContent="\U0001f6d2 Add to Cart";},2000);'
        '});'
        '});'
        # Buy Now
        'var buyBtn=document.getElementById("aip-buy");'
        'if(buyBtn)buyBtn.addEventListener("click",function(){'
        'var v=findV();if(!v||!v.avail)return;'
        'var qty=parseInt(qi.value)||1;'
        'window.location.href="/cart/"+v.id+":"+qty+"?channel=buy_now";'
        '});'
        # Description toggle
        'var db=document.getElementById("aip-desc-btn"),dc=document.getElementById("aip-desc-content");'
        'if(db&&dc){db.addEventListener("click",function(){var o=dc.classList.toggle("open");db.textContent=o?"\u25be Hide Details":"\u25b8 Product Details";});}'
        '})();'
        '</script>'
        '{% endraw %}'
        '{% endif %}'
    )

    return (
        template
        .replace("__HANDLE__", handle)
        .replace("__ACCENT__", accent)
        .replace("__ACCENT_LIGHT__", accent_light)
        .replace("__ACCENT_RGB__", accent_rgb)
    )

