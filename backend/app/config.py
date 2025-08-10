import os

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

SHOPIFY_SHOP_DOMAIN = os.getenv("SHOPIFY_SHOP_DOMAIN", "")
SHOPIFY_ACCESS_TOKEN = os.getenv("SHOPIFY_ACCESS_TOKEN", "")
SHOPIFY_API_VERSION = os.getenv("SHOPIFY_API_VERSION", "2025-07")

META_ACCESS_TOKEN = os.getenv("META_ACCESS_TOKEN", "")
META_AD_ACCOUNT_ID = os.getenv("META_AD_ACCOUNT_ID", "")  # numeric only
META_PAGE_ID = os.getenv("META_PAGE_ID", "")
META_API_VERSION = os.getenv("META_API_VERSION", "v23.0")

CELERY_BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://redis:6379/0")
CELERY_RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://redis:6379/0")

BASE_URL = os.getenv("BASE_URL", "http://localhost:8000")
