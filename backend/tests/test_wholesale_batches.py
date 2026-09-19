import asyncio
import json
from datetime import datetime, timedelta

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import db, main, wholesale_batches as batches, wholesale_publication as publication
from app.integrations import shopify_client as shopify


@pytest.fixture
def pipeline(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    batches.Batch.__table__.create(engine)
    monkeypatch.setattr(db, "SessionLocal", sessionmaker(engine, expire_on_commit=False))
    monkeypatch.setattr(db, "get_app_setting", lambda store, key: {"name": "Preview", "store_type": "shoes"} if key.startswith("wholesale_vendor:") else None)
    events = []
    def analyze(url, model=None, target_category=None):
        events.append(("analyze", url, target_category))
        color = "Red" if url.endswith("one.jpg") else "Blue"
        return {"title": color + " sandals", "benefits": ["Comfortable"], "colors": [color], "product_type": "Sandals", "season": "Summer", "tags": [color]}
    def create(**kwargs):
        events.append(("create", kwargs))
        return {"product": {"id": f"gid://shopify/Product/{len(events)}"}}
    monkeypatch.setattr(main, "gen_product_from_image", analyze)
    monkeypatch.setattr(shopify, "create_product_only", create)
    monkeypatch.setattr(shopify, "configure_variants_for_product", lambda *a, **kw: events.append(("variants", kw)) or {"ok": True})
    monkeypatch.setattr(main, "gen_title_and_description", lambda *a, **kw: {"title": "Final sandals", "description": "Final copy"})
    monkeypatch.setattr(main, "_wholesale_prepare_storefront_images", lambda *a, **kw: events.append(("image", a[1])) or [("clean.png", b"image")])
    monkeypatch.setattr(main, "_wholesale_store_original_image_metafields", lambda *a, **kw: None)
    monkeypatch.setattr(main, "_wholesale_attach_product_to_collection", lambda *a, **kw: None)
    for name in ("update_product_organization", "update_product_title", "update_product_description", "upload_image_attachments_to_product", "publish_product_all_channels"):
        monkeypatch.setattr(shopify, name, lambda *a, _name=name, **kw: events.append((_name, a)) or {"ok": True, "cdn_urls": ["https://example.com/clean.png"]})
    monkeypatch.setattr(publication, "publish_wholesale_product", lambda *a, **kw: events.append(("publish_product_all_channels", a)) or {"ok": True})
    yield events
    engine.dispose()


def request(request_id="unique-request-001", **shared):
    return batches.BatchRequest(request_id=request_id, images=[
        {"image_url": "https://example.com/one.jpg", "name": "one.jpg"},
        {"image_url": "https://example.com/two.jpg", "name": "two.jpg"},
    ], shared={"store_type": "shoes", "size_groups": [
        {"from": "36", "to": "40", "pcs_per_crate": 12, "crate_quantity": 3, "sku": "shared-sku", "sale_price": 20, "compare_at_price": 30},
    ], **shared})


def enqueue(req=None):
    work = BackgroundTasks()
    result = asyncio.run(batches.create_batch("preview", req or request(), work))
    return result["data"]["id"], work


def test_submission_is_fast_and_each_image_uses_existing_pipeline_sequentially(pipeline):
    batch_id, work = enqueue()
    assert pipeline == []  # No analysis or Shopify writes during submission.
    asyncio.run(work())
    job = batches.read_batch("preview", batch_id)
    assert job["status"] == "completed"
    assert job["completed"] == 2
    names = [e[0] for e in pipeline]
    assert names.count("analyze") == 2  # Reuse analysis during finalization.
    assert names.index("publish_product_all_channels") < names.index("analyze", 1)
    variants = [e[1]["variants"][0] for e in pipeline if e[0] == "variants"]
    assert [v["color"] for v in variants] == ["Red", "Blue"]
    for variant in variants:
        assert variant["size"] == "36-40*12pcs"
        assert variant["price"] == 240
        assert variant["compare_at_price"] == 360
        assert variant["quantity"] == 3
        assert variant["sku"] == "shared-sku"
    creates = [e[1] for e in pipeline if e[0] == "create"]
    assert all(c["store"] == main.WHOLESALE_STORE and c["publish"] is False for c in creates)
    assert all("vendor:Preview" in c["tags"] for c in creates)


def test_duplicate_submission_and_worker_claim_do_not_create_duplicates(pipeline):
    batch_id, first = enqueue()
    same_id, second = enqueue()
    assert same_id == batch_id
    async def run():
        await asyncio.gather(first(), second())
    asyncio.run(run())
    assert sum(e[0] == "create" for e in pipeline) == 2
    with pytest.raises(HTTPException) as error:
        enqueue(request(sale_price=99))
    assert error.value.status_code == 409


def test_failed_analysis_continues_and_retry_skips_created_products(pipeline, monkeypatch):
    original = main.gen_product_from_image
    def fail_one(url, *args):
        if url.endswith("one.jpg"):
            raise RuntimeError("provider failure")
        return original(url, *args)
    monkeypatch.setattr(main, "gen_product_from_image", fail_one)
    batch_id, work = enqueue()
    asyncio.run(work())
    job = batches.read_batch("preview", batch_id)
    assert [i["status"] for i in job["items"]] == ["failed", "completed"]
    monkeypatch.setattr(main, "gen_product_from_image", original)
    retry_work = BackgroundTasks()
    asyncio.run(batches.retry_batch("preview", batch_id, retry_work))
    asyncio.run(retry_work())
    assert batches.read_batch("preview", batch_id)["completed"] == 2
    assert sum(e[0] == "create" for e in pipeline) == 2


def test_uncertain_creation_requires_review_and_is_never_retried(pipeline, monkeypatch):
    monkeypatch.setattr(shopify, "create_product_only", lambda **kw: (_ for _ in ()).throw(TimeoutError("ambiguous")))
    batch_id, work = enqueue()
    asyncio.run(work())
    assert all(i["status"] == "needs_review" for i in batches.read_batch("preview", batch_id)["items"])
    retry_work = BackgroundTasks()
    asyncio.run(batches.retry_batch("preview", batch_id, retry_work))
    asyncio.run(retry_work())
    assert sum(e[0] == "analyze" for e in pipeline) == 2


def test_setup_failure_is_visible_without_recreating_product(pipeline, monkeypatch):
    monkeypatch.setattr(shopify, "configure_variants_for_product", lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("stock failed")))
    batch_id, work = enqueue()
    asyncio.run(work())
    job = batches.read_batch("preview", batch_id)
    assert job["completed"] == 0
    assert all(i["status"] == "needs_review" and i["product_id"] for i in job["items"])
    assert not any(e[0] == "publish_product_all_channels" for e in pipeline)


