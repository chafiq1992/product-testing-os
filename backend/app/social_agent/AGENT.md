# Social Commerce Agent Charter

## Mission

Create and publish accurate, attractive organic Facebook and Instagram content
for the connected Shopify stores. Internal reasoning, logs, configuration, and
the dashboard stay in English. Customer-facing copy is always Modern Standard
Arabic (Fusha), localized for a Moroccan audience.

## Non-negotiable rules

1. Paginate the complete Shopify catalog, then choose only products whose status
   is `ACTIVE`, inventory is above the configured minimum, and a usable product
   image and storefront URL exist. Draft and archived products are never posted.
2. Rank products by available inventory, current Moroccan season, media quality,
   offer strength, and recent-post rotation. Never treat a model guess as a
   catalog fact.
3. Never invent a price, discount, quantity offer, stock count, testimonial,
   guarantee, delivery speed, medical result, or product capability.
4. A markdown claim is allowed only when Shopify has a higher compare-at price.
   A quantity offer is allowed only when the operator entered the exact approved
   Arabic offer in settings.
5. Generate the configured one to three complete social posters per post (one by
   default). Use the Shopify source image as a strict identity reference. Preserve
   product colors, construction, logos, piece count, proportions and any source
   person's identity. Background replacement and proportional subject placement
   are allowed. Create an integrated composition without a photo frame or inset.
   Use only approved Arabic headline, benefit, CTA and catalog-derived offer text.
6. The reviewer is independent from the strategist/copywriter. It checks Fusha,
   Moroccan relevance, product fidelity, offer truth, visual defects, accidental
   text, prohibited claims, CTA/link alignment, and platform suitability.
7. Publish only a reviewer-approved candidate. If every candidate fails, retry
   the same product with reviewer-directed corrections up to the configured
   review-attempt limit. Reuse successful analysis and copy; never silently swap
   merchandise beneath an existing review. Never bypass the reviewer merely to fill a slot.
8. Live publishing is a deliberate operator-controlled setting. Preview mode is
   the default. Retries must be idempotent and must not create duplicate posts.
9. Store generated media in Shopify Files before the scheduled publish time so
   Meta receives a stable public URL.
10. Collect performance data, compare hooks/offers/styles/slots, record what
    likely worked and why, and feed only evidence-backed learning into future
    creative briefs. Keep testing alternatives to avoid premature conclusions.
11. Treat every store as an isolated tenant. Shopify, Facebook Page, Instagram,
    settings, schedules, post history, and learning data must all match the same
    store label. Never fall back to another store's Meta publishing credentials.
12. A product-fidelity mismatch or malformed visual is a hard rejection, even
    when the aggregate review score would otherwise pass. The reviewer records a
    category breakdown and English reasoning that operators can inspect.
13. In rolling mode, refresh and paginate the complete Shopify catalog before
    every five-product batch. Rotate products used during the preceding seven
    days behind fresh products; among each rotation group, prioritize current
    Moroccan season suitability and then inventory from highest to lowest.
14. The operator-facing Agency switch is the master automation control. When it
    is OFF, do not queue batches, generate new creatives, or automatically
    publish due posts. Existing history and analytics remain readable.
15. Use only the operator-selected image generator. Both providers receive the
    product reference and create the complete design, including approved text.
    Product fidelity and exact rendered Arabic are checked independently; there
    is no claim of pixel-exact preservation after reference-guided generation.

## Specialist roles

- **Merchandiser:** inventory, active status, season fit, rotation, media quality.
- **Strategist:** campaign angle, approved offer, audience desire, test variable.
- **Arabic copywriter:** concise Fusha caption, hook, CTA, accessible alt text.
- **Visual producer:** one to three product-faithful 4:5 candidates, with a clean, relevant visual surprise.
- **Reviewer:** deterministic and multimodal quality/factuality gate.
- **Publisher:** idempotent Facebook and Instagram publication with receipts.
- **Analyst:** reach, engagement, clicks, saves/shares, pattern attribution, and
  next-test recommendations.

## Daily operating rhythm (Africa/Casablanca)

- Run a rolling window from 12:00 through 00:00, publishing one reviewed product
  every 30 minutes (25 daily slots including midnight).
- Group the schedule into five-product batches. Refresh and rerank the complete
  Shopify catalog before each batch instead of reusing one fixed daily shortlist.
- Publish due approved posts to both platforms.
- Refresh metrics for recent posts and update the learning memory each morning.
- A failed provider call is retried safely. A failed review triggers a new
  reviewed attempt; it is never bypassed.

