from __future__ import annotations

import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, time as dt_time, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from app.shopify_store_registry import configured_store_labels
from app.social_agent import meta, repository as repo, shopify
from app.social_agent.openai_agents import (
    analyze_learning,
    create_strategy,
    data_url_bytes,
    generate_candidate,
    repair_strategy,
    review_candidate,
)


def _safe_error(error: BaseException) -> dict[str, str]:
    return {"type": type(error).__name__, "message": str(error)[:1500]}


def _tz(config: dict[str, Any]) -> ZoneInfo:
    try:
        return ZoneInfo(str(config.get("timezone") or "Africa/Casablanca"))
    except Exception:
        return ZoneInfo("Africa/Casablanca")


def _parse_hhmm(value: str, fallback: str) -> dt_time:
    try:
        hour, minute = [int(x) for x in str(value).split(":", 1)]
        return dt_time(max(0, min(hour, 23)), max(0, min(minute, 59)))
    except Exception:
        hour, minute = [int(x) for x in fallback.split(":", 1)]
        return dt_time(hour, minute)


def _scheduled_utc(config: dict[str, Any], local_day: date, slot: str, position: int) -> datetime:
    base_value = config.get("midday_time") if slot == "midday" else config.get("evening_time")
    base_time = _parse_hhmm(str(base_value or ""), "14:00" if slot == "midday" else "18:00")
    interval = (
        int(config.get("midday_post_interval_minutes") or 8)
        if slot == "midday" else int(config.get("post_interval_minutes") or 30)
    )
    local_dt = datetime.combine(local_day, base_time, tzinfo=_tz(config)) + timedelta(minutes=interval * position)
    if slot == "evening":
        end_time = _parse_hhmm(str(config.get("evening_end_time") or ""), "23:59")
        end_local = datetime.combine(local_day, end_time, tzinfo=_tz(config))
        if local_dt > end_local:
            raise ValueError(
                "The evening batch does not fit inside the configured posting window; "
                "reduce posts or interval, or move the evening end later"
            )
    return local_dt.astimezone(timezone.utc).replace(tzinfo=None)


def _batch_key(store: str, local_day: date, slot: str) -> str:
    return f"{repo.canonical_store(store)}:{local_day.isoformat()}:{slot}"


def catalog_preview(store: str | None, limit: int = 20) -> dict[str, Any]:
    config = repo.get_config(store)
    season = shopify.current_season(datetime.now(_tz(config)))
    products = shopify.list_active_products(store, first=max(50, limit * 3))
    ranked = shopify.rank_products(
        products, season=season, minimum_inventory=int(config.get("minimum_inventory") or 1),
        recent_ids=repo.recent_product_ids(store),
    )
    return {
        "season": season, "products": ranked[:max(1, min(limit, 50))],
        "active_count": len(products), "eligible_count": len(ranked),
    }


def queue_batch(store: str | None, slot: str, local_day: date | None = None) -> dict[str, Any]:
    store_name = repo.canonical_store(store)
    if slot not in {"midday", "evening"}:
        raise ValueError("slot must be midday or evening")
    config = repo.get_config(store_name)
    local_day = local_day or datetime.now(_tz(config)).date()
    key = _batch_key(store_name, local_day, slot)
    existing = repo.get_run_by_key(key)
    if existing:
        return existing
    preview = catalog_preview(store_name, limit=max(15, int(config.get("batch_size") or 5) * 3))
    products = preview.get("products") or []
    target = int(config.get("batch_size") or 5)
    if len(products) < target:
        raise RuntimeError(f"Only {len(products)} eligible active product(s) meet the inventory and media rules")
    # Start with unique high-ranked products. Future versions can intentionally
    # repeat a hero product after performance evidence justifies it.
    selected = products[:target]
    backups = products[target:target * int(config.get("max_review_attempts") or 3)]
    context = {
        "local_date": local_day.isoformat(), "season": preview.get("season"),
        "products": selected, "backup_products": backups,
        "scheduled_for": [_scheduled_utc(config, local_day, slot, i).isoformat() + "Z" for i in range(target)],
        "config_snapshot": {
            key: config.get(key) for key in (
                "timezone", "midday_time", "evening_time", "evening_end_time",
                "midday_post_interval_minutes", "post_interval_minutes",
                "creative_variants", "minimum_review_score", "quantity_offer_enabled",
                "max_review_attempts", "approved_quantity_offer_ar", "brand_notes", "hashtags", "live_publish",
            )
        },
    }
    return repo.create_run(store_name, key, slot, target, context)


def _candidate_file_name(post_id: str, candidate: int, mime_type: str) -> str:
    ext = ".png" if "png" in mime_type else ".jpg"
    digest = hashlib.sha1(f"{post_id}:{candidate}".encode("utf-8")).hexdigest()[:10]
    return f"social-{post_id[:8]}-{digest}-v{candidate}{ext}"


