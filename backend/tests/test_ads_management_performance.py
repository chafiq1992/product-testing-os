from app import db


def test_bulk_app_settings_round_trip():
    db.set_app_settings("perf-test", {"a": {"value": 1}, "b": 0})

    assert db.get_app_settings("perf-test", ["a", "b", "missing"]) == {
        "a": {"value": 1},
        "b": 0,
    }


def test_campaign_meta_summary_preserves_table_fields_and_task_count():
    value = {
        "owner": "adil",
        "product_life_checks": {"testing": {"0": True}},
        "timeline": [
            {"text": '{"type":"analysis","analysis":{"large":"payload"}}', "at": "1"},
            {"text": '{"type":"task","done":false}', "at": "2"},
            {"text": '{"type": "task", "done": true}', "at": "3"},
            {"text": "plain note", "at": "4"},
        ],
    }

    summary = db._campaign_meta_summary(value)

    assert "timeline" not in summary
    assert summary["timeline_entries"] == 4
    assert summary["incomplete_tasks"] == 1
    assert summary["owner"] == "adil"
    assert summary["product_life_checks"] == value["product_life_checks"]
