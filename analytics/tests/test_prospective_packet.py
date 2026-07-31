import copy
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from ou25_analytics.prospective.cli import validate_packet_path
from ou25_analytics.prospective.contracts import packet_payload_hash
from ou25_analytics.prospective.synthetic import make_synthetic_packet_payload
from ou25_analytics.prospective.validation import validate_packet


def rehash(payload: dict[str, Any]) -> dict[str, Any]:
    payload["packet_hash"] = packet_payload_hash(payload)
    return payload


def changed() -> dict[str, Any]:
    return copy.deepcopy(make_synthetic_packet_payload())


def assert_invalid(payload: dict[str, Any], message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        validate_packet(payload)


def test_valid_packet_is_deterministic_and_preserves_abstention() -> None:
    first = make_synthetic_packet_payload()
    second = make_synthetic_packet_payload()
    packet, summary = validate_packet(first)
    assert first == second
    assert first["packet_hash"] == second["packet_hash"]
    assert summary.decision_status_counts == {"ABSTAINED": 1, "SELECTED": 1}
    assert packet.decisions[0].break_even_probability == 0.625


def test_documented_json_example_matches_validated_factory() -> None:
    example_path = (
        Path(__file__).parents[2]
        / "docs"
        / "research"
        / "templates"
        / "prospective-capture-packet.example.json"
    )
    payload = json.loads(example_path.read_text(encoding="utf-8"))
    packet, summary = validate_packet(payload)
    assert payload == make_synthetic_packet_payload()
    assert packet.packet_hash == payload["packet_hash"]
    assert summary.fixture_count == 2


def test_invalid_probability_is_rejected() -> None:
    payload = changed()
    payload["forebet_snapshots"][0]["home_probability"] = 1.2
    assert_invalid(rehash(payload), "less than or equal to 1")


def test_invalid_probability_sum_is_rejected() -> None:
    payload = changed()
    payload["forebet_snapshots"][0].update(
        {"home_probability": 0.5, "draw_probability": 0.2, "away_probability": 0.2}
    )
    assert_invalid(rehash(payload), "must sum to 1")


def test_kickoff_without_utc_z_is_rejected() -> None:
    payload = changed()
    payload["fixtures"][0]["kickoff_at_utc"] = "2030-02-01T18:00:00+00:00"
    assert_invalid(rehash(payload), "explicit UTC Z")


def test_insufficient_kickoff_confidence_blocks_decision() -> None:
    payload = changed()
    payload["fixtures"][0]["kickoff_confidence"] = "MEDIUM"
    assert_invalid(rehash(payload), "requires CONFIRMED or HIGH")


def test_capture_universe_rejects_unlisted_competition() -> None:
    payload = changed()
    payload["fixtures"][0]["competition_key"] = "SYNTH_COMP_OUTSIDE"
    assert_invalid(rehash(payload), "competition is outside the capture universe")


def test_capture_universe_rejects_unlisted_bookmaker() -> None:
    payload = changed()
    payload["odds_snapshots"][0]["bookmaker_key"] = "SYNTH_BOOK_OUTSIDE"
    assert_invalid(rehash(payload), "bookmaker is outside the capture universe")


def test_capture_universe_rejects_kickoff_outside_date_window() -> None:
    payload = changed()
    payload["capture_universe"]["date_from"] = "2030-01-31"
    payload["capture_universe"]["date_to"] = "2030-01-31"
    assert_invalid(rehash(payload), "kickoff is outside the capture-universe date window")


def test_decision_requires_scheduled_fixture() -> None:
    payload = changed()
    payload["fixtures"][0]["fixture_status"] = "POSTPONED"
    assert_invalid(rehash(payload), "decision requires a SCHEDULED fixture")


def test_packet_cannot_predate_recorded_observation() -> None:
    payload = changed()
    payload["generated_at_utc"] = "2030-02-01T21:00:00.000Z"
    assert_invalid(rehash(payload), "cannot be generated before any recorded observation")


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("decimal_odds", 1.0, "greater than 1"),
        ("is_in_play", True, "in-play odds are not allowed"),
        ("market_status", "SUSPENDED", "must be ACTIVE"),
        ("selection_key", "UNKNOWN", "Input should be"),
    ],
)
def test_invalid_odds_are_rejected(field: str, value: object, message: str) -> None:
    payload = changed()
    payload["odds_snapshots"][0][field] = value
    assert_invalid(rehash(payload), message)


def test_forebet_after_kickoff_is_rejected() -> None:
    payload = changed()
    payload["forebet_snapshots"][0]["captured_at_utc"] = "2030-02-01T18:00:01.000Z"
    assert_invalid(rehash(payload), "Forebet snapshot must be strictly before kickoff")


def test_odds_after_kickoff_is_rejected() -> None:
    payload = changed()
    payload["odds_snapshots"][0]["captured_at_utc"] = "2030-02-01T18:00:01.000Z"
    assert_invalid(rehash(payload), "odds snapshot must be strictly before kickoff")


def test_decision_at_kickoff_is_rejected() -> None:
    payload = changed()
    payload["decisions"][0]["decided_at_utc"] = "2030-02-01T18:00:00.000Z"
    assert_invalid(rehash(payload), "decision must be strictly before kickoff")