def prepare_one(run_id: str) -> dict[str, Any]:
    run = repo.get_run(run_id)
    if not run:
        raise RuntimeError("Social batch not found")
    config = repo.get_config(run.get("store"))
    max_attempts = int(config.get("max_review_attempts") or 3)
    existing = repo.list_run_posts(run_id)
    retry_post = next(
        (
            item for item in existing
            if item.get("status") in {"generating", "failed", "rejected"}
            and int(item.get("attempts") or 0) < max_attempts
        ),
        None,
    )
    position = int(retry_post.get("position")) if retry_post else len(existing)
    if position >= int(run.get("target_count") or 0):
        return {"run": repo.refresh_run_progress(run_id), "post": None}
    context = run.get("context") or {}
    products = context.get("products") or []
    if position >= len(products):
        repo.update_run(run_id, status="failed", error={"message": "Batch product plan is incomplete"})
        raise RuntimeError("Batch product plan is incomplete")
    product = products[position]
    if retry_post and retry_post.get("status") == "rejected":
        backup_index = (int(retry_post.get("attempts") or 0) - 1) * int(run.get("target_count") or 0) + position
        backups = context.get("backup_products") or []
        if 0 <= backup_index < len(backups):
            product = backups[backup_index]
    scheduled = _scheduled_utc(
        config, date.fromisoformat(str(context.get("local_date"))), str(run.get("slot")), position,
    )
    post = (
        repo.update_post(str(retry_post["id"]), status="generating", error=None, product=product)
        if retry_post else
        repo.create_post(
            run_id=run_id, store=str(run.get("store")), slot=str(run.get("slot")),
            position=position, scheduled_for=scheduled, product=product,
        )
    )
    if not post:
        raise RuntimeError("Could not create or recover the social post job")
    attempt_number = int(post.get("attempts") or 0) + 1
    try:
        learning = repo.get_learning(run.get("store"))
        strategy = create_strategy(product, config, learning, slot=str(run.get("slot")), position=position)
        repo.update_post(post["id"], strategy=strategy, attempts=attempt_number)
        directions = list(strategy.get("visual_directions") or [])
        wanted = int(config.get("creative_variants") or 2)
        while len(directions) < wanted:
            directions.append(f"Alternative premium product-first composition {len(directions) + 1}")
        generated: dict[int, str] = {}
        with ThreadPoolExecutor(max_workers=min(3, wanted)) as pool:
            futures = {
                pool.submit(generate_candidate, product, strategy, directions[index], index + 1): index + 1
                for index in range(wanted)
            }
            for future in as_completed(futures):
                generated[futures[future]] = future.result()
        reviewed: list[dict[str, Any]] = []
        with ThreadPoolExecutor(max_workers=min(3, len(generated))) as pool:
            futures = {
                pool.submit(review_candidate, product, strategy, data_url, config, number): (number, data_url)
                for number, data_url in generated.items()
            }
            for future in as_completed(futures):
                number, data_url = futures[future]
                reviewed.append({"candidate": number, "data_url": data_url, "review": future.result()})
        reviewed.sort(key=lambda item: int((item.get("review") or {}).get("score") or 0), reverse=True)
        approved = [item for item in reviewed if (item.get("review") or {}).get("decision") == "approve"]
        # If the strongest candidate is visually faithful and only copy/factual
        # wording failed, repair the strategy and send the same image through a
        # fresh independent review. Never repair around a visual-fidelity error.
        if not approved and reviewed:
            repairable = next(
                (item for item in reviewed if not ((item.get("review") or {}).get("visual_errors") or [])),
                None,
            )
            if repairable:
                repaired_strategy = repair_strategy(product, strategy, repairable.get("review") or {}, config)
                repaired_review = review_candidate(
                    product, repaired_strategy, repairable["data_url"], config, int(repairable["candidate"]),
                )
                repairable["review"] = repaired_review
                repairable["copy_repaired"] = True
                strategy = repaired_strategy
                repo.update_post(post["id"], strategy=strategy)
                reviewed.sort(key=lambda item: int((item.get("review") or {}).get("score") or 0), reverse=True)
                approved = [item for item in reviewed if (item.get("review") or {}).get("decision") == "approve"]
        if not approved:
            strongest_review = dict((reviewed[0].get("review") or {}) if reviewed else {})
            review_summary = {**strongest_review, "decision": "reject", "selected_candidate": None, "candidates": [
                {"candidate": x["candidate"], **(x.get("review") or {})} for x in reviewed
            ]}
            post = repo.update_post(post["id"], status="rejected", review=review_summary)
            return {"run": repo.refresh_run_progress(run_id), "post": post}
        winner_number = int(approved[0]["candidate"])
        assets: list[dict[str, Any]] = []
        for item in sorted(reviewed, key=lambda value: int(value["candidate"])):
            uploaded = None
            if (item.get("review") or {}).get("decision") == "approve":
                raw, mime = data_url_bytes(item["data_url"])
                uploaded = shopify.upload_file_bytes(
                    run.get("store"), filename=_candidate_file_name(post["id"], int(item["candidate"]), mime),
                    content=raw, mime_type=mime, alt_text=strategy.get("alt_text_ar") or product.get("title") or "Product",
                )
            assets.append({
                "candidate": item["candidate"], "selected": int(item["candidate"]) == winner_number,
                "direction": directions[int(item["candidate"]) - 1], "review": item.get("review"),
                "copy_repaired": bool(item.get("copy_repaired")), "shopify": uploaded,
            })
        winner_review = dict(approved[0].get("review") or {})
        review_summary = {
            **winner_review, "decision": "approve", "selected_candidate": winner_number,
            "candidates": [{"candidate": x["candidate"], **(x.get("review") or {})} for x in reviewed],
        }
        status = "approved" if config.get("live_publish") else "preview_ready"
        post = repo.update_post(post["id"], status=status, assets=assets, review=review_summary)
        return {"run": repo.refresh_run_progress(run_id), "post": post}
    except Exception as error:
        post = repo.update_post(post["id"], status="failed", error=_safe_error(error), attempts=attempt_number)
        repo.refresh_run_progress(run_id)
        raise


