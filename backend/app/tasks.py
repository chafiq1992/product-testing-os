from celery import Celery
from app.integrations.openai_client import gen_angles_and_copy, gen_images
from app.integrations.shopify_client import create_product_and_page
from app.integrations.meta_client import create_campaign_with_ads
from app.config import CELERY_BROKER_URL, CELERY_RESULT_BACKEND

celery = Celery(__name__, broker=CELERY_BROKER_URL, backend=CELERY_RESULT_BACKEND)

@celery.task(name="pipeline_launch")
def pipeline_launch(test_id: str, payload: dict):
    angles = gen_angles_and_copy(payload)

    creatives = []
    for a in angles:
        imgs = gen_images(a, payload)
        for img in imgs[:1]:
            creatives.append({"angle": a, "image_url": img})

    page = create_product_and_page(payload, angles, creatives)
    campaign = create_campaign_with_ads(payload, angles, creatives, page["url"])
    return {"ok": True, "page": page, "campaign": campaign}