def test_selected_without_exact_quote_is_rejected() -> None:
    payload = changed()
    payload["decisions"][0]["selected_odds_snapshot_id"] = None
    assert_invalid(rehash(payload), "SELECTED decision requires exact")


def test_quote_from_other_fixture_is_rejected() -> None:
    payload = changed()
    payload["decisions"][0].update(
        {
            "selected_odds_snapshot_id": "SYNTH_ODDS_B_AWAY",
            "selected_market_key": "MATCH_ODDS_1X2",
            "selected_selection_key": "AWAY",
            "break_even_probability": None,
        }
    )
    assert_invalid(rehash(payload), "selected odds must belong to the decision fixture")


def test_closing_snapshot_cannot_be_a_decision_input() -> None:
    payload = changed()
    payload["decisions"][0]["selected_odds_snapshot_id"] = "SYNTH_CLOSING_A_1X"
    assert_invalid(rehash(payload), "closing snapshot cannot be used")


def test_outcome_before_kickoff_is_rejected() -> None:
    payload = changed()
    payload["outcomes"][0]["observed_at_utc"] = "2030-02-01T17:59:59.000Z"
    assert_invalid(rehash(payload), "outcome must be observed after kickoff")


def test_invalid_outcome_correction_is_rejected() -> None:
    payload = changed()
    correction = copy.deepcopy(payload["outcomes"][0])
    correction.update(
        {
            "outcome_id": "SYNTH_OUTCOME_A_V2",
            "observed_at_utc": "2030-02-02T02:00:00.000Z",
            "outcome_status": "CORRECTED",
            "supersedes_outcome_id": "SYNTH_MISSING_OUTCOME",
        }
    )
    payload["outcomes"].append(correction)
    assert_invalid(rehash(payload), "must reference a prior version")


def test_duplicate_ids_are_rejected() -> None:
    payload = changed()
    payload["odds_snapshots"].append(copy.deepcopy(payload["odds_snapshots"][0]))
    assert_invalid(rehash(payload), "odds snapshot IDs must be unique")


def test_inconsistent_packet_hash_is_rejected() -> None:
    payload = changed()
    payload["generated_at_utc"] = "2030-02-02T01:00:01.000Z"
    assert_invalid(payload, "packet_hash is inconsistent")


def test_dry_run_does_not_write_databases_or_modify_packet(tmp_path: Path) -> None:
    packet_path = tmp_path / "packet.json"
    packet_path.write_text(json.dumps(make_synthetic_packet_payload()), encoding="utf-8")
    before = packet_path.read_bytes()
    before_files = sorted(path.relative_to(tmp_path) for path in tmp_path.rglob("*"))
    _, summary = validate_packet_path(str(packet_path), allowed_roots=(tmp_path,))
    after_files = sorted(path.relative_to(tmp_path) for path in tmp_path.rglob("*"))
    assert summary.synthetic
    assert packet_path.read_bytes() == before
    assert before_files == after_files
    assert not list(tmp_path.rglob("*.db"))
    assert not list(tmp_path.rglob("*.sqlite*"))


def test_cli_self_check_cleans_temporaries(tmp_path: Path) -> None:
    temporary_root = tmp_path / "cli-temporary"
    temporary_root.mkdir()
    environment = {**os.environ, "TMPDIR": str(temporary_root)}
    result = subprocess.run(
        [sys.executable, "-m", "ou25_analytics.cli", "prospective-packet-self-check"],
        check=False,
        capture_output=True,
        text=True,
        env=environment,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert "SYNTHETIC_PROSPECTIVE_PACKET" in result.stdout
    assert "NO_REAL_DATA" in result.stdout
    assert "NO_REAL_PERFORMANCE_CLAIM" in result.stdout
    assert '"break_even_probability": 0.625' in result.stdout
    assert list(temporary_root.iterdir()) == []


def test_prospective_modules_have_no_legacy_or_network_access() -> None:
    root = Path(__file__).parents[1] / "src" / "ou25_analytics" / "prospective"
    source = "\n".join(path.read_text(encoding="utf-8") for path in root.glob("*.py"))
    forbidden = ("ou25-consensus-lab", "prisma/dev.db", "sqlite3", "requests.", "httpx.")
    assert all(term not in source for term in forbidden)


def test_cli_rejects_urls_and_paths_outside_synthetic_roots() -> None:
    with pytest.raises(ValueError, match="URLs are not accepted"):
        validate_packet_path("https://invalid.example/packet.json")
    example_path = (
        Path(__file__).parents[2]
        / "docs"
        / "research"
        / "templates"
        / "prospective-capture-packet.example.json"
    )
    with pytest.raises(ValueError, match="outside synthetic"):
        validate_packet_path(str(example_path))


def test_synthetic_factory_contains_no_real_sports_data() -> None:
    payload = make_synthetic_packet_payload()
    assert payload["source_metadata"]["synthetic"] is True
    assert all(item["source_fixture_id"].startswith("SYNTH_") for item in payload["fixtures"])
    assert all(item["competition_raw"].startswith("Synthetic ") for item in payload["fixtures"])
    assert all(item["home_team_raw"].startswith("Synthetic ") for item in payload["fixtures"])
    assert all(item["away_team_raw"].startswith("Synthetic ") for item in payload["fixtures"])
