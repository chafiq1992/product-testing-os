from celery import Celery
from app.integrations.openai_client import gen_angles_and_copy, gen_images, IMAGE_PROMPT
from app.integrations.shopify_client import create_product_and_page
from app.integrations.meta_client import create_campaign_with_ads
from app.config import CELERY_BROKER_URL, CELERY_RESULT_BACKEND
from app import db

celery = Celery(__name__, broker=CELERY_BROKER_URL, backend=CELERY_RESULT_BACKEND)


def run_pipeline_sync(test_id: str, payload: dict):
    """Runs the pipeline inline (no Celery). Safe fallback when broker/worker is unavailable."""
    # Mark running
    db.update_test_status(test_id, "running")
    try:
        trace = []
        # Step 1: Angles & copy
        angles = gen_angles_and_copy(payload)
        trace.append({
            "step": "generate_copy",
            "provider": "openai",
            "request": {"model": "gpt-4o-mini", "payload": payload},
            "response": {"angles": angles},
        })

        # Step 2: Build creatives. Prefer uploaded images if provided; otherwise use AI images
        uploaded = payload.get("uploaded_images") or []
        creatives = []
        image_items = []
        for idx, a in enumerate(angles):
            image_url = None
            if uploaded:
                image_url = uploaded[idx % len(uploaded)]
            else:
                imgs = gen_images(a, payload)
                image_url = imgs[0] if imgs else None
            if image_url:
                creatives.append({"angle": a, "image_url": image_url})
            # capture image generation prompt and result (or uploaded)
            try:
                prompt = IMAGE_PROMPT.format(title=payload.get("title") or "product", angle=a.get("name"))
            except Exception:
                prompt = None
            image_items.append({"angle": a.get("name"), "prompt": prompt, "image_url": image_url})
        if image_items:
            trace.append({
                "step": "gen_images",
                "provider": "openai" if not uploaded else "uploads",
                "request": {"model": "gpt-image-1" if not uploaded else None, "items": [{"angle": it["angle"], "prompt": it["prompt"]} for it in image_items]},
                "response": {"items": image_items},
            })

        # Step 3: Shopify product + page
        page = create_product_and_page(payload, angles, creatives)
        trace.append({
            "step": "shopify",
            "provider": "shopify",
            "request": {"endpoint": "graphql", "notes": "productCreate + pageCreate"},
            "response": {"page": page},
        })

        # Step 4: Meta campaign + ads (paused)
        campaign = create_campaign_with_ads(payload, angles, creatives, page["url"])
        trace.append({
            "step": "meta",
            "provider": "meta",
            "request": {"notes": "campaign/adsets/creatives/ads created"},
            "response": {"campaign_id": campaign.get("campaign_id"), "adsets": campaign.get("adsets")},
        })

        # Persist results
        db.set_test_result(test_id, page, campaign, creatives, angles=angles, trace=trace)
        return {"ok": True, "page": page, "campaign": campaign}
    except Exception as e:
        db.set_test_failed(test_id, {"message": str(e)})
        raise

@celery.task(name="pipeline_launch")
def pipeline_launch(test_id: str, payload: dict):
    # Delegate to the shared sync implementation so both paths stay identical
    return run_pipeline_sync(test_id, payload)