@pytest.mark.parametrize("function,result", [
    ("configure_variants_for_product", {"ok": True, "errors": ["inventory unavailable"]}),
    ("upload_image_attachments_to_product", {"cdn_urls": [], "per_image": [{"ok": False}]}),
    ("publish_product_all_channels", {"ok": False, "error": "publication unavailable"}),
])
def test_provider_error_results_are_not_reported_as_success(pipeline, monkeypatch, function, result):
    target, name = (publication, "publish_wholesale_product") if function == "publish_product_all_channels" else (shopify, function)
    monkeypatch.setattr(target, name, lambda *a, **kw: result)
    batch_id, work = enqueue()
    asyncio.run(work())
    job = batches.read_batch("preview", batch_id)
    assert job["status"] == "completed_with_errors"
    assert job["completed"] == 0
    assert all(i["status"] == "needs_review" for i in job["items"])


def test_shared_single_product_details_do_not_leak_into_batch(pipeline):
    _, work = enqueue(request(title="Old shirt", colors=["Green"], product_type="Shirts", catalog_image_url="https://example.com/old.jpg"))
    asyncio.run(work())
    creates = [e[1] for e in pipeline if e[0] == "create"]
    assert [c["title"] for c in creates] == ["Red sandals", "Blue sandals"]
    assert all(c["product_type"] == "Sandals" for c in creates)