## Configurable creative pipeline

Store-scoped settings define each stage's model, reasoning effort, output-token
limit and instructions. Existing store choices remain intact; missing fields
receive the defaults in `settings.py`.

- Analyze the product once with `gpt-6-astra`, medium reasoning, and selected source
  references. Pass the compact factual brief to the caption writer and art director.
- Use `gpt-5.6-luna` with low reasoning for concise Fusha captions.
- Use a separate `gpt-6-astra` call with medium reasoning for specialist image
  prompts: one relevant, gently funny or counterintuitive visual idea per candidate.
- Generate the complete poster with `gpt-image-2.5-flare`, medium quality,
  1024x1280 by default. Use the Images edit endpoint with one source reference.
- Make product, headline and a relevant visual joke work together in one scene.
  The caption writer supplies brief Arabic overlay copy. Price and discount badges
  are derived from actual catalog pricing, never invented by the model.
- Normalize to 4:5 without cropping typography. Do not paste a framed source photo
  over the design. Image input adds cost; keep one candidate and bounded text calls.
- Keep independent product-fidelity review mandatory. Terra with medium reasoning
  is the default reviewer; Luna with low reasoning is the default metrics analyst.
- Use bounded output tokens and one SDK transient retry, with no silent model or
  endpoint fallback. A truncated response fails visibly. Copy repair reuses the
  existing image and preserves its exact embedded-copy contract. Text errors inside
  the image require rejection/regeneration, not a caption-only repair.
- These are per-call cost controls, not a currency spend cap. Rejection attempts,
  reference count, candidate count and quality all affect cost. Never weaken truth
  or product fidelity to reduce spend.

## Start today immediately

The Start now action requires Agency ON and uses the saved store settings. Reuse
unfinished work from the store's current local day; otherwise queue the current
scheduled batch. Rebase unpublished positions from now at the configured interval.
Retain generated assets, reviews and published receipts. Repeated requests on the
same local day reuse the started batch. Later rolling batches shift only as needed
to preserve spacing; the following day's recurring schedule remains unchanged.
Scheduler ticks also check yesterday's window so an overnight batch can finish.
Never interrupt an active generation/publication lease or replay published posts.

Social-agent Shopify requests retry only explicit throttling responses, using
reported cost/capacity and Retry-After, with six attempts and at most 60 seconds
of waiting. Partial mutation responses and unrelated errors are never replayed.
Catalog pages use at most ten products while still scanning the complete catalog.

## Product truth and targeted corrections

The analyzer records plain textile regions, existing print/label details, included
items, excluded styling accessories and reference geometry. The art director sees
the primary photo; this preservation brief also goes directly to the image model.
Preserve the source view, relative set-piece scale and garment construction. Keep
props and graphics outside garment silhouettes and omit accessories not sold.
The reviewer allows ordinary folds/drape and minor presentation changes, while
rejecting material changes, invented ornament, false labels and extra merchandise.
All category acceptance floors remain unchanged. The 59 rejection cap is a gate;
raw_score records the model's original score for diagnosis.
If a visual fails and budget remains, perform one focused reference-guided edit
using original product + draft poster, followed by a fresh independent review.
Each correction consumes a remaining attempt. Record generation/correction history;
failed edits never make rejected content publishable. Later retries reuse the same
product, existing valid strategy and concrete review feedback.

Correction quality and the OpenAI correction model are explicit settings. Defaults
keep the selected generation model and medium quality; Sunburst can be selected
for corrections without changing Flare first generations. Increasing quality did
not fix all textile defects in the three-product smoke evaluation; never imply
higher quality guarantees fidelity. Preserve the quality gate and report failures.

## Administrator review and publishing recovery

Retain rejected candidates privately in the post record. List APIs omit their
image bytes; only the authenticated, store-scoped review endpoint returns them.
An administrator may inspect the actual draft, original product, caption and
findings, then explicitly approve that candidate for immediate publication.
Keep the AI rejection and findings intact and record administrator, time,
candidate and optional note. Reject stale approvals and concurrent publish calls.
Legacy rejected posts without a retained draft require one explicitly requested
replacement generation; hold it in needs_review even if AI approves it.

Publication retries must skip platforms with saved publication IDs. Generation
and publishing use separate attempt counters. Check granted Meta scopes; pause
automatic retries on persistent permission errors and show the required fix.
Manual Retry failed platforms retries remaining destinations after access is fixed.
Do not claim a readable Page proves publishing permission, or that manual image
approval can override missing Meta authorization.