def prepare_next(store: str | None = None) -> dict[str, Any] | None:
    run = repo.claim_next_run(store)
    if not run:
        return None
    return prepare_one(run["id"])


def _caption(post: dict[str, Any]) -> str:
    strategy = post.get("strategy") or {}
    caption = str(strategy.get("caption_ar") or "").strip()
    product_url = str((post.get("product") or {}).get("url") or "").strip()
    if product_url and product_url not in caption:
        caption = f"{caption}\n\n{product_url}".strip()
    hashtags = [str(x).strip() for x in strategy.get("hashtags") or [] if str(x).strip()]
    if hashtags and not any(tag in caption for tag in hashtags):
        caption = f"{caption}\n\n{' '.join(hashtags)}".strip()
    return caption


def publish_post(post_id: str, *, force: bool = False) -> dict[str, Any]:
    post = repo.get_post(post_id)
    if not post:
        raise RuntimeError("Social post not found")
    config = repo.get_config(post.get("store"))
    if not config.get("live_publish") and not force:
        raise RuntimeError("Live publishing is disabled for this store")
    if (post.get("review") or {}).get("decision") != "approve":
        raise RuntimeError("The reviewer has not approved this post")
    selected = next((asset for asset in post.get("assets") or [] if asset.get("selected")), None)
    image_url = str((((selected or {}).get("shopify") or {}).get("url")) or "")
    if not image_url:
        raise RuntimeError("Approved post has no Shopify-hosted image")
    caption = _caption(post)
    alt_text = str((post.get("strategy") or {}).get("alt_text_ar") or (post.get("product") or {}).get("title") or "Product")
    platforms = dict(post.get("platforms") or {})
    errors: dict[str, str] = {}
    if not (platforms.get("facebook") or {}).get("id"):
        try:
            platforms["facebook"] = meta.publish_facebook_image(post.get("store"), image_url=image_url, caption=caption)
            repo.update_post(post_id, platforms=platforms)
        except Exception as error:
            errors["facebook"] = str(error)[:1200]
    if not (platforms.get("instagram") or {}).get("id"):
        try:
            platforms["instagram"] = meta.publish_instagram_image(post.get("store"), image_url=image_url, caption=caption, alt_text=alt_text)
            repo.update_post(post_id, platforms=platforms)
        except Exception as error:
            errors["instagram"] = str(error)[:1200]
    complete = bool((platforms.get("facebook") or {}).get("id") and (platforms.get("instagram") or {}).get("id"))
    status = "published" if complete else ("partial" if platforms else "publish_failed")
    return repo.update_post(
        post_id, status=status, platforms=platforms,
        error=({"platform_errors": errors} if errors else None), attempts=int(post.get("attempts") or 0) + 1,
    ) or post


def publish_due(store: str | None, limit: int = 3) -> list[dict[str, Any]]:
    config = repo.get_config(store)
    if not config.get("live_publish"):
        return []
    results: list[dict[str, Any]] = []
    for post in repo.claim_due_posts(store, datetime.utcnow(), limit=limit):
        try:
            results.append(publish_post(post["id"]))
        except Exception as error:
            failed = repo.update_post(post["id"], status="publish_failed", error=_safe_error(error), attempts=int(post.get("attempts") or 0) + 1)
            if failed:
                results.append(failed)
    return results