def test_expired_lease_recovers_queued_images_without_recreating_uncertain_one(pipeline):
    batch_id, _ = enqueue()
    token, _, _, items = batches._claim(batch_id)
    items[0]["status"] = "creating"
    batches._checkpoint(batch_id, token, items)
    with db.SessionLocal() as session:
        session.query(batches.Batch).filter_by(id=batch_id).update({"lease_until": datetime.utcnow() - timedelta(seconds=1)})
        session.commit()
    asyncio.run(batches.run_batch(batch_id))
    job = batches.read_batch("preview", batch_id)
    assert [i["status"] for i in job["items"]] == ["needs_review", "completed"]
    assert sum(e[0] == "create" for e in pipeline) == 1


def test_type_override_applies_to_single_product_without_changing_vendor(pipeline):
    work = BackgroundTasks()
    result = asyncio.run(main.api_wholesale_create_product("preview", main.WholesaleProductCreate(
        store_type="clothes", title="Shirt", sale_price=50, colors=["White"],
        size_groups=[{"from": "M", "to": "M", "pcs_per_crate": 1, "crate_quantity": 2}],
    ), work))
    assert result["data"]["product"]["id"]
    assert work.tasks[0].args[12] == "clothes"
    assert db.get_app_setting(main.WHOLESALE_STORE, "wholesale_vendor:preview")["store_type"] == "shoes"


@pytest.mark.parametrize("shared", [
    {"store_type": "invalid"}, {"size_groups": []},
    {"size_groups": [{"from": 40, "to": 36, "pcs_per_crate": 12, "crate_quantity": 3, "sale_price": 20, "sku": "sku"}]},
    {"size_groups": [{"from": 36, "to": 40, "pcs_per_crate": 12, "crate_quantity": 0, "sale_price": 20, "sku": "sku"}]},
])
def test_invalid_shared_inputs_are_rejected_before_work(pipeline, shared):
    with pytest.raises(HTTPException) as error:
        enqueue(request(**shared))
    assert error.value.status_code == 422
    assert not pipeline


def test_vendor_cannot_read_other_vendor_batch(pipeline):
    batch_id, _ = enqueue()
    with pytest.raises(HTTPException) as error:
        batches.read_batch("different-vendor", batch_id)
    assert error.value.status_code == 404


@pytest.mark.parametrize("category,label", [("general", "One size"), ("electronics", "128 GB")])
def test_general_electronics_crate_pricing_and_label(pipeline, category, label):
    _, work = enqueue(request(store_type=category, sale_price=20, compare_at_price=30, size_groups=[{
        "from": label, "to": label, "label": label, "option_name": "Version" if category == "electronics" else "Size",
        "pcs_per_crate": 12, "crate_quantity": 5, "sku": "CRATE",
    }]))
    asyncio.run(work())
    variants = [e[1]["variants"][0] for e in pipeline if e[0] == "variants"]
    assert len(variants) == 2
    assert all(v["size"] == f"{label}*12pcs" and v["price"] == 240 and v["compare_at_price"] == 360 and v["quantity"] == 5 for v in variants)
    assert all("men" not in e[1]["tags"] for e in pipeline if e[0] == "create")


def test_publication_uses_publication_input_and_checks_errors(monkeypatch):
    calls = []
    def gql(store, query, variables):
        calls.append(variables)
        if "WholesalePublications" in query:
            return {"publications": {"nodes": [{"id": "gid://shopify/Publication/1"}], "pageInfo": {"hasNextPage": False}}}
        return {"publishablePublish": {"userErrors": []}}
    monkeypatch.setattr(publication, "_gql_store", gql)
    assert publication.publish_wholesale_product("gid://shopify/Product/1", store="mmd")["ok"]
    assert calls[-1]["input"] == [{"publicationId": "gid://shopify/Publication/1"}]
    monkeypatch.setattr(publication, "_gql_store", lambda store, query, variables: gql(store, query, variables) if "WholesalePublications" in query else {"publishablePublish": {"userErrors": [{"message": "Denied"}]}})
    with pytest.raises(RuntimeError, match="Denied"):
        publication.publish_wholesale_product("gid://shopify/Product/1", store="mmd")