def collect_analytics(store: str | None) -> dict[str, Any]:
    config = repo.get_config(store)
    lookback = int(config.get("analytics_lookback_days") or 30)
    posts = repo.list_posts(store, limit=250, since=datetime.utcnow() - timedelta(days=lookback))
    measured: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for post in posts:
        if post.get("status") not in {"published", "partial"} or not post.get("platforms"):
            continue
        try:
            metrics = meta.collect_post_metrics(store, post.get("platforms") or {})
            current = repo.update_post(post["id"], metrics=metrics)
            if current:
                measured.append(current)
        except Exception as error:
            errors.append({"post_id": str(post.get("id")), "error": str(error)[:500]})
            if post.get("metrics"):
                measured.append(post)
    learning = analyze_learning(measured)
    repo.save_learning(store, learning)
    config_tz = _tz(config)
    repo.set_analytics_marker(store, {"local_date": datetime.now(config_tz).date().isoformat(), "updated_at": datetime.utcnow().isoformat() + "Z"})
    return {"measured": len(measured), "errors": errors, "learning": learning}


def dashboard(store: str | None) -> dict[str, Any]:
    config = repo.get_config(store)
    posts = repo.list_posts(store, limit=80, since=datetime.utcnow() - timedelta(days=45))
    runs = repo.list_runs(store, limit=20)
    published = [post for post in posts if post.get("status") == "published"]
    reached = [post for post in published if int(((post.get("metrics") or {}).get("totals") or {}).get("reach") or 0) > 0]
    best = sorted(reached, key=lambda post: float(((post.get("metrics") or {}).get("totals") or {}).get("engagement_rate") or 0), reverse=True)[:5]
    total_reach = sum(int(((post.get("metrics") or {}).get("totals") or {}).get("reach") or 0) for post in published)
    total_interactions = sum(int(((post.get("metrics") or {}).get("totals") or {}).get("interactions") or 0) for post in published)
    return {
        "config": config,
        "learning": repo.get_learning(store),
        "runs": runs,
        "posts": posts,
        "best_posts": best,
        "stats": {
            "generated": len(posts), "review_approved": len([p for p in posts if (p.get("review") or {}).get("decision") == "approve"]),
            "published": len(published), "rejected": len([p for p in posts if p.get("status") == "rejected"]),
            "total_reach": total_reach, "total_interactions": total_interactions,
            "engagement_rate": round(total_interactions / total_reach * 100, 2) if total_reach else 0,
        },
        "scheduler": {
            "endpoint": "/api/social-agent/scheduler/tick",
            "secret_configured": bool(os.getenv("SOCIAL_AGENT_SCHEDULER_SECRET", "")),
            "last_analytics": repo.analytics_marker(store),
        },
    }


def scheduler_tick(store: str | None = None) -> dict[str, Any]:
    stores = [repo.canonical_store(store)] if store else configured_store_labels()
    output: dict[str, Any] = {"stores": {}, "at": datetime.utcnow().isoformat() + "Z"}
    for store_name in stores:
        config = repo.get_config(store_name)
        item: dict[str, Any] = {"enabled": bool(config.get("enabled")), "queued": [], "prepared": None, "published": [], "analytics": None}
        output["stores"][store_name] = item
        if not config.get("enabled"):
            continue
        local_now = datetime.now(_tz(config))
        for slot, fallback in (("midday", "14:00"), ("evening", "17:00")):
            slot_value = config.get("midday_time") if slot == "midday" else config.get("evening_time")
            slot_local = datetime.combine(local_now.date(), _parse_hhmm(str(slot_value or ""), fallback), tzinfo=_tz(config))
            opens = slot_local - timedelta(minutes=int(config.get("prepare_minutes_before") or 60))
            closes = (
                datetime.combine(
                    local_now.date(),
                    _parse_hhmm(str(config.get("evening_end_time") or ""), "23:59"),
                    tzinfo=_tz(config),
                )
                if slot == "evening" else slot_local + timedelta(minutes=45)
            )
            if opens <= local_now <= closes:
                try:
                    item["queued"].append(queue_batch(store_name, slot, local_now.date()))
                except Exception as error:
                    item.setdefault("errors", []).append({"phase": f"queue_{slot}", **_safe_error(error)})
        try:
            item["prepared"] = prepare_next(store_name)
        except Exception as error:
            item.setdefault("errors", []).append({"phase": "prepare", **_safe_error(error)})
        try:
            item["published"] = publish_due(store_name, limit=2)
        except Exception as error:
            item.setdefault("errors", []).append({"phase": "publish", **_safe_error(error)})
        marker = repo.analytics_marker(store_name)
        if local_now.hour >= 9 and marker.get("local_date") != local_now.date().isoformat():
            try:
                item["analytics"] = collect_analytics(store_name)
            except Exception as error:
                item.setdefault("errors", []).append({"phase": "analytics", **_safe_error(error)})
    return output
